/**
 * V3 GeoEncoder RAG - 独立的空间智能后端服务
 *
 * 职责：
 * - 空间意图解析
 * - 混合检索（FAISS + PostGIS）
 * - LLM 答案生成
 * - 流式输出
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 导入服务
import { query, getPoolStatus, close as closeDb } from './services/data/database.js';
import { loadEmbeddings, faissHybridSearch, getIndexStatus } from './services/retrieval/faissIndex.js';
import { parseIntent, filterCandidatesWithSmallLLM } from './services/spatial_core/ai/intentService.js';
import { generateAnswer, generateEmbedding, callLLM, callLLMStream, getLLMConfig } from './services/ai/llmService.js';
import { resolveChatRuntimeStatus } from './services/ai/runtimeStatusService.js';
import { generateAnswerStream, buildSpatialAnswerFallback } from './services/spatial_core/ai/spatialAnswerService.js';
import {
  startManagedLlamaCppServices,
  stopManagedLlamaCppServices,
  stopManagedLlamaCppServicesSync
} from './services/infra/llamaCppService.js';
import { startOllama, getStatus as getOllamaStatus } from './services/infra/ollamaService.js';
import { ensurePostgreSQLRunning } from './services/infra/dockerService.js';
import { getSpatialEncoderStatus, startSpatialEncoder } from './services/infra/spatialEncoderClient.js';
import {
  DEFAULT_SPATIAL_ANCHOR,
  buildAssistantMetaReply,
  buildSpatialEvidence,
  buildGreetingReply,
  buildGeneralReasoningOutline,
  buildSpatialReasoningOutline,
  isAssistantMetaQuery,
  isPureGreetingQuery,
  isLikelySpatialIntent
} from './services/ai/chatPipeline.js';
import { selectVectorConstraintContext } from './services/retrieval/spatialEvidenceService.js';
import {
  getCategoryTreeFromPois,
  toSpatialPoiFeature,
  findPOIsFiltered,
  isSimpleQuery,
  expandSearchTerms,
  quickSearchPois
} from './services/data/frontendDataService.js';
import { buildSurfaceQueryWkt, fetchSurfaceContext, refineSurfaceConstraintGeometry } from './services/data/surfaceDataService.js';
import { enrichResultsWithSpatialEncoder } from './services/retrieval/runtimeSpatialAugmenter.js';
import { handleSpatialQuery } from './services/spatial_core/retrieval/spatialSearchOrchestrator.js';
import { buildSpatialQueryEmbedding, buildQueryEmbeddingSearchOptions } from './services/retrieval/queryEmbeddingService.js';
import { buildSpatialRagContext } from './services/retrieval/spatialRagContextService.js';
import { createPlannerDemoService } from './services/planner_line/plannerRouteService.js';
import { shouldUsePlannerLineChat } from './services/planner_line/plannerChatGate.js';

// 创建 Fastify 实例
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// 注册插件
await fastify.register(cors, { origin: '*' });

const plannerDemoService = createPlannerDemoService();

// ============================================
// AI 服务状态（前端 AI 面板需要）
// ============================================

const V3_SSE_SCHEMA_VERSION = 'v3.1';
const V3_SSE_CAPABILITIES = Object.freeze([
  'structured_sse',
  'pois',
  'boundary',
  'spatial_clusters',
  'vernacular_regions',
  'fuzzy_regions',
  'stats',
  'refined_result',
  'reasoning',
  'true_streaming'
]);

fastify.get('/api/ai/status', async () => {
  const ollamaStatus = await getOllamaStatus();
  const spatialEncoderStatus = await getSpatialEncoderStatus();
  const llmRuntime = await resolveChatRuntimeStatus({
    env: process.env,
    ollamaStatus
  });

  return {
    online: llmRuntime.online,
    service: 'V3-GeoEncoder-RAG',
    provider: llmRuntime.provider,
    ready: llmRuntime.ready,
    model: llmRuntime.model,
    models: llmRuntime.models,
    ollama: ollamaStatus,
    llmRuntime,
    spatialEncoder: spatialEncoderStatus,
  };
});

fastify.get('/api/category/tree', async (request, reply) => {
  try {
    return await getCategoryTreeFromPois();
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed to load categories', details: error.message });
  }
});

fastify.get('/api/category/flat', async (request, reply) => {
  try {
    const tree = await getCategoryTreeFromPois();
    const flat = [];
    const walk = (nodes = []) => {
      nodes.forEach((node) => {
        if (Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children);
        } else if (node?.value) {
          flat.push(node.value);
        }
      });
    };
    walk(tree);
    return flat;
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed to load flat categories', details: error.message });
  }
});

// ============================================
// AI 模板权重（前端 AI 面板需要）
// ============================================

fastify.get('/api/ai/template-feedback/weights', async () => {
  // V3 使用默认权重，无需数据库
  return {
    ok: true,
    version: 'v3-default',
    loaded_at: Date.now(),
    weights: {
      // 默认模板权重
      spatial: 0.4,
      semantic: 0.3,
      popularity: 0.2,
      distance: 0.1,
    },
  };
});

// ============================================
// AI 聊天 API（前端 AI 面板需要）
// V3 简化阶段：意图理解 → 答案生成（流式）
// ============================================

fastify.post('/api/ai/chat', async (request, reply) => {
  const { messages = [], poiFeatures = [], options = {} } = request.body || {};
  const spatialContext =
    options?.spatialContext && typeof options.spatialContext === 'object'
      ? options.spatialContext
      : null;

  if (!messages || messages.length === 0) {
    return reply.code(400).send({ error: 'messages is required' });
  }

  const traceId = `v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  // 设置 SSE 响应头（带 CORS）
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  // 辅助函数：发送 SSE 事件
  const withEventMeta = (payload = {}) => ({
    ...payload,
    trace_id: traceId,
    schema_version: V3_SSE_SCHEMA_VERSION,
    capabilities: V3_SSE_CAPABILITIES
  });
  const sendEvent = (type, data = {}) => {
    let envelope = { type };

    if (Array.isArray(data)) {
      envelope.payload = data;
    } else if (data && typeof data === 'object') {
      if (Object.prototype.hasOwnProperty.call(data, 'type') || Object.prototype.hasOwnProperty.call(data, 'payload')) {
        envelope.payload = data;
      } else {
        envelope = { type, ...data };
      }
    } else if (data !== undefined) {
      envelope.value = data;
    }

    reply.raw.write(`data: ${JSON.stringify(envelope)}\n\n`);
  };

  try {
    // 获取用户最新消息
    const lastMessage = messages[messages.length - 1];
    const userQuery = lastMessage?.content || '';
    const hasCustomArea = Boolean(
      (Array.isArray(spatialContext?.boundary) && spatialContext.boundary.length >= 3) ||
      (Array.isArray(spatialContext?.regions) && spatialContext.regions.length > 0)
    );

    console.log(`[V3 Chat] User query: ${userQuery}`);

    // 发送元数据
    sendEvent('meta', {
      traceId,
      backend: 'v3',
      schema_version: V3_SSE_SCHEMA_VERSION,
      capabilities: V3_SSE_CAPABILITIES
    });

    // ========== 阶段 1：意图理解 ==========
    sendEvent('stage', withEventMeta({ name: 'intent', label: '意图理解', hint: '正在理解您的问题...' }));

    const isGreetingQuery = isPureGreetingQuery(userQuery);
    const isAssistantMeta = isAssistantMetaQuery(userQuery);
    let intent = null;
    let isSpatialQuery = false;

    if (!isGreetingQuery && !isAssistantMeta) {
      intent = await parseIntent(userQuery);
      if (intent?.intentPreview) {
        sendEvent('intent_preview', withEventMeta({
          ...intent.intentPreview,
          place_name: intent.placeName || null,
          category: intent.category || null,
          poi_sub_type: intent.poiSubType || null,
          parser_model: intent.parserModel || null,
          parser_provider: intent.parserProvider || null
        }));
      }
      isSpatialQuery = isLikelySpatialIntent({
        userQuery,
        intent,
        poiFeatures,
        spatialContext
      });

      const plannerLineEnabled = shouldUsePlannerLineChat({
        isSpatialQuery,
        intent,
        options,
        env: process.env
      });

      if (plannerLineEnabled) {
        console.log('[V3 Chat] Planner line prototype branch enabled')
        const plannerResult = await plannerDemoService.runChatRequest({
          messages,
          options: {
            synthesisMode: options?.plannerSynthesisMode || 'fallback',
            spatialContext
          }
        });

        if (plannerResult?.success) {
          sendEvent('stage', withEventMeta({
            name: 'planner_line',
            label: 'Planner 原型',
            hint: '正在使用 planner_line 单轮原型...'
          }));
          if (plannerResult.planning?.plan) {
            sendEvent('planner_plan', withEventMeta({
              plan: plannerResult.planning.plan,
              source: plannerResult.planning.source || null
            }));
          }
          if (plannerResult.execution?.evidence_bundle?.nearby_pois?.length > 0) {
            sendEvent('pois', plannerResult.execution.evidence_bundle.nearby_pois);
          }
          sendEvent('text', { content: plannerResult.answer?.text || 'planner_line 未返回回答。' });
          sendEvent('done', withEventMeta({
            duration_ms: Date.now() - startTime,
            planner_line: true
          }));
          reply.raw.end();
          return;
        }

        console.warn('[V3 Chat] Planner line prototype failed, falling back to legacy path')
      }
    }

    // ========== 空间查询：RAG 流程 ==========
    if (isSpatialQuery) {
      console.log('[V3 Chat] Spatial query detected');

      // 阶段 2：空间检索
      sendEvent('stage', withEventMeta({ name: 'spatial', label: '空间检索', hint: '正在搜索相关地点...' }));

      const askResult = await handleSpatialQuery(userQuery, {
        poiFeatures,
        spatialContext,
        intent,
        traceId
      });

      if (askResult.evidence.pois.length > 0) {
        sendEvent('pois', askResult.evidence.pois);
      }
      if (askResult.evidence.boundary) {
        sendEvent('boundary', withEventMeta(askResult.evidence.boundary));
      }
      if (askResult.evidence.spatialClusters?.hotspots?.length > 0) {
        sendEvent('spatial_clusters', withEventMeta(askResult.evidence.spatialClusters));
      }
      if (askResult.evidence.vernacularRegions.length > 0) {
        sendEvent('vernacular_regions', askResult.evidence.vernacularRegions);
      }
      if (askResult.evidence.fuzzyRegions.length > 0) {
        sendEvent('fuzzy_regions', askResult.evidence.fuzzyRegions);
      }
      sendEvent('stats', withEventMeta(askResult.evidence.stats));

      sendEvent('stage', withEventMeta({ name: 'reasoning', label: '空间推理', hint: '正在整合空间证据...' }));
      sendEvent('thinking', withEventMeta({ status: 'start', message: '正在整合空间证据...' }));
      sendEvent('reasoning', withEventMeta({
        content: buildSpatialReasoningOutline({
          intent: askResult.intent,
          spatialContext
        })
      }));
      sendEvent('thinking', withEventMeta({ status: 'end', message: '空间推理完成' }));
      sendEvent('refined_result', askResult.evidence.refinedResult);

      // 阶段 4：答案生成（真流式）
      sendEvent('stage', withEventMeta({ name: 'answer', label: '答案生成', hint: '正在生成回答...' }));
      const answerOptions = {
        intentDesc: askResult.intent?.intentDesc,
        requestedCategory: askResult.intent?.poiSubType || askResult.intent?.category,
        answerType: askResult.intent?.answerType,
        anchors: askResult.intent?.anchors || askResult.intent?.comparisonAnchors || [],
        supportBuckets: askResult.evidence?.supportBuckets || askResult.evidence?.refinedResult?.results?.support_buckets || [],
        supportBucketMetrics: askResult.evidence?.supportBucketMetrics || askResult.evidence?.refinedResult?.results?.support_bucket_metrics || [],
        representativePois: askResult.evidence?.representativePois || askResult.evidence?.refinedResult?.results?.representative_pois || [],
        populationMetrics: askResult.evidence?.populationMetrics || askResult.evidence?.refinedResult?.results?.population_metrics || null,
        comparisonRegions: askResult.evidence?.comparisonRegions || askResult.evidence?.refinedResult?.results?.comparison_regions || [],
        uncertainty: askResult.evidence?.uncertainty || askResult.evidence?.refinedResult?.results?.uncertainty || null,
        anchorLabel: askResult.anchor?.resolvedPlaceName
          || askResult.intent?.placeName
          || (askResult.intent?.anchorMode === 'context'
            ? (hasCustomArea ? '当前圈定区域' : '当前视图')
            : '当前范围'),
        anchorMode: askResult.intent?.anchorMode,
        analysisFacets: askResult.intent?.analysisFacets,
        hasCustomArea
      };

      if (askResult.results.length === 0) {
        sendEvent('text', { content: buildSpatialAnswerFallback(userQuery, askResult.results, answerOptions) });
      } else {
        let streamedAnswer = '';
        const finalAnswer = await generateAnswerStream(
          userQuery,
          askResult.results,
          (content) => {
            if (content && content.trim()) {
              streamedAnswer += content;
              sendEvent('text', { content });
            }
          },
          answerOptions
        );

        if (!streamedAnswer.trim()) {
          const fallbackAnswer = finalAnswer?.trim() || buildSpatialAnswerFallback(userQuery, askResult.results, answerOptions);
          if (fallbackAnswer) {
            sendEvent('text', { content: fallbackAnswer });
          }
        }
      }

      sendEvent('done', withEventMeta({ duration_ms: Date.now() - startTime }));
      reply.raw.end();
      return;
    }

    // ========== 普通聊天：流式 LLM ==========
    console.log('[V3 Chat] General chat, streaming LLM...');

    sendEvent('stage', withEventMeta({
      name: isGreetingQuery ? 'smalltalk' : 'general_qa',
      label: isAssistantMeta ? '能力问答' : '普通对话',
      hint: isAssistantMeta ? '正在整理助手说明...' : '正在整理回答...'
    }));

    // 阶段 2：答案生成（流式）
    sendEvent('stage', withEventMeta({ name: 'answer', label: '答案生成', hint: '正在思考回答...' }));
    sendEvent('thinking', withEventMeta({
      status: 'start',
      message: isGreetingQuery
        ? '已识别为普通问候，正在组织简短回应...'
        : isAssistantMeta
          ? '已识别为助手身份/能力问答，正在生成稳定说明...'
          : '已识别为普通对话，正在整理回答...'
    }));
    sendEvent('reasoning', withEventMeta({
      content: buildGeneralReasoningOutline({
        userQuery,
        isGreeting: isGreetingQuery,
        isAssistantMeta
      })
    }));
    sendEvent('thinking', withEventMeta({ status: 'end', message: '思路整理完成' }));

    if (isGreetingQuery) {
      sendEvent('text', { content: buildGreetingReply(userQuery) });
      sendEvent('done', withEventMeta({ duration_ms: Date.now() - startTime }));
      reply.raw.end();
      return;
    }

    if (isAssistantMeta) {
      sendEvent('text', { content: buildAssistantMetaReply(userQuery) });
      sendEvent('done', withEventMeta({ duration_ms: Date.now() - startTime }));
      reply.raw.end();
      return;
    }

    // 构建系统提示（Qwen3 需要使用 /no_think 禁用思考输出）
    const systemPrompt = {
      role: 'system',
      content: `/no_think
你是武汉三镇的地理智能助手。

【回答规则】
1. 直接回答问题，简洁友好
2. 控制在100字以内
3. 用中文回答

【能力范围】
- 武汉地点、交通、美食、景点咨询
- 附近餐厅、咖啡店、酒店推荐

示例：
用户：你好
助手：您好！我是武汉三镇地理助手，可以帮您查询地点、推荐美食。请问有什么可以帮您？`
    };

    const fullMessages = [systemPrompt, ...messages];
    let streamedText = '';

    // 流式调用 LLM
    const finalText = await callLLMStream(
      fullMessages,
      (stage, content) => {
        if (content && content.trim()) {
          streamedText += content;
          sendEvent('text', { content });
        }
      },
      {
        temperature: 0.7,
        maxTokens: 1024,
      }
    );

    if (!streamedText.trim()) {
      const fallbackText = (typeof finalText === 'string' && finalText.trim())
        || '抱歉，我这次没有稳定生成回答。你可以换个说法再问我，或直接问武汉地点、交通、周边和空间分析相关问题。';
      sendEvent('text', { content: fallbackText });
    }

    sendEvent('done', withEventMeta({ duration_ms: Date.now() - startTime }));
    reply.raw.end();

  } catch (error) {
    console.error('[V3 Chat] Error:', error.message);
    sendEvent('error', withEventMeta({ message: error.message }));
    reply.raw.end();
  }
});

fastify.post('/api/planner/demo', async (request, reply) => {
  try {
    return await plannerDemoService.runChatRequest(request.body || {});
  } catch (error) {
    fastify.log.error(error);
    return reply.code(400).send({
      success: false,
      backend: 'planner_line_prototype',
      error: error.message
    });
  }
});

// 模板反馈（前端遥测需要）
fastify.post('/api/ai/template-feedback', async () => {
  // V3 暂不存储，直接返回成功
  return { ok: true, stored: false, reason: 'V3 uses local model, no telemetry storage' };
});

// 模型列表
fastify.get('/api/ai/models', async () => {
  const ollamaStatus = await getOllamaStatus();

  if (!ollamaStatus.running) {
    return { provider: 'none', models: [] };
  }

  return {
    provider: 'ollama',
    models: ollamaStatus.models.map(name => ({
      id: name,
      name: name.replace(':latest', ''),
    })),
  };
});

// ============================================
// 空间查询处理函数
// ============================================

async function legacyHandleSpatialQuery(userQuery, { poiFeatures = [], spatialContext = null, intent = null, traceId = null } = {}) {
  const resolvedIntent = intent || await parseIntent(userQuery);
  console.log(`[Chat] Intent: ${JSON.stringify(resolvedIntent)}`);

  const anchor = deriveSpatialAnchor({
    poiFeatures,
    spatialContext,
    fallbackAnchor: DEFAULT_SPATIAL_ANCHOR
  });

  const faissStatus = getIndexStatus();
  let candidateResults = [];

  if (faissStatus.loaded) {
    candidateResults = await faissHybridSearch({
      anchor,
      radius: resolvedIntent.radiusM || 500,
      categories: resolvedIntent.category ? [resolvedIntent.category] : [],
      topK: 50,
      targetRegion: resolvedIntent.regionLabel,
    });
  }

  const filteredResults = candidateResults.length > 0
    ? await filterCandidatesWithSmallLLM(userQuery, resolvedIntent, candidateResults)
    : [];
  const runtimeEnrichment = await enrichResultsWithSpatialEncoder({
    anchor,
    results: filteredResults
  });
  const enrichedResults = runtimeEnrichment.results;

  const surfaceQueryWkt = buildSurfaceQueryWkt({
    spatialContext,
    filteredResults: enrichedResults
  });
  const surfaceContextData = surfaceQueryWkt
    ? await fetchSurfaceContext({ queryWkt: surfaceQueryWkt })
    : null;
  const selectedSurfaceConstraint = surfaceContextData
    ? selectVectorConstraintContext(enrichedResults, surfaceContextData)
    : null;
  const refinedSurfaceConstraint = (surfaceQueryWkt && selectedSurfaceConstraint)
    ? await refineSurfaceConstraintGeometry({
        queryWkt: surfaceQueryWkt,
        constraint: selectedSurfaceConstraint
      })
    : null;

  const evidence = buildSpatialEvidence({
    traceId,
    userQuery,
    intent: resolvedIntent,
    anchor,
    candidateResults,
    filteredResults: enrichedResults,
    spatialContext,
    poiFeatures,
    surfaceContext: surfaceContextData,
    surfaceConstraint: refinedSurfaceConstraint || selectedSurfaceConstraint
  });

  return {
    intent: resolvedIntent,
    anchor,
    candidateResults,
    results: enrichedResults,
    runtimeEnrichment,
    surfaceContext: surfaceContextData,
    surfaceConstraint: refinedSurfaceConstraint || selectedSurfaceConstraint,
    evidence
  };
}

// ============================================
// 健康检查
// ============================================

fastify.get('/health', async () => {
  const faissStatus = getIndexStatus();
  const poolStatus = getPoolStatus();
  const ollamaStatus = await getOllamaStatus();
  const spatialEncoderStatus = await getSpatialEncoderStatus();

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: poolStatus.totalCount > 0 ? 'connected' : 'disconnected',
      faiss: faissStatus.loaded ? `loaded (${faissStatus.poiCount} POIs)` : 'not_loaded',
      ollama: ollamaStatus.running ? `running (${ollamaStatus.models.length} models)` : 'not_running',
      spatial_encoder: spatialEncoderStatus.running ? 'running' : 'not_running',
    },
    faiss: faissStatus,
    pool: poolStatus,
    ollama: ollamaStatus,
    spatialEncoder: spatialEncoderStatus,
  };
});

// ============================================
// 索引管理
// ============================================

fastify.get('/index/status', async () => {
  return getIndexStatus();
});

fastify.post('/index/load', async (request) => {
  const force = request.query.force === 'true';
  await loadEmbeddings(force);
  return { success: true, ...getIndexStatus() };
});

// ============================================
// 空间问答 API
// ============================================

fastify.post('/api/spatial/context', async (request, reply) => {
  const {
    query: userQuery,
    topK = 10,
    poiFeatures = [],
    spatialContext = null,
    intent = null,
    traceId = null
  } = request.body || {};

  if (!userQuery) {
    return reply.code(400).send({ error: 'query is required' });
  }

  try {
    return await buildSpatialRagContext({
      userQuery,
      topK,
      poiFeatures,
      spatialContext,
      intent,
      traceId
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({
      success: false,
      error: error.message
    });
  }
});

fastify.post('/api/ask', async (request, reply) => {
  const { query: userQuery, topK = 10 } = request.body || {};

  if (!userQuery) {
    return reply.code(400).send({ error: 'query is required' });
  }

  const startTime = Date.now();
  const pipeline = { stages: [] };

  try {
    // Stage 1: 意图解析
    const t1 = Date.now();
    console.log(`[Ask] Parsing intent: ${userQuery}`);
    const intent = await parseIntent(userQuery);
    pipeline.stages.push({
      name: 'intent_parsing',
      duration_ms: Date.now() - t1,
      method: intent.method,
    });
    console.log(`[Ask] Intent: ${JSON.stringify(intent)}`);

    // Stage 2: 确定锚点
    let anchor = null;
    if (intent.placeName) {
      // 地理编码（简化版：使用默认锚点或解析结果）
      // TODO: 集成地理编码服务
      anchor = { lon: 114.355, lat: 30.538, source: 'geocoder' };
    }

    // 如果没有锚点，使用默认位置
    if (!anchor) {
      anchor = { lon: 114.3055, lat: 30.5931, source: 'default' };
    }

    // Stage 3: 混合检索
    const t2 = Date.now();
    const faissStatus = getIndexStatus();
    const queryEmbedding = await buildSpatialQueryEmbedding({
      userQuery,
      intent,
      anchor
    });
    const hybridSearchOptions = buildQueryEmbeddingSearchOptions(queryEmbedding);

    let results = [];
    if (faissStatus.loaded) {
      results = await faissHybridSearch({
        anchor,
        radius: intent.radiusM || 500,
        categories: intent.category ? [intent.category] : [],
        topK: 50,
        targetRegion: intent.regionLabel,
        ...hybridSearchOptions,
      });
    }
    pipeline.stages.push({
      name: 'hybrid_search',
      duration_ms: Date.now() - t2,
      result_count: results.length,
      method: 'faiss',
      query_embedding_applied: queryEmbedding.applied,
      query_embedding_reason: queryEmbedding.reason,
      query_embedding_source: queryEmbedding.source,
      query_embedding_dim: queryEmbedding.embeddingDim,
    });

    if (results.length === 0) {
      return {
        success: true,
        query: userQuery,
        intent,
        total: 0,
        answer: '抱歉，在指定范围内没有找到相关的地点。',
        results: [],
        pipeline,
        total_duration_ms: Date.now() - startTime,
      };
    }

    // Stage 4: 语义筛选
    const t3 = Date.now();
    const filteredResults = await filterCandidatesWithSmallLLM(userQuery, intent, results);
    const runtimeEnrichment = await enrichResultsWithSpatialEncoder({
      anchor,
      results: filteredResults
    });
    const enrichedResults = runtimeEnrichment.results;
    pipeline.stages.push({
      name: 'semantic_filter',
      duration_ms: Date.now() - t3,
      input_count: results.length,
      output_count: enrichedResults.length,
      encoder_enrichment_applied: runtimeEnrichment.applied,
      encoder_enrichment_reason: runtimeEnrichment.reason,
    });

    // Stage 5: 答案生成
    const t4 = Date.now();
    const answer = await generateAnswer(userQuery, enrichedResults, null, intent.intentDesc);
    pipeline.stages.push({
      name: 'answer_generation',
      duration_ms: Date.now() - t4,
    });

    return {
      success: true,
      query: userQuery,
      intent,
      anchor,
      query_embedding: {
        applied: queryEmbedding.applied,
        reason: queryEmbedding.reason,
        source: queryEmbedding.source,
        embedding_dim: queryEmbedding.embeddingDim,
      },
      total: enrichedResults.length,
      answer,
      results: enrichedResults.slice(0, topK).map(r => ({
        id: r.id,
        name: r.name,
        category: r.category,
        regionLabel: r.regionLabel ?? r.spatial_info?.region_idx ?? null,
        spatial_info: r.spatial_info || null,
        distance_m: Math.round(r.distance_m),
        scores: {
          spatial: r.spatial_score,
          semantic: r.semantic_score,
          fused: r.fused_score,
        },
      })),
      pipeline,
      total_duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[Ask] Error:', error.message);
    return reply.code(500).send({
      success: false,
      error: error.message,
      pipeline,
    });
  }
});

// ============================================
// 混合检索 API
// ============================================

fastify.post('/api/search', async (request, reply) => {
  const {
    anchor,
    radius = 1000,
    categories = [],
    topK = 20,
  } = request.body || {};

  if (!anchor || anchor.lon == null || anchor.lat == null) {
    return reply.code(400).send({ error: 'anchor with lon/lat is required' });
  }

  const startTime = Date.now();
  const faissStatus = getIndexStatus();

  if (!faissStatus.loaded) {
    return reply.code(503).send({ error: 'Index not loaded' });
  }

  try {
    const results = await faissHybridSearch({
      anchor,
      radius,
      categories,
      topK,
    });

    return {
      success: true,
      total: results.length,
      duration_ms: Date.now() - startTime,
      results: results.map(r => ({
        id: r.id,
        name: r.name,
        category: r.category,
        distance_m: Math.round(r.distance_m),
        scores: {
          spatial: r.spatial_score,
          semantic: r.semantic_score,
          fused: r.fused_score,
        },
      })),
    };
  } catch (error) {
    return reply.code(500).send({ error: error.message });
  }
});

fastify.get('/api/search/quick', async (request, reply) => {
  const startTime = Date.now();
  const { q, lat, lon, radius = 5000, limit = 100, geometry } = request.query || {};

  if (!q || !String(q).trim()) {
    return reply.code(400).send({ error: '缺少搜索关键词 q' });
  }

  const queryText = String(q).trim();
  if (!isSimpleQuery(queryText)) {
    return {
      success: true,
      isComplex: true,
      message: '该查询需要 AI 辅助理解，请使用 AI 助手',
      pois: []
    };
  }

  try {
    const rows = await quickSearchPois({
      queryText,
      lat,
      lon,
      radius,
      limit,
      geometry,
      preferPrefix: true
    });

    const features = rows
      .map((row) => toSpatialPoiFeature(row))
      .filter(Boolean)
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          rating: null,
          distance_m: rows.find((row) => row.id === feature.properties.id)?.distance_m ?? null,
          _groupIndex: 0
        }
      }));

    return {
      success: true,
      isComplex: false,
      query: queryText,
      expandedTerms: expandSearchTerms(queryText),
      count: features.length,
      duration_ms: Date.now() - startTime,
      pois: features
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({
      success: false,
      error: error.message
    });
  }
});

fastify.post('/api/spatial/fetch', async (request, reply) => {
  const { categories = [], bounds = null, geometry = null, limit = 100, anchor = null, radius = 1000 } = request.body || {};

  try {
    const rows = await findPOIsFiltered({
      categories: Array.isArray(categories) ? categories : [],
      bounds,
      geometry,
      limit,
      anchor,
      radius
    });

    const features = rows.map((row) => toSpatialPoiFeature(row)).filter(Boolean);

    return {
      success: true,
      count: features.length,
      features
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({
      success: false,
      error: 'Fetch failed',
      details: error.message
    });
  }
});

// ============================================
// 启动服务
// ============================================

const PORT = parseInt(process.env.PORT || '3300');
let isShuttingDown = false

async function shutdown(signal = 'SIGTERM') {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(`[V3] Received ${signal}, shutting down...`)

  await Promise.allSettled([
    stopManagedLlamaCppServices(),
    closeDb(),
    fastify.close()
  ])

  process.exit(0)
}

async function start() {
  try {
    const ollamaEnabled = process.env.USE_OLLAMA !== 'false';

    // 启动 PostgreSQL Docker 容器
    console.log('[Startup] Checking PostgreSQL Docker container...');
    const pgStarted = await ensurePostgreSQLRunning();
    if (pgStarted) {
      console.log('[Startup] PostgreSQL is ready');
    } else {
      console.warn('[Startup] PostgreSQL container not available (assuming external DB)');
    }

    // 启动 Ollama 服务
    if (ollamaEnabled) {
      console.log('[Startup] Starting Ollama service...');
      const ollamaStarted = await startOllama();
      if (ollamaStarted) {
        console.log('[Startup] Ollama service started');
      } else {
        console.warn('[Startup] Ollama service not available (will use LM Studio as fallback)');
      }
    } else {
      console.log('[Startup] Ollama disabled by USE_OLLAMA=false, skipping startup');

      const llamaCppResult = await startManagedLlamaCppServices({
        env: process.env
      })

      if (llamaCppResult.enabled) {
        const startedKeys = llamaCppResult.startedServices.map((item) => item.key).join(', ')
        const reusedKeys = llamaCppResult.reusedServices.map((item) => item.key).join(', ')
        const failedKeys = llamaCppResult.failedServices.map((item) => item.key).join(', ')

        if (startedKeys) {
          console.log(`[Startup] Managed llama.cpp started: ${startedKeys}`)
        }
        if (reusedKeys) {
          console.log(`[Startup] Managed llama.cpp reused existing services: ${reusedKeys}`)
        }
        if (failedKeys) {
          console.warn(`[Startup] Managed llama.cpp failed for: ${failedKeys}`)
        }
      } else {
        console.log('[Startup] Managed llama.cpp autostart disabled or not configured')
      }
    }

    // 预加载 FAISS 索引
    console.log('[Startup] Pre-loading FAISS index...');
    console.log('[Startup] Starting Spatial Encoder service...');
    const spatialEncoderStarted = await startSpatialEncoder();
    if (spatialEncoderStarted) {
      console.log('[Startup] Spatial Encoder service started');
    } else {
      console.warn('[Startup] Spatial Encoder service not available (will lazy-start on demand)');
    }

    await loadEmbeddings();
    console.log('[Startup] FAISS index loaded');

    // 启动 HTTP 服务
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[V3] Server listening at http://127.0.0.1:${PORT}`);
    console.log(`[V3] Health check: http://127.0.0.1:${PORT}/health`);
    console.log(`[V3] Chat API: POST http://127.0.0.1:${PORT}/api/ai/chat`);
    console.log(`[V3] Spatial Ask API: POST http://127.0.0.1:${PORT}/api/ask`);
  } catch (err) {
    fastify.log.error(err);
    await stopManagedLlamaCppServices()
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGTERM', async () => {
  await shutdown('SIGTERM');
});

process.on('SIGINT', async () => {
  await shutdown('SIGINT');
});

process.on('SIGBREAK', async () => {
  await shutdown('SIGBREAK');
});

process.on('exit', () => {
  stopManagedLlamaCppServicesSync()
});

start();
