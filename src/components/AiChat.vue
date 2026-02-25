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
            <span class="ai-status" :class="{ online: isOnline, offline: !isOnline }">
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

    <!-- 消息列表 -->

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
      <div v-for="(msg, index) in messages" :key="index" 
           class="message" :class="msg.role">
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
          <!-- 五阶段 Pipeline 追踪器（嵌入 assistant 消息内） -->
          <div v-if="msg.role === 'assistant' && (msg.pipelineCompleted || (isTyping && index === messages.length - 1))"
               class="pipeline-tracker-inline">
            <div class="pipeline-trace-inline">
              <template v-for="(step, idx) in stageSteps" :key="step.key">
                <div class="trace-step-inline"
                     :class="{
                       active: !msg.pipelineCompleted && stageActiveIndex === idx,
                       completed: msg.pipelineCompleted || stageActiveIndex > idx
                     }">
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
            <div
              v-if="msg.queryType || msg.intentMeta?.intentMode"
              class="pipeline-intent-inline"
            >
              <span v-if="msg.queryType" class="intent-pill">Type: {{ msg.queryType }}</span>
              <span v-if="msg.intentMeta?.intentMode" class="intent-pill">Mode: {{ msg.intentMeta.intentMode }}</span>
            </div>
          </div>
          <!-- 嵌入式 Pipeline 追踪器（当有阶段信息时显示） -->
          <div v-if="msg.content && msg.content.trim()" class="message-text" v-html="renderMessageHtml(msg)"></div>
          
          <!-- 嵌入式标签云（在文本下方显示，增加视觉引导） -->
          <EmbeddedTagCloud 
            v-if="msg.role === 'assistant' && msg.pois && msg.pois.length > 0"
            :pois="msg.pois"
            :intent-mode="resolveEmbeddedIntentMode(msg)"
            :intent-meta="msg.intentMeta || null"
            :width="360"
            :height="200"
            @render-to-map="handleRenderToMap"
            @tag-click="handleTagClick"
          />

          <SpatialEvidenceCard
            v-if="msg.role === 'assistant' && hasSpatialEvidence(msg)"
            :clusters="msg.spatialClusters"
            :vernacular-regions="msg.vernacularRegions"
            :fuzzy-regions="msg.fuzzyRegions"
            @locate="handleEvidenceLocate"
            @ask-followup="handleEvidenceFollowup"
          />

          <div v-if="msg.content && msg.content.trim()" class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
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
          :disabled="isTyping || !isOnline"
          rows="1"
        ></textarea>
        <button 
          class="send-btn" 
          @click="sendMessage"
          :disabled="!inputText.trim() || isTyping || !isOnline"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div class="input-hint">
        <span v-if="!isOnline" class="offline-hint">AI 服务未连接</span>
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
const streamTimer = ref(null);
const activeMessageIndex = ref(-1);
const streamRenderStep = 18;
const streamRenderIntervalMs = 24;
const streamScrollTick = ref(0);
const isOnline = ref(false);
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
const snapshotCache = {
  dataUrl: null,
  capturedAt: 0,
  key: ''
};
const SNAPSHOT_CACHE_TTL_MS = 25000;

// 璁＄畻 POI 鏁伴噺
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

// 计算状态文本
const statusText = computed(() => {
  if (!isOnline.value) return '绂荤嚎';
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
  }
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
  if (!text || isTyping.value || !isOnline.value) return;



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
  } catch (error) {
    console.error('[AiChat] Failed to send message:', error);
    messages.value.push({
      role: 'assistant',
      content: `Request failed: ${error.message}`,
      timestamp: Date.now()
    });
  } finally {
    await flushStreamQueue();
    resetStreamState();
    if (messages.value[aiMessageIndex]) {
      messages.value[aiMessageIndex].pipelineCompleted = true;
    }
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

// 娓呯┖瀵硅瘽
function clearChat() {
  messages.value = [];
  extractedPOIs.value = [];
  currentStage.value = '';
  resetStreamState();
}

// 淇濆瓨瀵硅瘽璁板綍
function saveChatHistory() {
  if (messages.value.length === 0) return;
  
  let content = "===== 标签云智能助手对话记录 =====\n\n";
  content += `瀵煎嚭鏃堕棿: ${new Date().toLocaleString()}\n`;
  content += `閫変腑POI鏁伴噺: ${props.poiFeatures.length}\n\n`;
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

onMounted(() => {
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', handleScroll)
  }
})

function handleScroll() {
  const el = messagesContainer.value
  if (!el) return
  // 如果距离底部超过 50px，认为用户向上滚动了
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  userScrolledUp.value = !isAtBottom
}

// 滚动到底部（平滑）
function scrollToBottom(force = false, behavior = 'smooth') {
  if (userScrolledUp.value && !force) return

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

// 鐢熸垚琛ㄦ牸 HTML
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
      // 琛ㄥご
      html += '<thead><tr>';
      cells.forEach(cell => {
        html += `<th>${cell}</th>`;
      });
      html += '</tr></thead><tbody>';
    } else {
      // 琛ㄤ綋
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
 * @returns {Array} POI 鍒楄〃 [{name, distance}, ...]
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
    
    // 棢测表格行
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').filter((c, i, arr) => i !== 0 && i !== arr.length - 1).map(c => c.trim());
      
      // 检查是否是分隔行
      if (/^[\s\-:|]+$/.test(cells.join(''))) {
        continue;
      }
      
      // 检查是否是表头（寻找“名称”列）
      if (!inTable) {
        nameColIndex = cells.findIndex(c => c.includes('鍚嶇О') || c.includes('搴楀悕') || c.includes('POI'));
        distanceColIndex = cells.findIndex(c => c.includes('璺濈'));
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
           '鍚嶇О': p.name,
           '灏忕被': p.category,
           '鍦板潃': p.address,
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
  console.log('[AiChat] 娓叉煋鍒版爣绛句簯:', poiNames);
  emit('render-to-tagcloud', poiNames);
}

/**
 * 清除提取的 POI
 */
function clearExtractedPOIs() {
  extractedPOIs.value = [];
}

const latestAssistantMessageText = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const item = messages.value[i];
    if (item?.role === 'assistant' && item?.content) {
      return String(item.content);
    }
  }
  return '';
});

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
  checkOnlineStatus();
  // 定期检查服务状态
  if (statusTimer) {
    clearInterval(statusTimer);
  }
  statusTimer = setInterval(checkOnlineStatus, 30000);
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
  
  // 绛夊緟 DOM 鏇存柊
  await nextTick();
  
  // 自动发送
  await sendMessage();
}

// 鏆撮湶鏂规硶缁欑埗缁勪欢
defineExpose({
  clearChat,
  checkOnlineStatus,
  autoSendMessage
});
</script>

<style scoped>
.ai-chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(160deg, rgba(9, 18, 38, 0.84) 0%, rgba(16, 30, 59, 0.78) 48%, rgba(8, 41, 48, 0.68) 100%);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  color: #e5e7eb;
  font-family: 'Manrope', 'Noto Sans SC', 'PingFang SC', 'Segoe UI', sans-serif;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: -4px 0 32px rgba(0, 0, 0, 0.3);
}

/* 澶撮儴 */
.chat-header {
  padding: 16px 20px;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  z-index: 10;
}

.header-main-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1; /* 鍗犳嵁鍓╀綑绌洪棿 */
  overflow: hidden; /* 防止文字过长挤压按钮 */
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ai-avatar {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-name {
  font-weight: 700;
  font-size: 16px;
  color: #f8fafc;
  letter-spacing: 0.5px;
}

.ai-status {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  width: fit-content;
}

.ai-status::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.ai-status.online {
  color: #10b981;
  font-weight: 500;
}
.ai-status.online::before {
  background: #10b981;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.8), 0 0 4px rgba(16, 185, 129, 0.4);
}

.ai-status.offline {
  color: #fb7185;
}
.ai-status.offline::before {
  background: #fb7185;
}

.poi-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #a5b4fc;
  margin-right: 4px;
}

.poi-icon {
  font-size: 10px;
}

/* 操作按钮通用样式重构 - 迷你图标 */
.action-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(255, 255, 255, 0.05);
  color: #94a3b8;
}

.clear-btn {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.clear-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.4);
  color: #ff8a8a;
}

.save-btn {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.save-btn:hover {
  background: rgba(16, 185, 129, 0.25);
  border-color: rgba(16, 185, 129, 0.4);
  color: #5ffcc3;
}

.close-btn {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}
.close-btn:hover {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.4);
  color: #c7d2ff;
}

/* 娑堟伅鍖哄煙 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scroll-behavior: smooth;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}
.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(107, 114, 128, 0.4);
  border-radius: 3px;
}

/* 娆㈣繋娑堟伅 */
.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 20px;
  color: #9ca3af;
}

.welcome-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: #818cf8;
}

.welcome-message h3 {
  margin: 0 0 8px;
  color: #f9fafb;
  font-size: 18px;
}

.welcome-message p {
  margin: 0 0 20px;
  font-size: 14px;
  max-width: 300px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  width: 100%;
  margin-top: 15px;
}

.quick-action-btn {
  padding: 8px 16px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.66), rgba(30, 41, 59, 0.58));
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 20px;
  color: #e2e8f0;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-flex;
  align-items: center;
  backdrop-filter: blur(4px);
}

.quick-action-btn:hover {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.26), rgba(59, 130, 246, 0.24));
  border-color: rgba(56, 189, 248, 0.56);
  transform: translateY(-2px);
  color: #fff;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.24);
}

/* 娑堟伅娉℃场 */
.message {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  max-width: 95%;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  flex-direction: row-reverse;
  align-self: flex-end;
  margin-left: auto;
}

.message.assistant {
  width: 100%;
  max-width: 100%;
}

.message-avatar {
  width: 34px;
  height: 34px;
  min-width: 34px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user .message-avatar {
  background: rgba(99, 102, 241, 0.8);
  color: white;
}

.assistant .message-avatar {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.message-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: calc(100% - 46px);
}

.user .message-content {
  align-items: flex-end;
}

.assistant .message-content {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14.5px;
  line-height: 1.6;
  word-break: break-word;
}

.user .message-text {
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.4);
  color: #f8fafc;
  border-bottom-right-radius: 4px;
}

.assistant .message-text {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
  border-top-left-radius: 4px;
}

.message-text :deep(code) {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Fira Code', monospace;
  font-size: 13px;
}

.message-text :deep(pre) {
  background: rgba(0, 0, 0, 0.4);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-text :deep(strong) {
  color: #a5b4fc;
}

.message-text :deep(h2),
.message-text :deep(h3),
.message-text :deep(h4),
.message-text :deep(h5) {
  margin: 16px 0 8px;
  color: #f9fafb;
  font-weight: 600;
  line-height: 1.4;
}

.message-text :deep(h4),
.message-text :deep(h5) {
  font-size: 1.1em;
  color: #e5e7eb;
}

.message-text :deep(li) {
  margin-bottom: 4px;
  line-height: 1.6;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.message-text :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid rgba(99, 102, 241, 0.65);
  background: rgba(99, 102, 241, 0.08);
  color: #dbeafe;
  border-radius: 0 8px 8px 0;
}

.message-text :deep(.list-num) {
  font-weight: bold;
  color: #93c5fd;
  margin-right: 4px;
}

.message-text :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 16px 0;
}

.message-text :deep(.spacer) {
  height: 8px;
}

/* Markdown 琛ㄦ牸鏍峰紡 */
.message-text :deep(table),
.message-text :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
}

.message-text :deep(table th),
.message-text :deep(table td),
.message-text :deep(.md-table th),
.message-text :deep(table td),
.message-text :deep(.md-table td) {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(75, 85, 99, 0.4);
}

.message-text :deep(table th),
.message-text :deep(.md-table th) {
  background: rgba(99, 102, 241, 0.15);
  color: #a5b4fc;
  font-weight: 600;
  white-space: nowrap;
}

.message-text :deep(.md-table td) {
  color: #d1d5db;
}

.message-text :deep(table tr:last-child td),
.message-text :deep(.md-table tr:last-child td) {
  border-bottom: none;
}

.message-text :deep(table tr:hover td),
.message-text :deep(.md-table tr:hover td) {
  background: rgba(99, 102, 241, 0.08);
}

.message-time {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  padding: 0 4px;
}

.message.user .message-time {
  text-align: right;
}

/* 打字指示器 */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: #6366f1;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* Pipeline 追踪器（内联 assistant 消息） */
.pipeline-tracker-inline {
  padding: 8px 12px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(99, 102, 241, 0.12);
  border-radius: 10px;
  margin-bottom: 6px;
}

.pipeline-trace-inline {
  display: flex;
  align-items: center;
  gap: 0;
}

.trace-step-inline {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.step-label-inline {
  transition: color 0.3s;
}

.trace-step-inline.active .step-label-inline {
  color: #a5b4fc;
  font-weight: 500;
}

.trace-step-inline.completed .step-label-inline {
  color: rgba(52, 211, 153, 0.7);
}

.trace-connector {
  width: 20px;
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
  flex-shrink: 0;
}

.trace-connector.completed {
  background: rgba(52, 211, 153, 0.3);
}

.pipeline-hint-inline {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 4px;
  font-style: italic;
}

/* 现代 Pipeline Tracker 样式 */
.step-icon-wrapper {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(30, 41, 59, 0.8);
  border: 2px solid rgba(100, 116, 139, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(148, 163, 184, 0.6);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.step-icon-wrapper.active {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  border-color: #818cf8;
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.4), 0 0 40px rgba(99, 102, 241, 0.2);
  animation: icon-pulse 2s infinite;
}

.step-icon-wrapper.completed {
  background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
  border-color: #34d399;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.3);
  color: white;
}

.step-spinner {
  animation: spin 1s linear infinite;
}

.step-check {
  animation: check-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.step-number {
  font-size: 11px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.8);
}

.step-label-inline {
  font-size: 12px;
  color: rgba(148, 163, 184, 0.5);
  transition: all 0.3s ease;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.trace-step-inline.active .step-label-inline {
  color: #a5b4fc;
  font-weight: 600;
  text-shadow: 0 0 10px rgba(165, 180, 252, 0.3);
}

.trace-step-inline.completed .step-label-inline {
  color: #6ee7b7;
  font-weight: 500;
}

.trace-connector {
  height: 2px;
  background: rgba(71, 85, 105, 0.4);
  margin: 0 8px;
  flex-shrink: 0;
  position: relative;
  min-width: 24px;
  overflow: hidden;
}

.trace-connector::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
  transition: width 0.5s ease;
}

.trace-connector.completed::after {
  width: 100%;
}

.pipeline-tracker-inline {
  padding: 14px 18px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 16px;
  margin-bottom: 10px;
  width: 100%;
  box-sizing: border-box;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.pipeline-trace-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
}

.pipeline-hint-inline {
  font-size: 11px;
  color: rgba(165, 180, 252, 0.7);
  margin-top: 8px;
  text-align: center;
  font-style: italic;
  animation: hint-fade 2s ease-in-out infinite;
}

@keyframes icon-pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(99, 102, 241, 0.4), 0 0 40px rgba(99, 102, 241, 0.2); }
  50% { box-shadow: 0 0 25px rgba(99, 102, 241, 0.6), 0 0 50px rgba(99, 102, 241, 0.3); }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes check-pop {
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes hint-fade {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

/* 五阶段链路展示：避免中文标签挤压 */
.pipeline-trace-inline {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: start;
  gap: 10px;
}

.trace-step-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  position: relative;
}

.trace-step-inline::after {
  content: "";
  position: absolute;
  top: 11px;
  left: calc(50% + 16px);
  width: calc(100% - 32px);
  height: 2px;
  border-radius: 999px;
  background: rgba(71, 85, 105, 0.45);
}

.trace-step-inline:last-child::after {
  display: none;
}

.trace-step-inline.completed::after,
.trace-step-inline.active::after {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.75), rgba(16, 185, 129, 0.75));
}

.pipeline-intent-inline {
  margin-top: 6px;
  display: flex;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}

.intent-pill {
  font-size: 10px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(99, 102, 241, 0.4);
  color: #c7d2fe;
}

.step-label-inline {
  font-size: 11px;
  line-height: 1.25;
  text-align: center;
  white-space: normal;
  word-break: break-word;
}

.step-icon-wrapper {
  width: 24px;
  height: 24px;
}

@media (max-width: 768px) {
  .pipeline-tracker-inline {
    padding: 10px 12px;
  }

  .pipeline-trace-inline {
    gap: 4px;
  }

  .trace-step-inline::after {
    top: 9px;
    left: calc(50% + 12px);
    width: calc(100% - 24px);
    height: 1px;
  }

  .step-icon-wrapper {
    width: 20px;
    height: 20px;
  }

  .step-label-inline {
    font-size: 10px;
  }
}

/* 杈撳叆鍖哄煙 */
.chat-input-area {
  padding: 12px 16px 16px;
  background: rgba(17, 24, 39, 0.95);
  border-top: 1px solid rgba(75, 85, 99, 0.4);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: rgba(55, 65, 81, 0.4);
  border: 1px solid rgba(75, 85, 99, 0.5);
  border-radius: 16px;
  padding: 8px 12px;
  transition: border-color 0.2s;
}

.input-wrapper:focus-within {
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.input-wrapper textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: #f9fafb;
  font-size: 14px;
  resize: none;
  outline: none;
  max-height: 120px;
  line-height: 1.5;
  font-family: inherit;
}

.input-wrapper textarea::placeholder {
  color: #6b7280;
}

.send-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 12px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  font-size: 11px;
  color: #6b7280;
  margin-top: 6px;
  padding: 0 4px;
}

.offline-hint {
  color: #f87171;
}

/* AI 提取的 POI 区域 */
.extracted-pois-area {
  padding: 10px 16px;
  background: rgba(16, 185, 129, 0.08);
  border-top: 1px solid rgba(16, 185, 129, 0.2);
  border-bottom: 1px solid rgba(16, 185, 129, 0.2);
}

.extracted-pois-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #10b981;
}

.extracted-pois-icon {
  font-size: 14px;
}

.clear-extracted-btn {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 4px;
  color: #f87171;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-extracted-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.5);
}

.render-tagcloud-btn, .clear-extracted-btn {
  margin-left: 8px;
  padding: 8px 16px;
  font-size: 13px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.render-tagcloud-btn {
  margin-left: auto; /* Keep it pushed to the right if flex container allows, or this might conflict with previous margin-left */
  background: linear-gradient(135deg, #10b981, #06b6d4);
  color: white;
  box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
}

.render-tagcloud-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(16, 185, 129, 0.4);
}

.clear-extracted-btn {
  background: rgba(107, 114, 128, 0.2);
  color: #d1d5db;
}

.clear-extracted-btn:hover {
  background: rgba(107, 114, 128, 0.4);
  color: white;
}

.extracted-pois-preview {
  font-size: 12px;
  color: #6ee7b7;
  line-height: 1.4;
  word-break: break-all;
}

/* 绉诲姩绔€傞厤 */
@media (max-width: 768px) {
  .chat-header {
    padding: 10px 12px;
  }

  .message-content {
    max-width: 85%;
  }

  .quick-actions {
    gap: 8px;
    margin-top: 12px;
  }

  .quick-action-btn {
    padding: 6px 12px;
    font-size: 12px;
  }

  .thinking-process-embed {
    margin: 0 12px 8px 52px;
  }
}
</style>


