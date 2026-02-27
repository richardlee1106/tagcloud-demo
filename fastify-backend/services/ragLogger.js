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
    
    // 更新摘要
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
   * 设置用户查询
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
      name: p.properties?.['名称'] || p.name || '未知',
      category: p.properties?.['小类'] || p.properties?.['中类'] || p.category || '未分类',
      distance: p.distance || null,
      score: p.score || null
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
      name: p.properties?.['名称'] || p.name || '未知',
      category: p.properties?.['小类'] || p.properties?.['中类'] || p.category || '未分类',
      distance: p.distance || null
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

  /**
   * 添加 Token 消耗统计
   * @param {string} source - 'planner' | 'writer'
   * @param {Object} usage - { prompt_tokens, completion_tokens, total_tokens }
   */
  addTokenUsage(source, usage) {
    if (!usage) return;
    
    // 确保数值存在
    const total = usage.total_tokens || 0;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    
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
   * 估算 Token 消耗 (兼容旧接口，但也返回实际值)
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
    fs.appendFileSync(logFile, JSON.stringify(logContent) + '\n', 'utf-8');
    
    // 同时生成人类可读的 Markdown 日志
    const mdFile = path.join(LOG_DIR, `RAG_${dateStr}.md`);
    fs.appendFileSync(mdFile, this.generateMarkdownLog() + '\n---\n\n', 'utf-8');

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
    const stats = this.summary.tokenStats || { total: 0, planner: 0, writer: 0 };

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
    md += `- Vector used: ${this.summary.vectorCalled ? 'yes' : 'no'}\n`;
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
