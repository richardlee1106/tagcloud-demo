<template>
  <div class="ai-chat-container">
    <!-- 头部状态栏 -->
    <div class="chat-header">
      <div class="header-main-row">
        <!-- 左侧：头像 + 信息 -->
        <div class="header-left">
          <div class="ai-avatar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </div>
          <div class="header-info">
            <span class="ai-name">GeoAI 助手</span>
            <span class="ai-status" :class="{ online: isOnline === true, offline: isOnline === false, probing: isOnline === null }">
              {{ statusText }}
            </span>
          </div>
        </div>
        
        <!-- 右侧：按钮组 -->
        <div class="header-actions">
           <!-- POI 徽章（在按钮组左侧，空间不足时可隐藏） -->
           <div class="poi-badge" v-if="poiCount > 0">
             <span class="poi-icon">📍</span>
             <span>{{ poiCount }}</span>
           </div>
           
           <button class="action-btn clear-btn" @click="clearChat" title="清空">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
             </svg>
           </button>
           <button class="action-btn save-btn" @click="saveChatHistory" title="保存">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
             </svg>
           </button>
           <button class="action-btn close-btn" @click="emit('close')" title="收起">
             <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M18 6L6 18M6 6l12 12" />
             </svg>
           </button>
        </div>
      </div>
    </div>

    <div class="chat-body">
      <div class="chat-messages" ref="messagesContainer">
        <!-- 欢迎消息 -->
        <div v-if="messages.length === 0" class="welcome-message">
          <h3>欢迎使用地名标签云智能分析助手</h3>
          <p>我具备地理感知能力，可以帮您分析选中区域内的 POI 数据，并提供地理分析与洞察参考。</p>
          <div class="quick-actions">
            <button v-for="action in quickActions" :key="action.text" 
                    @click="sendQuickAction(action.prompt)"
                    class="quick-action-btn">
              {{ action.text }}
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-for="(msg, index) in messages" :key="index" class="message" :class="msg.role">
          <div class="message-avatar">
            <template v-if="msg.role === 'user'">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </template>
            <template v-else>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </template>
          </div>
          <div class="message-content">
            <div
              v-if="msg.role === 'assistant' && !isGeneralQaMessage(msg) && (msg.pipelineCompleted || (isTyping && index === messages.length - 1))"
              class="pipeline-tracker-inline"
            >
              <div class="pipeline-trace-inline">
                <template v-for="(step, idx) in stageSteps" :key="step.key">
                  <div
                    class="trace-step-inline"
                    :class="{
                      active: !msg.pipelineCompleted && stageActiveIndex === idx,
                      completed: msg.pipelineCompleted || stageActiveIndex > idx
                    }"
                  >
                    <div class="step-icon-wrapper">
                      <svg v-if="!msg.pipelineCompleted && stageActiveIndex === idx" class="step-spinner" viewBox="0 0 24 24" width="14" height="14">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="32" stroke-linecap="round"/>
                      </svg>
                      <svg v-else-if="msg.pipelineCompleted || stageActiveIndex > idx" class="step-check" viewBox="0 0 16 16" width="12" height="12">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                      </svg>
                      <span v-else class="step-number">{{ idx + 1 }}</span>
                    </div>
                    <span class="step-label-inline">{{ step.label }}</span>
                  </div>
                </template>
              </div>
              <div v-if="!msg.pipelineCompleted && currentStageHint" class="pipeline-hint-inline">{{ currentStageHint }}</div>
              <div v-if="msg.queryType || msg.intentMeta?.intentMode" class="pipeline-intent-inline">
                <span v-if="msg.queryType" class="intent-pill">Type: {{ msg.queryType }}</span>
                <span v-if="msg.intentMeta?.intentMode" class="intent-pill">Mode: {{ msg.intentMeta.intentMode }}</span>
              </div>
            </div>

            <div v-if="msg.content && msg.content.trim()" class="message-text" v-html="renderMessageHtml(msg)"></div>

            <EmbeddedTagCloud 
              v-if="msg.role === 'assistant' && !isGeneralQaMessage(msg) && msg.pois && msg.pois.length > 0"
              :pois="msg.pois"
              :intent-mode="resolveEmbeddedIntentMode(msg)"
              :intent-meta="msg.intentMeta || null"
              :width="360"
              :height="200"
              @render-to-map="handleRenderToMap"
              @tag-click="handleTagClick"
            />

            <div v-if="msg.content && msg.content.trim()" class="message-time">{{ formatTime(msg.timestamp) }}</div>
          </div>
        </div>

        <section
          v-if="latestAssistantMessage && shouldShowAnalysisBoard(latestAssistantMessage)"
          class="analysis-board analysis-board-inline"
          aria-label="空间分析看板"
        >
          <header class="analysis-board-header">
            <div>
              <p class="analysis-kicker">最新回复分析看板</p>
              <h3 class="analysis-title">模板化信息聚合</h3>
            </div>
            <span class="analysis-meta">
              {{ latestAssistantMessage?.timestamp ? formatTime(latestAssistantMessage.timestamp) : '--:--' }}
            </span>
          </header>

          <div class="analysis-board-content">
            <div v-if="analysisNarrativeText" class="analysis-narrative">
              {{ analysisNarrativeText }}
            </div>

            <SpatialEvidenceCard
              v-if="latestAssistantMessage && hasSpatialEvidence(latestAssistantMessage)"
              :clusters="latestAssistantMessage.spatialClusters"
              :vernacular-regions="latestAssistantMessage.vernacularRegions"
              :fuzzy-regions="latestAssistantMessage.fuzzyRegions"
              :analysis-stats="latestAssistantMessage.analysisStats || null"
              :intent-mode="latestAssistantMessage.intentMode || 'macro_overview'"
              :query-type="latestAssistantMessage.queryType || latestAssistantMessage.intentMeta?.queryType || 'area_analysis'"
              :intent-meta="latestAssistantMessage.intentMeta ? { ...latestAssistantMessage.intentMeta, traceId: latestAssistantMessage.traceId } : (latestAssistantMessage.traceId ? { traceId: latestAssistantMessage.traceId } : null)"
              @locate="handleEvidenceLocate"
              @ask-followup="handleEvidenceFollowup"
            />
            <div v-else class="analysis-empty-state">
              <span class="analysis-empty-title">等待空间证据</span>
              <p>当前最新回复尚未返回可聚合的空间结构化结果，继续提问后将自动生成 1-3 个意图模板。</p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="chat-input-area">
      <div class="input-wrapper">
        <textarea 
          ref="inputRef"
          v-model="inputText"
          @keydown.enter.exact.prevent="sendMessage"
          @keydown.shift.enter="insertNewline"
          placeholder="询问关于选中区域 POI 的问题..."
          :disabled="isTyping"
          rows="1"
        ></textarea>
        <button 
          class="send-btn" 
          @click="sendMessage"
          :disabled="!inputText.trim() || isTyping"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div class="input-hint">
        <span v-if="isOnline === null" class="probing-hint">正在检测 AI 服务...</span>
        <span v-else-if="isOnline === false" class="offline-hint">
          AI 服务未连接
          <button class="retry-link" type="button" @click="checkOnlineStatus">重试连接</button>
        </span>
        <span v-else>按 Enter 发送，Shift+Enter 换行</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue';
import { 
  sendChatMessageStream, 
  checkAIService, 
  getCurrentProviderInfo
} from '../utils/aiService.js';
import { normalizeRefinedResultEvidence } from '../utils/refinedResultEvidence.js';
import { useAiStreamDispatcher } from '../composables/ai/useAiStreamDispatcher.js';
import { useSpatialRequestBuilder } from '../composables/ai/useSpatialRequestBuilder.js';
import {
  refreshTemplateWeights,
  trackSessionOutcome
} from '../services/aiTelemetry.js';
import EmbeddedTagCloud from './EmbeddedTagCloud.vue';
import SpatialEvidenceCard from './SpatialEvidenceCard.vue';
import { marked } from 'marked';

const props = defineProps({
  // 当前选中的 POI 数据
  poiFeatures: {
    type: Array,
    default: () => []
  },
  // 是否开启全域感知模式
  globalAnalysisEnabled: {
    type: Boolean,
    default: false
  },
  // 空间边界几何数据
  boundaryPolygon: {
    type: Array,
    default: null
  },
  drawMode: {
    type: String,
    default: ''
  },
  circleCenter: {
    type: [Object, Array],
    default: null
  },
  circleRadius: {
    type: [Number, String],
    default: null
  },
  // 地图视野边界 [minLon, minLat, maxLon, maxLat]
  mapBounds: {
    type: Array,
    default: null
  },
  mapZoom: {
    type: Number,
    default: null
  },
  selectedCategories: {
    type: Array,
    default: () => []
  },
  // 多区数据 (新增)
  regions: {
    type: Array,
    default: () => []
  }
});

// 定义事件
const emit = defineEmits([
  'close',
  'render-to-tagcloud',
  'render-pois-to-map',
  'ai-boundary',
  'ai-spatial-clusters',
  'ai-vernacular-regions',
  'ai-fuzzy-regions',
  'ai-analysis-stats',
  'ai-intent-meta'
]);

// 响应式状态
const messages = ref([]);
const inputText = ref('');
const isTyping = ref(false);
const currentStage = ref(''); // 原始 stage 名称（来自 SSE）
const streamQueue = ref('');

const stageSteps = [
  { key: 'planner', label: '意图处理', hint: '正在理解问题意图与约束...' },
  { key: 'visual', label: '视觉感知', hint: '正在提取视口锚点与视觉形态特征...' },
  { key: 'spatial', label: '空间分析', hint: '正在执行空间检索、聚类与边界建模...' },
  { key: 'fusion', label: '融合校验', hint: '正在进行自校验、知识图谱与置信度融合...' },
  { key: 'writer', label: '组织回答', hint: '正在整理答案并生成可读输出...' }
];

function normalizeStageName(stageName) {
  const raw = String(stageName || '').toLowerCase();
  if (!raw) return '';

  if (raw.includes('planner') || raw.includes('intent')) return 'planner';
  if (raw.includes('visual') || raw.includes('vlm') || raw.includes('ocr') || raw.includes('snapshot')) return 'visual';
  if (raw.includes('fusion') || raw.includes('self_validation') || raw.includes('skg') || raw.includes('validate') || raw.includes('name_audit')) return 'fusion';
  if (raw.includes('writer') || raw.includes('answer') || raw.includes('compose')) return 'writer';
  if (raw.includes('fetch_candidates') || raw.includes('cluster') || raw.includes('region_modeling')) return 'spatial';
  if (raw.includes('executor') || raw.includes('spatial') || raw.includes('compute') || raw.includes('python') || raw.includes('region_comparison')) return 'spatial';

  return '';
}

const normalizedStageKey = computed(() => normalizeStageName(currentStage.value));

const stageActiveIndex = computed(() => {
  const idx = stageSteps.findIndex((step) => step.key === normalizedStageKey.value);
  if (idx >= 0) return idx;
  return isTyping.value ? 0 : -1;
});

const currentStageHint = computed(() => {
  if (stageActiveIndex.value < 0) return '';
  return stageSteps[stageActiveIndex.value]?.hint || '';
});

function toEmbeddedIntentMode(intentMode, queryType = '') {
  const rawMode = String(intentMode || '').trim().toLowerCase();
  const rawType = String(queryType || '').trim().toLowerCase();

  if (rawMode === 'local_search') return 'micro';
  if (rawMode === 'macro_overview') return 'macro';
  if (rawType === 'poi_search') return 'micro';
  if (rawType === 'area_analysis') return 'macro';
  return '';
}

function resolveEmbeddedIntentMode(message) {
  const fromMeta = toEmbeddedIntentMode(
    message?.intentMeta?.intentMode,
    message?.intentMeta?.queryType || message?.queryType
  );
  if (fromMeta) return fromMeta;

  const fromMessage = String(message?.intentMode || '').trim().toLowerCase();
  if (fromMessage === 'micro' || fromMessage === 'macro') return fromMessage;

  return 'macro';
}

function resolveMessageQueryType(message) {
  return String(
    message?.queryType ||
    message?.intentMeta?.queryType ||
    ''
  ).trim().toLowerCase()
}

function resolveMessageIntentMode(message) {
  return String(
    message?.intentMeta?.intentMode ||
    message?.intentMode ||
    ''
  ).trim().toLowerCase()
}

function isGeneralQaMessage(message) {
  const queryType = resolveMessageQueryType(message)
  const intentMode = resolveMessageIntentMode(message)

  if (queryType === 'general_qa' || queryType === 'irrelevant_input') {
    return true
  }

  if (intentMode === 'llm_chat' || intentMode === 'out_of_scope') {
    return true
  }

  return false
}

function shouldShowAnalysisBoard(message) {
  if (!message) return false
  return !isGeneralQaMessage(message)
}
const streamTimer = ref(null);
const activeMessageIndex = ref(-1);
const streamRenderStep = 18;
const streamRenderIntervalMs = 24;
const streamScrollTick = ref(0);
const isOnline = ref(null);
const messagesContainer = ref(null);
const inputRef = ref(null);
const extractedPOIs = ref([]); // AI 提取的 POI 名称列表
const { dispatchMetaEvent } = useAiStreamDispatcher({
  messagesRef: messages,
  extractedPOIsRef: extractedPOIs,
  emit,
  normalizeRefinedResultEvidence,
  toEmbeddedIntentMode
});
const {
  normalizeSelectedCategories,
  hasCustomSelection,
  shouldRunDeepSpatialMode,
  shouldCaptureSnapshot,
  normalizeRegionsForBackend,
  buildSpatialContext
} = useSpatialRequestBuilder();
let statusTimer = null;
let html2canvasModulePromise = null;
let manualScrollTimer = null;
const snapshotCache = {
  dataUrl: null,
  capturedAt: 0,
  key: ''
};
const SNAPSHOT_CACHE_TTL_MS = 25000;

// 计算 POI 数量
const poiCount = computed(() => props.poiFeatures?.length || 0);

// 快捷操作按钮
const quickActions = [
  {
    text: '\uD83D\uDD0E 30\u79D2\u770B\u61C2\u8FD9\u7247\u533A',
    prompt: '\u8BF7\u5728 30 \u79D2\u5185\u7ED9\u6211\u8FD9\u7247\u533A\u7684\u5173\u952E\u7ED3\u8BBA\uFF1A\u4E3B\u5BFC\u4E1A\u6001\u3001\u6D3B\u529B\u70ED\u70B9\u3001\u6700\u503C\u5F97\u5173\u6CE8\u7684\u673A\u4F1A\u70B9\u3002'
  },
  {
    text: '\uD83D\uDCCD \u627E\u5F00\u5E97\u673A\u4F1A\u70B9',
    prompt: '\u8BF7\u57FA\u4E8E\u5F53\u524D\u7A7A\u95F4\u5206\u5E03\uFF0C\u8BC6\u522B 3 \u4E2A\u4F4E\u4F9B\u7ED9\u9AD8\u9700\u6C42\u7684\u5019\u9009\u70B9\uFF0C\u5E76\u8BF4\u660E\u9002\u5408\u4E1A\u6001\u3002'
  },
  {
    text: '\u2696\uFE0F \u76F8\u90BB\u7247\u533A\u5BF9\u6BD4',
    prompt: '\u8BF7\u5BF9\u6BD4\u5F53\u524D\u9AD8\u6D3B\u529B\u7247\u533A\u548C\u4E3B\u5BFC\u4E1A\u6001\u7247\u533A\u7684\u5DEE\u5F02\uFF0C\u7ED9\u51FA\u4E24\u6761\u53EF\u6267\u884C\u7B56\u7565\u3002'
  },
  {
    text: '\uD83D\uDE87 15\u5206\u949F\u53EF\u8FBE\u6027',
    prompt: '\u8BF7\u8BC4\u4F30\u5F53\u524D\u533A\u57DF 15 \u5206\u949F\u5185\u7684\u4EA4\u901A\u4FBF\u5229\u5EA6\u4E0E\u751F\u6D3B\u670D\u52A1\u53EF\u8FBE\u6027\u3002'
  },
  {
    text: '\uD83D\uDCCA \u5546\u4E1A\u5185\u5377\u98CE\u9669',
    prompt: '\u8BF7\u6307\u51FA\u5F53\u524D\u533A\u57DF\u5B58\u5728\u8FC7\u5EA6\u7ADE\u4E89\u98CE\u9669\u7684\u4E1A\u6001\uFF0C\u5E76\u7ED9\u51FA\u5DEE\u5F02\u5316\u5EFA\u8BAE\u3002'
  },
  {
    text: '\uD83E\uDDE0 AI \u63D0\u95EE\u793A\u4F8B',
    prompt: '\u8BF7\u7ED9\u6211 6 \u4E2A\u9AD8\u8D28\u91CF\u5730\u7406\u7A7A\u95F4\u95EE\u9898\u793A\u4F8B\uFF0C\u6BCF\u4E2A\u95EE\u9898\u90FD\u8981\u80FD\u5F97\u5230\u53EF\u6267\u884C\u7ED3\u8BBA\u3002'
  }
];

const providerName = ref('');
const isLocalProvider = ref(false);

function stopStatusPolling() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

function startStatusPolling() {
  if (statusTimer) return;
  statusTimer = setInterval(() => {
    checkOnlineStatus().catch(() => {});
  }, 30000);
}

// 计算状态文本
const statusText = computed(() => {
  if (isOnline.value === null) return '检测中...';
  if (isOnline.value === false) return '离线';
  // 本地显示 "Local LM"，云端统丢显示 "在线"
  return isLocalProvider.value ? 'Local LM' : '在线';
});

// 检查 AI 服务状态
async function checkOnlineStatus() {
  isOnline.value = await checkAIService();
  if (isOnline.value) {
    const config = getCurrentProviderInfo();
    providerName.value = config.name;
    isLocalProvider.value = config.id === 'local';
    startStatusPolling();
    refreshTemplateWeights({ force: false }).catch(() => {});
  } else {
    providerName.value = '';
    isLocalProvider.value = false;
    stopStatusPolling();
  }
  return isOnline.value;
}

// 发送消息

// spatial request normalization moved to composable: useSpatialRequestBuilder
async function loadHtml2Canvas() {
  if (!html2canvasModulePromise) {
    html2canvasModulePromise = import('html2canvas')
      .then((mod) => mod.default || mod)
      .catch((error) => {
        html2canvasModulePromise = null;
        throw error;
      });
  }
  return html2canvasModulePromise;
}

async function captureMapSnapshot(snapshotKey) {
  const now = Date.now();
  if (
    snapshotCache.dataUrl &&
    snapshotCache.key === snapshotKey &&
    now - snapshotCache.capturedAt < SNAPSHOT_CACHE_TTL_MS
  ) {
    return snapshotCache.dataUrl;
  }

  const mapElement = document.querySelector('.map-container');
  if (!mapElement) return null;

  try {
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(mapElement, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#000000',
      scale: 0.65
    });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    snapshotCache.dataUrl = dataUrl;
    snapshotCache.capturedAt = now;
    snapshotCache.key = snapshotKey;
    return dataUrl;
  } catch (error) {
    console.warn('[AiChat] map snapshot capture failed:', error);
    return null;
  }
}

function enqueueStreamChunk(chunk, messageIndex) {
  if (!chunk || typeof chunk !== 'string') return;

  activeMessageIndex.value = messageIndex;
  streamQueue.value += chunk;

  if (streamTimer.value) return;

  streamTimer.value = window.setInterval(() => {
    if (!streamQueue.value || activeMessageIndex.value < 0) {
      if (!streamQueue.value) {
        window.clearInterval(streamTimer.value);
        streamTimer.value = null;
      }
      return;
    }

    const currentMessage = messages.value[activeMessageIndex.value];
    if (!currentMessage) {
      streamQueue.value = '';
      window.clearInterval(streamTimer.value);
      streamTimer.value = null;
      return;
    }

    const delta = streamQueue.value.slice(0, streamRenderStep);
    streamQueue.value = streamQueue.value.slice(streamRenderStep);
    currentMessage.content += delta;

    streamScrollTick.value += 1;
    if (streamScrollTick.value % 3 === 0) {
      scrollToBottom(false, 'auto');
    }

    if (!streamQueue.value) {
      window.clearInterval(streamTimer.value);
      streamTimer.value = null;
      scrollToBottom(false, 'auto');
    }
  }, streamRenderIntervalMs);
}

async function flushStreamQueue() {
  if (activeMessageIndex.value < 0 || !streamQueue.value) return;

  const currentMessage = messages.value[activeMessageIndex.value];
  if (currentMessage) {
    currentMessage.content += streamQueue.value;
  }

  streamQueue.value = '';

  if (streamTimer.value) {
    window.clearInterval(streamTimer.value);
    streamTimer.value = null;
  }
  streamScrollTick.value = 0;

  await nextTick();
  scrollToBottom(false, 'auto');
}

function resetStreamState() {
  streamQueue.value = '';
  activeMessageIndex.value = -1;
  streamScrollTick.value = 0;
  if (streamTimer.value) {
    window.clearInterval(streamTimer.value);
    streamTimer.value = null;
  }
}

marked.setOptions({
  gfm: true,
  breaks: true
});
const markdownRenderCache = new WeakMap();

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isTyping.value) return;

  const online = await checkOnlineStatus();
  if (!online) {
    const lastMessage = messages.value[messages.value.length - 1];
    const offlineTip = 'AI 服务未连接，请先启动后端服务后重试。';
    if (!(lastMessage?.role === 'assistant' && lastMessage?.content === offlineTip)) {
      messages.value.push({
        role: 'assistant',
        content: offlineTip,
        timestamp: Date.now()
      });
      await nextTick();
      scrollToBottom(true, 'auto');
    }
    return;
  }



  // 先入列用户消息
  messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now()
  });
  inputText.value = '';

  await nextTick();
  scrollToBottom(true, 'auto');

  // 进入 AI 回复状态
  isTyping.value = true;
  resetStreamState();

  // 棰勫厛瀹氫箟 aiMessageIndex
  let aiMessageIndex = -1;
  let requestId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let requestSucceeded = false;

  try {
    console.log('[AiChat] Sending message with POI count:', props.poiFeatures?.length || 0);

    const apiMessages = messages.value.map(m => ({
      role: m.role,
      content: m.content
    }));

    // 预插入 AI 回复占位消息
    aiMessageIndex = messages.value.length;
    messages.value.push({
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    });

    const spatialContext = buildSpatialContext({
      boundaryPolygon: props.boundaryPolygon,
      drawMode: props.drawMode,
      circleCenter: props.circleCenter,
      circleRadius: props.circleRadius,
      mapBounds: props.mapBounds,
      mapZoom: props.mapZoom,
      regions: props.regions,
      poiFeatures: props.poiFeatures
    });

    const normalizedRegions = normalizeRegionsForBackend(props.regions);
    // 多区约束写入 spatialContext，供 Python 直查模式按“选区并集”严格过滤
    spatialContext.regions = normalizedRegions;

    const normalizedSelectedCategories = normalizeSelectedCategories(props.selectedCategories);
    const poiCount = props.poiFeatures?.length || 0;
    const deepSpatialMode = shouldRunDeepSpatialMode(text, spatialContext, props.regions, poiCount);
    const shouldSnapshot = shouldCaptureSnapshot(text, deepSpatialMode);
    const screenshotBase64 = shouldSnapshot
      ? await captureMapSnapshot(`${props.drawMode || 'none'}:${props.mapZoom || 0}:${poiCount}`)
      : null;

    const options = {
      requestId,
      clientMetrics: {
        panel: 'ai-chat',
        messageCount: messages.value.length,
        poiCount
      },
      globalAnalysis: props.globalAnalysisEnabled,
      selectedCategories: normalizedSelectedCategories,
      sourcePolicy: {
        enforceUiConstraints: true,
        hasCustomArea: hasCustomSelection(spatialContext, props.regions),
        hasCategoryFilter: normalizedSelectedCategories.length > 0
      },
      confidenceModel: 'composite_v5',
      visualReviewEnabled: deepSpatialMode,
      visualRemoteEnabled: Boolean(deepSpatialMode && screenshotBase64),
      selfValidationEnabled: deepSpatialMode,
      skgEnabled: deepSpatialMode,
      nameAuditEnabled: true,
      nameAuditRemoteEnabled: deepSpatialMode,
      nameAuditTimeoutMs: deepSpatialMode ? 900 : 420,
      visualModel: 'qwen3-vl-4b',
      screenshotBase64, // 新增：将前端截图传给后端
      limit: deepSpatialMode ? 8000 : 4200,
      clusterMaxHdbscanPoints: deepSpatialMode ? 3500 : 1800,
      maxRegionOutputs: deepSpatialMode ? 60 : 24,
      spatialContext,
      regions: normalizedRegions,
      analysisDepth: deepSpatialMode ? 'deep' : 'fast'
    };

    await sendChatMessageStream(
      apiMessages,
      (chunk) => {
        enqueueStreamChunk(chunk, aiMessageIndex);
      },
      options,
      props.poiFeatures,
      (type, data) => {
        if (type === 'trace' && data?.trace_id) {
          requestId = data.trace_id;
        }
        const fallbackIntentMode = spatialContext?.mode === 'Polygon' ? 'micro' : 'macro';
        const dispatchResult = dispatchMetaEvent({
          type,
          data,
          aiMessageIndex,
          fallbackIntentMode
        });
        if (dispatchResult?.stage) {
          currentStage.value = dispatchResult.stage;
        }
      }
    );

    await flushStreamQueue();
    requestSucceeded = true;
  } catch (error) {
    console.error('[AiChat] Failed to send message:', error);
    await flushStreamQueue();
    const failedContent = `Request failed: ${error.message}`;
    if (aiMessageIndex >= 0 && messages.value[aiMessageIndex]) {
      const currentMessage = messages.value[aiMessageIndex];
      const existingContent = String(currentMessage.content || '').trim();
      currentMessage.content = existingContent ? `${existingContent}\n\n${failedContent}` : failedContent;
      currentMessage.error = true;
    } else {
      messages.value.push({
        role: 'assistant',
        content: failedContent,
        timestamp: Date.now(),
        error: true
      });
    }
  } finally {
    await flushStreamQueue();
    resetStreamState();
    if (messages.value[aiMessageIndex]) {
      messages.value[aiMessageIndex].pipelineCompleted = true;
    }
    const finalAssistantMessage = messages.value[aiMessageIndex] || null;
    trackSessionOutcome({
      traceId: finalAssistantMessage?.traceId || requestId,
      intentMeta: finalAssistantMessage?.intentMeta || null,
      extra: {
        status: requestSucceeded ? 'success' : 'failed',
        queryLength: text.length
      }
    }).catch(() => {});
    isTyping.value = false;
    currentStage.value = '';
    await nextTick();
    scrollToBottom(true, 'auto');
  }
}

function sendQuickAction(prompt) {
  inputText.value = prompt;
  sendMessage();
}

// 标签云：渲染到地图
function handleRenderToMap(pois) {
  console.log('[AiChat] 渲染 POI 到地图:', pois.length);
  emit('render-pois-to-map', pois);
}

// 标签云：标签点击
function handleTagClick(tag) {
  console.log('[AiChat] 标签点击:', tag.name);
  if (tag.originalPoi) {
    emit('render-pois-to-map', [tag.originalPoi]);
  }
}

function hasSpatialEvidence(msg) {
  return msg.spatialClusters?.hotspots?.length > 0 ||
         msg.vernacularRegions?.length > 0 ||
         msg.fuzzyRegions?.length > 0;
}

function handleEvidenceLocate(center) {
  if (!center) return;
  const poi = { lon: center.lon || center[0], lat: center.lat || center[1] };
  emit('render-pois-to-map', [{ type: 'Feature', geometry: { type: 'Point', coordinates: [poi.lon, poi.lat] }, properties: { _source: 'evidence_locate' } }]);
}

function handleEvidenceFollowup(prompt) {
  if (!prompt) return;
  sendQuickAction(prompt);
}

// 清空对话
function clearChat() {
  messages.value = [];
  extractedPOIs.value = [];
  currentStage.value = '';
  resetStreamState();
}

// 保存对话记录
function saveChatHistory() {
  if (messages.value.length === 0) return;
  
  let content = "===== 标签云智能助手对话记录 =====\n\n";
  content += `导出时间: ${new Date().toLocaleString()}\n`;
  content += `选中POI数量: ${props.poiFeatures.length}\n\n`;
  content += "-----------------------------------\n\n";
  
  messages.value.forEach(msg => {
    const role = msg.role === 'user' ? '用户' : '智能助手';
    const time = new Date(msg.timestamp).toLocaleTimeString();
    content += `[${role}] ${time}:\n${msg.content}\n\n`;
    content += "-----------------------------------\n\n";
  });
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `TagCloud_Chat_${new Date().getTime()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

// 滚动状态
const userScrolledUp = ref(false)
const isManualScrolling = ref(false)

onMounted(() => {
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', handleScroll)
    messagesContainer.value.addEventListener('wheel', markManualScrolling, { passive: true })
    messagesContainer.value.addEventListener('touchmove', markManualScrolling, { passive: true })
  }
})

function markManualScrolling() {
  isManualScrolling.value = true
  if (manualScrollTimer) {
    clearTimeout(manualScrollTimer)
  }
  manualScrollTimer = setTimeout(() => {
    isManualScrolling.value = false
    manualScrollTimer = null
  }, 180)
}

function handleScroll() {
  const el = messagesContainer.value
  if (!el) return
  // 如果距离底部超过 50px，认为用户向上滚动了
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  userScrolledUp.value = !isAtBottom
}

// 滚动到底部（平滑）
function scrollToBottom(force = false, behavior = 'smooth') {
  if ((userScrolledUp.value || isManualScrolling.value) && !force) return

  // 等待 nextTick，确保 DOM 已完成更新
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTo({
        top: messagesContainer.value.scrollHeight,
        behavior
      })
    }
  })
}

onUnmounted(() => {
  if (messagesContainer.value) {
    messagesContainer.value.removeEventListener('scroll', handleScroll)
    messagesContainer.value.removeEventListener('wheel', markManualScrolling)
    messagesContainer.value.removeEventListener('touchmove', markManualScrolling)
  }

  if (manualScrollTimer) {
    clearTimeout(manualScrollTimer)
    manualScrollTimer = null
  }

  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }

  resetStreamState()
})

// 插入换行
function insertNewline(e) {
  const textarea = e.target;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  inputText.value = inputText.value.substring(0, start) + '\n' + inputText.value.substring(end);
  nextTick(() => {
    textarea.selectionStart = textarea.selectionEnd = start + 1;
  });
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 增强版 Markdown 渲染（支持表格）
function sanitizeRenderedHtml(html) {
  if (!html) return '';

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

function renderMarkdown(text) {
  if (!text) return '';

  const rawHtml = marked.parse(text, {
    gfm: true,
    breaks: true
  });

  return sanitizeRenderedHtml(rawHtml);
}

function renderMessageHtml(message) {
  if (!message || typeof message !== 'object') return '';
  const content = String(message.content || '');
  if (!content) return '';

  const cached = markdownRenderCache.get(message);
  if (cached && cached.content === content) {
    return cached.html;
  }

  const html = renderMarkdown(content);
  markdownRenderCache.set(message, { content, html });
  return html;
}

function renderTables(text) {
  const lines = text.split('\n');
  let result = [];
  let tableLines = [];
  let inTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
      // 检测表格行（以 | 开头和结尾）
    if (line.startsWith('|') && line.endsWith('|')) {
      // 检查是否是分隔行（如 |---|---|）
      const isSeparator = /^\|[\s\-:|]+\|$/.test(line);
      
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      
      if (!isSeparator) {
        tableLines.push(line);
      }
    } else {
      // 不是表格行
      if (inTable && tableLines.length > 0) {
        // 结束表格，生成 HTML
        result.push(generateTableHTML(tableLines));
        tableLines = [];
        inTable = false;
      }
      result.push(line);
    }
  }
  
  // 处理文本末尾的表格
  if (inTable && tableLines.length > 0) {
    result.push(generateTableHTML(tableLines));
  }
  
  return result.join('\n');
}

// 生成表格 HTML
function generateTableHTML(tableLines) {
  if (tableLines.length === 0) return '';
  
  let html = '<table class="md-table">';
  
  tableLines.forEach((line, index) => {
    // 解析单元格
    const cells = line
      .split('|')
      .filter((cell, i, arr) => i !== 0 && i !== arr.length - 1) // 移除首尾空单元格
      .map(cell => cell.trim());
    
    if (index === 0) {
      // 表头
      html += '<thead><tr>';
      cells.forEach(cell => {
        html += `<th>${cell}</th>`;
      });
      html += '</tr></thead><tbody>';
    } else {
      // 表体
      html += '<tr>';
      cells.forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    }
  });
  
  html += '</tbody></table>';
  return html;
}

/**
 * 从 AI 回复中提取 POI 名称（解析 Markdown 表格）
 * @param {string} content - AI 回复内容
 * @returns {Array} POI 列表 [{name, distance}, ...]
 */
function extractPOIsFromResponse(content) {
  const pois = [];
  if (!content) return pois;
  
  const lines = content.split('\n');
  let inTable = false;
  let nameColIndex = -1;
  let distanceColIndex = -1;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 检测表格行
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').filter((c, i, arr) => i !== 0 && i !== arr.length - 1).map(c => c.trim());
      
      // 检查是否是分隔行
      if (/^[\s\-:|]+$/.test(cells.join(''))) {
        continue;
      }
      
      // 检查是否是表头（寻找“名称”列）
      if (!inTable) {
        nameColIndex = cells.findIndex(c => c.includes('名称') || c.includes('店名') || c.includes('POI'));
        distanceColIndex = cells.findIndex(c => c.includes('距离'));
        if (nameColIndex >= 0) {
          inTable = true;
        }
        continue;
      }
      
      // 表格数据行
      if (inTable && nameColIndex >= 0 && cells[nameColIndex]) {
        const name = cells[nameColIndex].replace(/\*\*/g, '').trim();
        const distance = distanceColIndex >= 0 ? cells[distanceColIndex]?.trim() : null;
        if (name && !name.includes('---')) {
          pois.push({ name, distance });
        }
      }
    } else {
      // 非表格行，重置状态
      if (inTable && pois.length > 0) {
        // 表格已结束
      }
    }
  }
  
  return pois;
}

/**
 * 将 AI 提取的 POI 渲染到标签云
 */
function renderToTagCloud() {
  // 如果提取的数据包含坐标，说明是后端下发的结构化数据，直接作为 Feature 数组传出
  if (extractedPOIs.value.length > 0 && extractedPOIs.value[0].lon) {
     const features = extractedPOIs.value.map(p => ({
        type: 'Feature',
        properties: {
           id: p.id || `temp_${Math.random()}`,
           '名称': p.name,
           '小类': p.category,
           '地址': p.address,
           '_is_temp': true // 标记为临时数据
        },
        geometry: {
           type: 'Point',
           coordinates: [p.lon, p.lat]
        }
     }));
      console.log('[AiChat] 渲染结构化 POI 到标签云:', features.length);
     emit('render-to-tagcloud', features);
     return;
  }

  const poiNames = extractedPOIs.value.map(p => p.name);
  console.log('[AiChat] 渲染到标签云:', poiNames);
  emit('render-to-tagcloud', poiNames);
}

/**
 * 清除提取的 POI
 */
function clearExtractedPOIs() {
  extractedPOIs.value = [];
}

const latestAssistantMessage = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const item = messages.value[i];
    if (item?.role === 'assistant') {
      return item;
    }
  }
  return null;
});

const latestAssistantMessageText = computed(() => {
  if (!latestAssistantMessage.value?.content) return '';
  return String(latestAssistantMessage.value.content);
});

function normalizeNarrativeText(raw = '') {
  const plain = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\|.*\|/g, ' ')
    .replace(/[#>*`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!plain) return ''
  if (plain.length <= 180) return plain

  const sentenceMatch = plain.match(/^(.{40,220}?[。！？!?])(.*)$/)
  if (sentenceMatch?.[1]) return sentenceMatch[1].trim()
  return `${plain.slice(0, 180)}...`
}

const analysisNarrativeText = computed(() => {
  const message = latestAssistantMessage.value
  if (!message) return ''

  const fromContent = normalizeNarrativeText(message.content || '')
  if (fromContent) return fromContent

  const hotspotCount = Array.isArray(message.spatialClusters?.hotspots) ? message.spatialClusters.hotspots.length : 0
  const regionCount = Array.isArray(message.vernacularRegions) ? message.vernacularRegions.length : 0
  const fuzzyCount = Array.isArray(message.fuzzyRegions) ? message.fuzzyRegions.length : 0

  if (hotspotCount > 0 || regionCount > 0 || fuzzyCount > 0) {
    return `已识别 ${hotspotCount} 个热点片区、${regionCount} 个主导业态片区、${fuzzyCount} 个边界模糊片区，可结合下方模板执行定位与追问。`
  }

  return ''
})

// 监听最新 assistant 文本，自动提取 POI（避免 deep watch 导致频繁重算）
watch(latestAssistantMessageText, (latestText) => {
  if (isTyping.value || !latestText) return;
  const pois = extractPOIsFromResponse(latestText);
  if (pois.length > 0) {
    extractedPOIs.value = pois;
    console.log('[AiChat] extracted POI count:', pois.length);
  }
});

watch(() => props.poiFeatures, (newVal, oldVal) => {
  if (newVal?.length > 0 && newVal.length !== oldVal?.length) {
    // 可以在这里添加提示消息
    console.log(`[AiChat] POI data updated: ${newVal.length}`);
  }
}, { deep: false });

onMounted(() => {
  stopStatusPolling();
  checkOnlineStatus().catch(() => {});
});

/**
 * 自动发送消息（供父组件调用）
 * 用于复杂查询时，自动打开 AI 面板并发送用户输入
 * @param {string} message - 要发送的消息内容
 */
async function autoSendMessage(message) {
  if (!message || !message.trim()) return;
  
  // 填充输入框
  inputText.value = message.trim();
  
  // 等待 DOM 更新
  await nextTick();
  
  // 自动发送
  await sendMessage();
}

// 暴露方法给父组件
defineExpose({
  clearChat,
  checkOnlineStatus,
  autoSendMessage
});
</script>

<style scoped>
.ai-chat-container {
  --panel-bg-1: #071224;
  --panel-bg-2: #0c1c34;
  --panel-bg-3: #0f2f44;
  --line-soft: rgba(132, 171, 207, 0.2);
  --line-strong: rgba(90, 170, 230, 0.42);
  --text-main: #e6eef8;
  --text-dim: rgba(194, 213, 233, 0.76);
  --primary: #2eb8ff;
  --surface: rgba(10, 20, 38, 0.8);
  --surface-2: rgba(12, 26, 46, 0.78);
  --ok: #34d399;
  --warn: #fb7185;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--text-main);
  font-family: 'Manrope', 'Noto Sans SC', 'PingFang SC', sans-serif;
  background:
    radial-gradient(circle at 82% 0%, rgba(31, 113, 162, 0.24), transparent 44%),
    radial-gradient(circle at 0% 30%, rgba(24, 75, 126, 0.25), transparent 38%),
    linear-gradient(160deg, var(--panel-bg-1), var(--panel-bg-2) 52%, var(--panel-bg-3));
  border-left: 1px solid var(--line-soft);
  box-shadow: -8px 0 34px rgba(2, 8, 20, 0.35);
}

.chat-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line-soft);
  background: linear-gradient(180deg, rgba(8, 18, 33, 0.9), rgba(8, 18, 33, 0.62));
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}

.header-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ai-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: #f8fbff;
  border: 1px solid rgba(133, 183, 221, 0.35);
  background: linear-gradient(145deg, rgba(36, 88, 142, 0.55), rgba(24, 46, 82, 0.85));
}

.header-info {
  display: grid;
  gap: 2px;
}

.ai-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.ai-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
}

.ai-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 999px;
}

.ai-status.online {
  color: #9ceec9;
}

.ai-status.online::before {
  background: var(--ok);
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.18);
}

.ai-status.offline {
  color: #fda4af;
}

.ai-status.offline::before {
  background: var(--warn);
  box-shadow: 0 0 0 4px rgba(251, 113, 133, 0.15);
}

.ai-status.probing {
  color: #93c5fd;
}

.ai-status.probing::before {
  background: #60a5fa;
  box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.15);
}

.poi-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(94, 186, 245, 0.35);
  background: rgba(6, 85, 128, 0.34);
  font-size: 11px;
  color: #d8efff;
}

.poi-icon {
  font-size: 10px;
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
  color: #d8e7f7;
}

.clear-btn {
  background: rgba(183, 45, 63, 0.25);
  border-color: rgba(240, 101, 123, 0.3);
}

.save-btn {
  background: rgba(25, 126, 99, 0.24);
  border-color: rgba(87, 222, 175, 0.3);
}

.close-btn {
  background: rgba(38, 91, 150, 0.24);
  border-color: rgba(111, 188, 255, 0.3);
}

.action-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(179, 221, 255, 0.42);
}

.chat-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  padding: 10px 10px 0;
  flex: 1;
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 8px 14px;
  scroll-behavior: smooth;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(123, 168, 209, 0.4);
}

.welcome-message {
  min-height: 220px;
  padding: 18px 10px;
  text-align: center;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 10px;
}

.welcome-message h3 {
  margin: 0;
  font-size: 18px;
  color: #f3f8ff;
}

.welcome-message p {
  margin: 0;
  font-size: 13px;
  color: var(--text-dim);
  max-width: 320px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.quick-action-btn {
  border: 1px solid rgba(106, 168, 216, 0.35);
  border-radius: 999px;
  background: linear-gradient(130deg, rgba(11, 30, 54, 0.86), rgba(14, 43, 71, 0.7));
  color: #d8eafc;
  font-size: 12px;
  padding: 7px 12px;
  cursor: pointer;
  transition: all 200ms ease;
}

.quick-action-btn:hover {
  border-color: rgba(120, 202, 255, 0.56);
  background: linear-gradient(130deg, rgba(17, 60, 102, 0.86), rgba(18, 88, 130, 0.66));
  transform: translateY(-1px);
}

.message {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
  max-width: 100%;
  animation: msg-enter 220ms ease;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
}

.user .message-avatar {
  background: rgba(35, 98, 167, 0.7);
}

.assistant .message-avatar {
  border: 1px solid rgba(121, 171, 214, 0.28);
  background: rgba(13, 38, 69, 0.65);
}

.message-content {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.assistant .message-content {
  width: calc(100% - 42px);
}

.user .message-content {
  justify-items: end;
}

.message-text {
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.user .message-text {
  background: linear-gradient(145deg, rgba(29, 102, 171, 0.38), rgba(25, 58, 101, 0.52));
  border: 1px solid rgba(112, 187, 250, 0.35);
  color: #eef6ff;
}

.assistant .message-text {
  background: linear-gradient(150deg, rgba(11, 27, 47, 0.88), rgba(11, 34, 58, 0.74));
  border: 1px solid rgba(116, 163, 205, 0.24);
  color: #e7f0fa;
}

.message-text :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(4, 11, 23, 0.66);
  overflow-x: auto;
}

.message-text :deep(code) {
  border-radius: 6px;
  background: rgba(7, 17, 34, 0.75);
  padding: 2px 5px;
  font-family: 'Fira Code', monospace;
  font-size: 12px;
}

.message-text :deep(table),
.message-text :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  background: rgba(7, 19, 35, 0.65);
  border-radius: 8px;
  overflow: hidden;
}

.message-text :deep(th),
.message-text :deep(td) {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(116, 163, 205, 0.2);
}

.message-text :deep(th) {
  background: rgba(20, 65, 108, 0.5);
}

.message-time {
  font-size: 11px;
  color: rgba(177, 199, 223, 0.62);
  padding: 0 2px;
}

.pipeline-tracker-inline {
  border-radius: 12px;
  border: 1px solid rgba(93, 154, 210, 0.22);
  background: linear-gradient(145deg, rgba(10, 25, 43, 0.92), rgba(15, 41, 68, 0.75));
  padding: 10px 10px 8px;
}

.pipeline-trace-inline {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.trace-step-inline {
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 5px;
  position: relative;
}

.trace-step-inline::after {
  content: '';
  position: absolute;
  top: 11px;
  left: calc(50% + 14px);
  width: calc(100% - 26px);
  height: 1px;
  background: rgba(120, 164, 205, 0.3);
}

.trace-step-inline:last-child::after {
  display: none;
}

.trace-step-inline.completed::after,
.trace-step-inline.active::after {
  background: linear-gradient(90deg, rgba(46, 184, 255, 0.8), rgba(52, 211, 153, 0.8));
}

.step-icon-wrapper {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(128, 170, 206, 0.35);
  background: rgba(11, 31, 54, 0.8);
  display: grid;
  place-items: center;
  color: rgba(193, 215, 236, 0.72);
}

.trace-step-inline.active .step-icon-wrapper {
  border-color: rgba(46, 184, 255, 0.84);
  color: #dff4ff;
}

.trace-step-inline.completed .step-icon-wrapper {
  border-color: rgba(52, 211, 153, 0.78);
  background: rgba(10, 77, 67, 0.46);
  color: #dcfff5;
}

.step-spinner {
  animation: spin 900ms linear infinite;
}

.step-label-inline {
  font-size: 10px;
  text-align: center;
  line-height: 1.2;
  color: rgba(176, 199, 223, 0.72);
}

.trace-step-inline.active .step-label-inline {
  color: #dff4ff;
}

.trace-step-inline.completed .step-label-inline {
  color: #b9f4dc;
}

.step-number {
  font-size: 10px;
  font-weight: 700;
}

.pipeline-hint-inline {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  color: rgba(173, 211, 244, 0.74);
}

.pipeline-intent-inline {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.intent-pill {
  border-radius: 999px;
  border: 1px solid rgba(108, 176, 231, 0.5);
  background: rgba(15, 59, 97, 0.55);
  color: #dff4ff;
  font-size: 10px;
  padding: 3px 8px;
}

.analysis-board {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background:
    radial-gradient(circle at 15% 10%, rgba(31, 109, 163, 0.15), transparent 40%),
    linear-gradient(180deg, rgba(7, 20, 37, 0.94), rgba(9, 27, 47, 0.9));
  box-shadow: inset 0 1px 0 rgba(165, 210, 247, 0.06);
  overflow: hidden;
  transition: border-color 220ms ease;
}

.analysis-board-inline {
  margin: 8px 0 10px 42px;
  width: calc(100% - 42px);
}

.analysis-board-header {
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  border-bottom: 1px solid rgba(122, 166, 202, 0.2);
}

.analysis-kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #9bd5ff;
}

.analysis-title {
  margin: 2px 0 0;
  font-size: 14px;
  color: #eff7ff;
}

.analysis-meta {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #d8efff;
  background: rgba(8, 74, 114, 0.38);
  border: 1px solid rgba(109, 178, 233, 0.35);
}

.analysis-board-content {
  padding: 10px;
}

.analysis-narrative {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(115, 170, 214, 0.24);
  background: linear-gradient(140deg, rgba(10, 31, 56, 0.7), rgba(9, 24, 43, 0.78));
  color: rgba(226, 239, 252, 0.92);
  font-size: 13px;
  line-height: 1.6;
}

.analysis-empty-state {
  border: 1px dashed rgba(112, 163, 206, 0.4);
  border-radius: 12px;
  background: rgba(8, 27, 47, 0.55);
  padding: 14px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}

.analysis-empty-title {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
  color: #e8f5ff;
}

.chat-input-area {
  padding: 10px 12px 14px;
  border-top: 1px solid var(--line-soft);
  background: linear-gradient(180deg, rgba(8, 20, 36, 0.9), rgba(7, 16, 28, 0.96));
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  border-radius: 14px;
  border: 1px solid rgba(120, 166, 206, 0.35);
  background: var(--surface);
  padding: 8px 10px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.input-wrapper:focus-within {
  border-color: var(--line-strong);
  box-shadow: 0 0 0 2px rgba(46, 184, 255, 0.18);
}

.input-wrapper textarea {
  flex: 1;
  border: none;
  resize: none;
  outline: none;
  max-height: 120px;
  line-height: 1.45;
  font-size: 14px;
  color: #edf6ff;
  background: transparent;
  font-family: inherit;
}

.input-wrapper textarea::placeholder {
  color: rgba(178, 201, 227, 0.5);
}

.send-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(96, 185, 244, 0.55);
  color: #eff8ff;
  background: linear-gradient(140deg, rgba(27, 132, 198, 0.95), rgba(28, 87, 182, 0.92));
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 16px rgba(19, 90, 164, 0.4);
}

.send-btn:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.input-hint {
  margin-top: 6px;
  padding: 0 2px;
  font-size: 11px;
  color: rgba(172, 196, 223, 0.65);
}

.offline-hint {
  color: #fda4af;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.probing-hint {
  color: #93c5fd;
}

.retry-link {
  border: 0;
  background: transparent;
  color: #60a5fa;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  text-decoration: underline;
}

.retry-link:hover {
  color: #93c5fd;
}

@keyframes msg-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .chat-header {
    padding: 10px 12px;
  }

  .chat-body {
    padding: 8px 8px 0;
  }

  .analysis-board-inline {
    margin-left: 0;
    width: 100%;
  }

  .pipeline-trace-inline {
    gap: 2px;
  }

  .step-icon-wrapper {
    width: 20px;
    height: 20px;
  }

  .step-label-inline {
    font-size: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .message,
  .quick-action-btn,
  .action-btn,
  .send-btn,
  .analysis-board,
  .input-wrapper,
  .step-spinner {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }

  .chat-messages {
    scroll-behavior: auto;
  }
}
</style>


