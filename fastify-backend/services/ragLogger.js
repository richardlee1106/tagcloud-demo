/**
 * RAG 日志服务
 * 记录每次 Spatial-RAG 调用的详细信息，用于可解释性和调试
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日志目录
const LOG_DIR = path.resolve(__dirname, '../../RAG_LOG');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function toSafeTokenCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.round(numeric);
}

function normalizeTokenUsageShape(usage) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const prompt = toSafeTokenCount(usage.prompt_tokens);
  const completion = toSafeTokenCount(usage.completion_tokens);
  const explicitTotal = toSafeTokenCount(usage.total_tokens);
  const total = explicitTotal > 0 ? explicitTotal : (prompt + completion);

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total
  };
}

function appendTextFile(filePath, content, { withBomOnCreate = false } = {}) {
  if (withBomOnCreate) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '\uFEFF', 'utf-8');
    } else {
      const stat = fs.statSync(filePath);
      if (stat.size === 0) {
        fs.writeFileSync(filePath, '\uFEFF', 'utf-8');
      } else {
        const header = Buffer.alloc(3);
        const fd = fs.openSync(filePath, 'r');
        try {
          const bytesRead = fs.readSync(fd, header, 0, 3, 0);
          const hasUtf8Bom = bytesRead === 3
            && header[0] === 0xEF
            && header[1] === 0xBB
            && header[2] === 0xBF;
          if (!hasUtf8Bom) {
            const existing = fs.readFileSync(filePath);
            const withBom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), existing]);
            fs.writeFileSync(filePath, withBom);
          }
        } finally {
          fs.closeSync(fd);
        }
      }
    }
  }

  fs.appendFileSync(filePath, content, 'utf-8');
}

function resolvePoiName(poi = {}) {
  const props = poi?.properties && typeof poi.properties === 'object' ? poi.properties : {};
  return props['\u540d\u79f0'] || props.name || poi.name || '\u672a\u77e5';
}

function resolvePoiCategory(poi = {}) {
  const props = poi?.properties && typeof poi.properties === 'object' ? poi.properties : {};
  const candidates = [
    props['\u5c0f\u7c7b'],
    props['\u4e2d\u7c7b'],
    props['\u5927\u7c7b'],
    props.category_small,
    props.category_mid,
    props.category_big,
    props.categorySmall,
    props.categoryMid,
    props.categoryBig,
    poi.category_small,
    poi.category_mid,
    poi.category_big,
    poi.categorySmall,
    poi.categoryMid,
    poi.categoryBig,
    props.category,
    poi.category,
    props.type,
    poi.type
  ];

  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text) return text;
  }

  return '\u672a\u5206\u7c7b';
}

function resolvePoiDistance(poi = {}) {
  return poi.distance ?? poi.distance_m ?? null;
}

/**
 * RAG 会话日志类
 * 每次对话创建一个实例，记录整个检索和生成过程
 */
class RAGSession {
  constructor(sessionId = null) {
    this.sessionId = sessionId || this.generateSessionId();
    this.startTime = new Date();
    this.logs = [];
    this.summary = {
      userQuery: '',
      parsedIntent: null,
      vectorCalled: false,
      postgisCalled: false,
      totalPOIsRetrieved: 0,
      tokenStats: {
        planner: 0,
        writer: 0,
        total: 0,
        details: []
      },
      tokensEstimated: 0,
      success: false
    };
    this.retrievedPOIs = [];
  }

  generateSessionId() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `${date}_${time}_${random}`;
  }

  /**
   * 记录日志条目
   */
  log(component, action, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      component,   // 'Milvus' | 'PostGIS' | 'LLM' | 'Geocoder' | 'Fusion'
      action,      // 具体操作名称
      details,     // 详细参数和结果
      duration: null
    };
    this.logs.push(entry);
    
    // 更新摘要
    if (component === 'Vector' || component === 'pgvector' || component === 'Milvus') {
      this.summary.vectorCalled = true;
    }
    if (component === 'PostGIS') this.summary.postgisCalled = true;
    
    console.log(`[RAG-${this.sessionId}] [${component}] ${action}`);
    return entry;
  }

  /**
   * 记录带耗时的操作
   */
  async logAsync(component, action, asyncFn, details = {}) {
    const entry = this.log(component, action, details);
    const startTime = Date.now();
    
    try {
      const result = await asyncFn();
      entry.duration = Date.now() - startTime;
      entry.details.result = this.summarizeResult(result);
      return result;
    } catch (error) {
      entry.duration = Date.now() - startTime;
      entry.details.error = error.message;
      throw error;
    }
  }

  /**
   * 精简结果用于日志（避免日志过大）
   */
  summarizeResult(result) {
    if (Array.isArray(result)) {
      return { count: result.length, sample: result.slice(0, 3) };
    }
    if (typeof result === 'object' && result !== null) {
      return { keys: Object.keys(result) };
    }
    return result;
  }

  /**
   * 设置用户查询
   */
  setUserQuery(query) {
    this.summary.userQuery = query;
    this.log('Session', 'UserQuery', { query });
  }

  /**
   * 设置解析后的意图
   */
  setIntent(intent) {
    this.summary.parsedIntent = intent;
    this.log('LLM', 'IntentParsed', { intent });
  }

  /**
   * 添加检索到的 POI
   */
  addRetrievedPOIs(pois, source) {
    const poiSummary = pois.map(p => ({
      name: resolvePoiName(p),
      category: resolvePoiCategory(p),
      distance: resolvePoiDistance(p),
      score: p.score ?? p.semantic_score ?? p.hybrid_score ?? null
    }));
    
    this.retrievedPOIs.push({ source, pois: poiSummary });
    this.summary.totalPOIsRetrieved += pois.length;
    this.log(source, 'POIsRetrieved', { count: pois.length });
  }

  /**
   * 设置最终使用的 POI（融合后）
   */
  setFinalPOIs(pois) {
    this.rawFinalPOIs = pois; // 保存原始数据（含坐标）
    this.finalPOIs = pois.map(p => ({
      name: resolvePoiName(p),
      category: resolvePoiCategory(p),
      distance: resolvePoiDistance(p)
    }));
    this.log('Fusion', 'FinalPOIs', { count: pois.length });
  }

  getFinalPOIs() {
    return this.rawFinalPOIs || [];
  }

  /**
   * 设置空间边界 (GeoJSON)
   */
  setSpatialBoundary(boundary) {
    this.spatialBoundary = boundary;
    this.log('Fusion', 'BoundarySet', { type: boundary.type });
  }

  getSpatialBoundary() {
    return this.spatialBoundary || null;
  }
  
  /**
   * 设置空间聚类数据
   */
  setSpatialClusters(clusters) {
    this.spatialClusters = clusters;
    this.log('Clustering', 'SpatialClustersSet', { count: clusters?.length || 0 });
  }
  
  getSpatialClusters() {
    return this.spatialClusters || [];
  }
  
  /**
   * 设置语义模糊区域数据
   */
  setVernacularRegions(regions) {
    this.vernacularRegions = regions;
    this.log('Clustering', 'VernacularRegionsSet', { count: regions?.length || 0 });
  }
  
  getVernacularRegions() {
    return this.vernacularRegions || [];
  }
  
  /**
   * 设置模糊区域数据（三层边界模型）
   */
  setFuzzyRegions(regions) {
    this.fuzzyRegions = regions;
    this.log('FuzzyRegion', 'FuzzyRegionsSet', { count: regions?.length || 0 });
  }
  
  getFuzzyRegions() {
    return this.fuzzyRegions || [];
  }

  setServiceUsage({ vectorCalled = false, postgisCalled = false } = {}) {
    if (vectorCalled) {
      this.summary.vectorCalled = true;
    }
    if (postgisCalled) {
      this.summary.postgisCalled = true;
    }
  }

  ingestExecutionStats(stats = {}, diagnostics = {}) {
    const normalizedStats = stats && typeof stats === 'object' ? stats : {};
    const normalizedDiagnostics = diagnostics && typeof diagnostics === 'object' ? diagnostics : {};

    const candidateSource = String(
      normalizedStats.candidate_source || normalizedDiagnostics.candidate_source || ''
    ).trim().toLowerCase();
    const roadSource = String(
      normalizedStats.road_source || normalizedDiagnostics.road_source || ''
    ).trim().toLowerCase();
    const landuseSource = String(
      normalizedStats.landuse_source || normalizedDiagnostics.landuse_source || ''
    ).trim().toLowerCase();
    const executorEngine = String(
      normalizedStats.executor_engine || normalizedDiagnostics.engine || ''
    ).trim().toLowerCase();
    const computeMode = String(normalizedDiagnostics.compute_mode || '').trim().toLowerCase();
    const pyDataSource = String(
      normalizedDiagnostics?.migration?.py_data_source
      || normalizedDiagnostics?.source_policy?.py_data_source
      || normalizedStats.py_data_source
      || ''
    ).trim().toLowerCase();
    const vectorUsedFlag =
      normalizedStats.vector_used === true
      || normalizedDiagnostics?.vector_retrieval?.used === true;

    const postgisCalled = (
      candidateSource === 'db'
      || roadSource === 'db'
      || landuseSource === 'db'
      || pyDataSource === 'python'
      || executorEngine.includes('python')
      || computeMode.includes('python')
      || computeMode.includes('cache_hit')
    );
    const vectorCalled = vectorUsedFlag || [candidateSource, executorEngine, pyDataSource]
      .some((value) => value.includes('vector') || value.includes('milvus') || value.includes('pgvector'));

    this.setServiceUsage({ vectorCalled, postgisCalled });

    const tokenUsageRoot = normalizedStats.token_usage && typeof normalizedStats.token_usage === 'object'
      ? normalizedStats.token_usage
      : {};

    const plannerUsage = normalizeTokenUsageShape(
      tokenUsageRoot.planner
      || normalizedStats.planner_token_usage
      || normalizedDiagnostics?.planner?.token_usage
      || null
    );
    const writerUsage = normalizeTokenUsageShape(
      tokenUsageRoot.writer
      || normalizedStats.writer_token_usage
      || normalizedDiagnostics?.writer?.token_usage
      || null
    );

    if (plannerUsage) {
      this.addTokenUsage('planner', plannerUsage);
    }
    if (writerUsage) {
      this.addTokenUsage('writer', writerUsage);
    }
  }

  /**
   * 添加 Token 消耗统计
   * @param {string} source - 'planner' | 'writer'
   * @param {Object} usage - { prompt_tokens, completion_tokens, total_tokens }
   */
  addTokenUsage(source, usage) {
    if (!usage) return;
    
    // Ensure numeric token fields are safe to accumulate.
    const total = toSafeTokenCount(usage.total_tokens);
    const prompt = toSafeTokenCount(usage.prompt_tokens);
    const completion = toSafeTokenCount(usage.completion_tokens);
    
    this.summary.tokenStats.total += total;
    
    if (source.toLowerCase().includes('planner')) {
      this.summary.tokenStats.planner += total;
    } else if (source.toLowerCase().includes('writer')) {
      this.summary.tokenStats.writer += total;
    }
    
    this.summary.tokenStats.details.push({
      source,
      timestamp: new Date().toISOString(),
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total
    });
    
    this.log('TokenUsage', source, { total, prompt, completion });
  }

  /**
   * 估算 Token 消耗（兼容旧接口，但也返回实际值）
   */
  estimateTokens(contextLength) {
    // 如果有实际统计值，优先使用
    if (this.summary.tokenStats.total > 0) {
      return this.summary.tokenStats.total;
    }
    // 否则粗略估算：中文约 2 字符 = 1 token
    this.summary.tokensEstimated = Math.ceil(contextLength / 2);
    return this.summary.tokensEstimated;
  }

  /**
   * 标记会话成功
   */
  markSuccess() {
    this.summary.success = true;
  }

  /**
   * 保存日志到文件
   */
  save() {
    const endTime = new Date();
    const totalDuration = endTime - this.startTime;

    const logContent = {
      sessionId: this.sessionId,
      timestamp: {
        start: this.startTime.toISOString(),
        end: endTime.toISOString(),
        durationMs: totalDuration
      },
      summary: this.summary,
      logs: this.logs,
      retrievedPOIs: this.retrievedPOIs,
      finalPOIs: this.finalPOIs || [],
      
      // 用于快速查看的格式化摘要
      readableSummary: this.generateReadableSummary()
    };

    // 按日期分组日志文件
    const dateStr = this.startTime.toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `RAG_${dateStr}.jsonl`);
    
    // 使用 JSONL 格式（每行一个 JSON）
    appendTextFile(logFile, JSON.stringify(logContent) + '\n');
    
    // 同时生成人类可读的 Markdown 日志
    const mdFile = path.join(LOG_DIR, `RAG_${dateStr}.md`);
    appendTextFile(mdFile, this.generateMarkdownLog() + '\n---\n\n', { withBomOnCreate: true });

    console.log(`[RAG-${this.sessionId}] 日志已保存至 RAG_LOG/`);
    return logFile;
  }

  /**
   * 生成可读摘要
   */
  generateReadableSummary() {
    const parts = [];
    parts.push(`User Query: "${this.summary.userQuery || ''}"`);

    if (this.summary.parsedIntent) {
      const intent = this.summary.parsedIntent;
      const queryType = intent.query_type || intent.intent_mode || 'unknown';
      const categories = Array.isArray(intent.categories)
        ? intent.categories.slice(0, 6).join(', ')
        : '';
      parts.push(`Intent: query_type=${queryType}${categories ? `, categories=${categories}` : ''}`);
    }

    const services = [];
    if (this.summary.vectorCalled) services.push('Vector');
    if (this.summary.postgisCalled) services.push('PostGIS');
    parts.push(`Services: ${services.length ? services.join(' + ') : 'none'}`);
    parts.push(`Retrieved POIs: ${this.summary.totalPOIsRetrieved}`);

    const stats = this.summary.tokenStats || { total: 0, planner: 0, writer: 0 };
    const retrievalMode = this.summary.vectorCalled && this.summary.postgisCalled
      ? 'hybrid'
      : (this.summary.vectorCalled ? 'vector_only' : (this.summary.postgisCalled ? 'postgis_only' : 'none'));
    if (stats.total > 0) {
      parts.push(`Tokens: total=${stats.total}, planner=${stats.planner}, writer=${stats.writer}`);
    } else {
      parts.push(`Tokens (estimated): ${this.summary.tokensEstimated || 0}`);
    }

    const stageTrace = this.logs
      .filter((item) => item.component === 'Pipeline' && item.action === 'Stage')
      .map((item) => item.details?.stage)
      .filter(Boolean);
    if (stageTrace.length) {
      parts.push(`Stage Path: ${stageTrace.join(' -> ')}`);
    }

    const failureDiagnosticsEntry = [...this.logs]
      .reverse()
      .find((item) => item.component === 'Pipeline' && item.action === 'FailureDiagnostics');
    const failureDiagnostics = failureDiagnosticsEntry?.details || null;
    if (failureDiagnostics && typeof failureDiagnostics === 'object') {
      if (failureDiagnostics.error_code) {
        parts.push(`FailureCode: ${failureDiagnostics.error_code}`);
      }
      if (failureDiagnostics.last_stage) {
        parts.push(`LastStage: ${failureDiagnostics.last_stage}`);
      }
      if (failureDiagnostics.error_signature) {
        parts.push(`FailureSignature: ${failureDiagnostics.error_signature}`);
      }
      if (failureDiagnostics.root_cause_hint) {
        parts.push(`FailureHint: ${failureDiagnostics.root_cause_hint}`);
      }
    }

    parts.push(`Result: ${this.summary.success ? 'success' : 'failed'}`);
    return parts.join('\n');
  }

  /**
   * Generate markdown log with clear request timeline and stage path.
   */
  generateMarkdownLog() {
    const startMs = this.startTime.getTime();
    const stageTrace = this.logs
      .filter((item) => item.component === 'Pipeline' && item.action === 'Stage')
      .map((item) => item.details?.stage)
      .filter(Boolean);
    const stageChecklistEntry = [...this.logs]
      .reverse()
      .find((item) => item.component === 'Pipeline' && item.action === 'StageChecklist');
    let stageChecklist = Array.isArray(stageChecklistEntry?.details) ? stageChecklistEntry.details : [];
    if (!stageChecklist.length) {
      const checklistStageEvent = [...this.logs]
        .reverse()
        .find((item) => item.component === 'Pipeline'
          && item.action === 'Stage'
          && item.details?.stage === 'pipeline_stage_checklist'
          && Array.isArray(item.details?.payload?.items));
      stageChecklist = Array.isArray(checklistStageEvent?.details?.payload?.items)
        ? checklistStageEvent.details.payload.items
        : [];
    }
    const stats = this.summary.tokenStats || { total: 0, planner: 0, writer: 0 };
    const retrievalMode = this.summary.vectorCalled && this.summary.postgisCalled
      ? 'hybrid'
      : (this.summary.vectorCalled ? 'vector_only' : (this.summary.postgisCalled ? 'postgis_only' : 'none'));

    const compactDetails = (details) => {
      if (details == null) return '';
      let text = '';
      if (typeof details === 'string') {
        text = details;
      } else {
        try {
          text = JSON.stringify(details);
        } catch {
          text = '[unserializable]';
        }
      }
      text = text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      return text.length > 140 ? `${text.slice(0, 140)}...` : text;
    };

    let md = `## RAG Session: ${this.sessionId}\n\n`;
    md += `### Request Overview\n`;
    md += `- Start: ${this.startTime.toLocaleString('zh-CN')}\n`;
    md += `- Log entries: ${this.logs.length}\n`;
    md += `- Status: ${this.summary.success ? 'success' : 'failed'}\n`;
    md += `- Retrieved POIs: ${this.summary.totalPOIsRetrieved}\n`;
    md += `- Tokens: ${stats.total || this.summary.tokensEstimated || 0}\n\n`;

    md += `### User Query\n> ${this.summary.userQuery || '(empty)'}\n\n`;

    if (this.summary.parsedIntent) {
      md += `### Parsed Intent\n\`\`\`json\n${JSON.stringify(this.summary.parsedIntent, null, 2)}\n\`\`\`\n\n`;
    }

    md += `### Stage Path\n`;
    if (stageTrace.length) {
      stageTrace.forEach((stage, idx) => {
        md += `${idx + 1}. ${stage}\n`;
      });
    } else {
      md += `- no stage events\n`;
    }
    md += '\n';

    const failureDiagnosticsEntry = [...this.logs]
      .reverse()
      .find((item) => item.component === 'Pipeline' && item.action === 'FailureDiagnostics');
    if (failureDiagnosticsEntry?.details && typeof failureDiagnosticsEntry.details === 'object') {
      md += `### Failure Diagnostics\n`;
      md += `\`\`\`json\n${JSON.stringify(failureDiagnosticsEntry.details, null, 2)}\n\`\`\`\n\n`;
    }

    if (stageChecklist.length > 0) {
      const escapeCell = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `### Stage Checklist\n`;
      md += `| Stage | Status | Details |\n`;
      md += `|---|---|---|\n`;
      stageChecklist.forEach((item) => {
        const label = escapeCell(item?.label || item?.key || 'unknown');
        const explicitStatus = String(item?.status || '').trim().toUpperCase();
        const status = ['PASS', 'WARN', 'FAIL'].includes(explicitStatus)
          ? explicitStatus
          : (item?.ok === true ? 'PASS' : 'FAIL');
        const details = [];
        if (item?.model) details.push(`model=${item.model}`);
        if (Number.isFinite(Number(item?.extracted_count))) details.push(`extracted=${Number(item.extracted_count)}`);
        if (Array.isArray(item?.extracted_texts) && item.extracted_texts.length > 0) {
          details.push(`texts=${item.extracted_texts.slice(0, 8).join(', ')}`);
        }
        if (item?.summary) {
          const summaryText = String(item.summary);
          details.push(`summary=${summaryText.length > 80 ? `${summaryText.slice(0, 80)}...` : summaryText}`);
        }
        if (item?.fallback_used === true) details.push(`fallback=${item?.fallback_reason || 'true'}`);
        if (item?.mode) details.push(`mode=${item.mode}`);
        md += `| ${label} | ${status} | ${escapeCell(details.join('; ') || '-')} |\n`;
      });
      md += '\n';
    }

    md += `### Event Timeline\n`;
    md += `| Offset(ms) | Component | Action | Details |\n`;
    md += `|---:|---|---|---|\n`;
    this.logs.forEach((log) => {
      const ts = Date.parse(log.timestamp);
      const offset = Number.isFinite(ts) ? Math.max(0, ts - startMs) : 0;
      md += `| ${offset} | ${log.component} | ${log.action} | ${compactDetails(log.details)} |\n`;
    });
    md += '\n';

    if (this.finalPOIs && this.finalPOIs.length > 0) {
      md += `### Final POIs (Top 20)\n`;
      md += `| Name | Category | Distance |\n|---|---|---|\n`;
      this.finalPOIs.slice(0, 20).forEach((poi) => {
        const dist = poi.distance ? `${Math.round(poi.distance)}m` : '-';
        md += `| ${poi.name} | ${poi.category} | ${dist} |\n`;
      });
      if (this.finalPOIs.length > 20) {
        md += `| ... total ${this.finalPOIs.length} items | | |\n`;
      }
      md += '\n';
    }

    md += `### Stats\n`;
    md += `- Retrieval mode: ${retrievalMode}\n`;
    md += `- Vector used: ${this.summary.vectorCalled ? 'yes' : (retrievalMode === 'postgis_only' ? 'no (postgis_only)' : 'no')}\n`;
    md += `- PostGIS used: ${this.summary.postgisCalled ? 'yes' : 'no'}\n`;
    md += `- Token breakdown: total=${stats.total}, planner=${stats.planner}, writer=${stats.writer}\n`;

    return md;
  }
}

/**
 * 创建新的 RAG 会话
 */
export function createRAGSession() {
  return new RAGSession();
}

export { RAGSession };

