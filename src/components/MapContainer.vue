<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container"></div>

    <!-- POI 名称气泡 -->
    <div ref="poiPopup" class="poi-popup" v-show="popupVisible">
      <div class="popup-content">
        <div class="popup-title">{{ popupName }}</div>
        <div
          v-for="(line, idx) in popupDetailLines"
          :key="'popup-line-' + idx"
          class="popup-detail"
        >
          {{ line }}
        </div>
      </div>
      <div class="popup-arrow"></div>
    </div>

    <!-- 实时过滤与热力图控制 -->
    <div v-if="showControls" class="map-filter-control">
      <div class="control-row">
        <span class="filter-label">实时过滤</span>
        <el-switch
          v-model="filterEnabled"
          @change="toggleFilter"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>
      <div class="control-row">
        <span class="filter-label">热力图</span>
        <el-switch
          v-model="heatmapEnabled"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>

      <!-- 标签权重 -->
      <div class="control-divider"></div>
      <div class="control-row">
        <span class="filter-label">标签权重</span>
        <el-switch
          v-model="weightEnabled"
          @change="handleWeightToggle"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>
      <div class="control-row">
        <span class="filter-label" :class="{ 'disabled': !weightEnabled }">显示权重</span>
        <el-switch
          v-model="showWeightValue"
          :disabled="!weightEnabled"
          @change="handleShowWeightToggle"
          inline-prompt
          active-text="开启"
          inactive-text="关闭"
        />
      </div>

      <!-- 全域感知（仅展示） -->
      <div class="control-divider"></div>
      <div class="control-row">
        <span class="filter-label">全域感知</span>
        <el-switch
          :model-value="true"
          disabled
          inline-prompt
          active-text="开启"
          inactive-text=""
        />
      </div>
      <div class="control-hint">
        <span>GeoLoom-RAG 全域感知已启用</span>
      </div>
    </div>

    <!-- 边界可信度图例 -->
    <div v-if="aiBoundaryLegend.visible" class="ai-boundary-legend">
      <div class="legend-head">
        <span class="legend-title">边界可信度</span>
        <span class="legend-model">模型：{{ aiBoundaryLegend.model || 'composite_v5' }}</span>
      </div>
      <div class="legend-stats">
        <span>均值 {{ formatLegendPercent(aiBoundaryLegend.avg) }}</span>
        <span>最低 {{ formatLegendPercent(aiBoundaryLegend.min) }}</span>
        <span>最高 {{ formatLegendPercent(aiBoundaryLegend.max) }}</span>
      </div>
      <div
        v-if="aiBoundaryLegend.semanticAnchorCoverage !== null || aiBoundaryLegend.dominantNicheType || aiBoundaryLegend.avgWaterPenalty !== null"
        class="legend-semantic"
      >
        <span v-if="aiBoundaryLegend.anchorModel">语义 {{ aiBoundaryLegend.anchorModel }}</span>
        <span v-if="aiBoundaryLegend.semanticAnchorCoverage !== null">锚点覆盖 {{ formatLegendPercent(aiBoundaryLegend.semanticAnchorCoverage) }}</span>
        <span v-if="aiBoundaryLegend.dominantNicheType">主导生态位 {{ nicheLabel(aiBoundaryLegend.dominantNicheType) }}</span>
        <span v-if="aiBoundaryLegend.avgWaterPenalty !== null">水域惩罚 {{ formatLegendPercent(aiBoundaryLegend.avgWaterPenalty) }}</span>
      </div>
      <div class="legend-scale">
        <div class="legend-item high">
          <span class="legend-swatch"></span>
          <span>高可信 ≥ 70%（{{ aiBoundaryLegend.buckets.high }}）</span>
        </div>
        <div class="legend-item medium">
          <span class="legend-swatch"></span>
          <span>中可信 40%-69%（{{ aiBoundaryLegend.buckets.medium }}）</span>
        </div>
        <div class="legend-item low">
          <span class="legend-swatch"></span>
          <span>低可信 &lt; 40%（{{ aiBoundaryLegend.buckets.low }}）</span>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="weightDialogVisible"
      title="请选择需要渲染的地理权重"
      width="360px"
      class="mirspatial-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      center
    >
      <div class="weight-dialog-content">
        <el-select
          v-model="selectedWeightType"
          placeholder="选择权重类型"
          style="width: 100%"
        >
          <el-option
            v-for="item in weightOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="cancelWeightDialog">取消</el-button>
          <el-button type="primary" @click="confirmWeightDialog" :loading="weightLoading">
            确定
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';
import { Vector as VectorLayer } from 'ol/layer';
import { Draw } from 'ol/interaction';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, RegularShape, Text as TextStyle } from 'ol/style';
import { isEmpty as isEmptyExtent } from 'ol/extent';


import { useRegions, REGION_COLORS, MAX_REGIONS } from '../composables/useRegions';
import { buildAiBoundaryMeta, buildBoundaryPopupLines, nicheLabel } from '../utils/aiBoundaryMeta';
import { normalizeAiEvidencePayload, resolveFuzzyLayerBundle, resolveRegionBoundary } from '../utils/aiEvidencePayload';

/**
 *
 * polygon-completed: 选区绘制完成并筛选 POI 后触发
 * map-ready: 地图初始化完成时触发
 * hover-feature: 鼠标悬停 POI 时触发
 * click-feature: 鼠标点击 POI 时触发
 * map-move-end: 地图移动结束时触发
 * toggle-filter: 切换实时过滤时触发
 * toggle-overlay: 切换叠加模式时触发
 * weight-change: 权重配置变化时触发
 * region-added: 新增选区时触发
 * region-removed: 删除选区时触发
 * regions-cleared: 清空所有选区时触发
 */
const emit = defineEmits([
  'polygon-completed', 'map-ready', 'hover-feature', 'click-feature', 
  'map-move-end', 'toggle-filter', 'toggle-overlay', 'weight-change', 
  'global-analysis-change', 'region-added', 'region-removed', 'regions-cleared'
]);

/**
 *
 * poiFeatures: POI 数据数组（GeoJSON Feature 格式）
 * hoveredFeatureId: 当前悬停要素（来自 TagCloud 组件）
 */
const props = defineProps({
  poiFeatures: { type: Array, default: () => [] },
  hoveredFeatureId: { type: Object, default: null }, // 注释说明

  filterEnabled: { type: Boolean, default: false },
  heatmapEnabled: { type: Boolean, default: false },
  overlayEnabled: { type: Boolean, default: false },
  weightEnabled: { type: Boolean, default: false },
  showWeightValue: { type: Boolean, default: false },
  globalAnalysisEnabled: { type: Boolean, default: true },
  showControls: { type: Boolean, default: true },
});

// DOM 相关说明
const mapContainer = ref(null);
// OpenLayers 相关说明
const map = ref(null);

let drawInteraction = null;
// 注释说明
let hoveredFeature = null; 

const filterEnabled = ref(props.filterEnabled);

const heatmapEnabled = ref(props.heatmapEnabled);


// ============ ============
const weightEnabled = ref(props.weightEnabled);
const showWeightValue = ref(props.showWeightValue);
const weightDialogVisible = ref(false);
const selectedWeightType = ref('population');
const weightLoading = ref(false);

// props 同步说明
watch(() => props.filterEnabled, (val) => { filterEnabled.value = val; });
watch(() => props.heatmapEnabled, (val) => { heatmapEnabled.value = val; });

watch(() => props.weightEnabled, (val) => { weightEnabled.value = val; });
watch(() => props.showWeightValue, (val) => { showWeightValue.value = val; });

// POI 相关说明
const poiPopup = ref(null); // DOM 相关说明
const popupVisible = ref(false);
const popupName = ref('');
const popupDetailLines = ref([]);
let popupHideTimer = null;


const weightOptions = ref([
  { value: 'population', label: '人口密度' },
]);

const aiBoundaryLegend = ref({
  visible: false,
  model: null,
  avg: null,
  min: null,
  max: null,
  buckets: { high: 0, medium: 0, low: 0 },
  anchorModel: null,
  semanticAnchorCoverage: null,
  dominantNicheType: null,
  avgWaterPenalty: null
});

const MAP_MIN_ZOOM = 4;
const MAP_MAX_ZOOM = 18;
const VECTOR_LAYER_RUNTIME_OPTIONS = {
  updateWhileAnimating: true,
  updateWhileInteracting: true,
  renderBuffer: 280
};

// ============  ============
const { 
  regions, 
  activeRegionId, 
  canAddRegion, 
  addRegion, 
  removeRegion, 
  clearAllRegions, 
  getRegion,
  updateRegionPois,
  getRegionsContext
} = useRegions();

// ()
let currentGeometry = null;
let currentGeometryType = null; // 注释说明

/**
 *
 * @param {boolean} val - 开关值
 */
const toggleFilter = (val) => {
  emit('toggle-filter', val);
};



/**
 *
 *
 */
function handleWeightToggle(val) {
  if (val) {

    weightDialogVisible.value = true;
  } else {

    showWeightValue.value = false;
    emit('weight-change', { enabled: false, showValue: false });
  }
}

/**
 *
 */
function handleShowWeightToggle(val) {
  emit('weight-change', { enabled: weightEnabled.value, showValue: val });
}


/**
 *
 */
function cancelWeightDialog() {
  weightDialogVisible.value = false;
  weightEnabled.value = false;
}

/**
 *
 */
async function confirmWeightDialog() {
  if (!selectedWeightType.value) {
    return;
  }
  
  weightLoading.value = true;
  
  // 与 TagCloud 联动说明
  emit('weight-change', { 
    enabled: true, 
    showValue: showWeightValue.value,
    weightType: selectedWeightType.value,
    needLoad: true
  });
  

  setTimeout(() => {
    weightLoading.value = false;
    weightDialogVisible.value = false;
    // (
    emit('weight-change', { 
      enabled: true, 
      showValue: showWeightValue.value,
      weightType: selectedWeightType.value,
      needLoad: true 
    });
  }, 500);
}

// ---  ---

// OpenLayers 相关说明
const polygonLayerSource = new VectorSource();
const polygonLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: polygonLayerSource,
  style: new Style({
    stroke: new Stroke({ color: '#2ecc71', width: 2 }),
    fill: new Fill({ color: 'rgba(46,204,113,0.1)' }),
  }),
  zIndex: 50
});

// OpenLayers 相关说明
const centerLayerSource = new VectorSource();
const centerLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: centerLayerSource,
  style: new Style({
    image: new RegularShape({
      points: 5,
      radius: 10,
      radius2: 5,
      fill: new Fill({ color: '#0000FF' }),
      stroke: new Stroke({ color: '#FFFFFF', width: 2 })
    })
  }),
  zIndex: 200
});

// OpenLayers 相关说明
const hoverLayerSource = new VectorSource();
const hoverLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: hoverLayerSource,
  style: new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color: 'rgba(255, 165, 0, 0.8)' }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    zIndex: 999
  }),
  zIndex: 200
});

// 4.
const locateLayerSource = new VectorSource();
const locateLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: locateLayerSource,
  style: new Style({
    image: new RegularShape({
      points: 5,
      radius: 8,
      radius2: 6,
      fill: new Fill({ color: '#00BFFF' }),
      stroke: new Stroke({ color: '#0080FF', width: 1 })
    })
  }),
  zIndex: 300
});

// 注释说明
const aiEvidenceLayerSource = new VectorSource();
const aiEvidenceLayer = new VectorLayer({
  ...VECTOR_LAYER_RUNTIME_OPTIONS,
  source: aiEvidenceLayerSource,
  zIndex: 260
});

// deck.gl 相关说明
// deck.gl 相关说明
// deck.gl 相关说明

let deckInstance = null; // deck.gl 相关说明
let deckContainer = null; // deck.gl 相关说明
const highlightData = ref([]); // deck.gl 相关说明
const heatmapData = ref([]); // deck.gl 相关说明
let DeckClass = null;
let ScatterplotLayerClass = null;
let DeckHeatmapLayerClass = null;
let deckRuntimePromise = null;
let html2canvasModulePromise = null;

// deck.gl 相关说明
let currentLocatedPoi = null;

// OpenLayers 相关说明
let olPoiFeatures = [];
// OpenLayers 相关说明
let rawToOlMap = new Map();

async function loadDeckRuntime() {
  if (DeckClass && ScatterplotLayerClass && DeckHeatmapLayerClass) {
    return true;
  }

  if (!deckRuntimePromise) {
    deckRuntimePromise = Promise.all([
      import('@deck.gl/core'),
      import('@deck.gl/layers'),
      import('@deck.gl/aggregation-layers')
    ]).then(([core, layers, aggregation]) => {
      DeckClass = core?.Deck || null;
      ScatterplotLayerClass = layers?.ScatterplotLayer || null;
      DeckHeatmapLayerClass = aggregation?.HeatmapLayer || null;
      return Boolean(DeckClass && ScatterplotLayerClass && DeckHeatmapLayerClass);
    }).catch((error) => {
      console.warn('[MapContainer] deck.gl runtime load failed:', error);
      DeckClass = null;
      ScatterplotLayerClass = null;
      DeckHeatmapLayerClass = null;
      return false;
    }).finally(() => {
      deckRuntimePromise = null;
    });
  }

  return deckRuntimePromise;
}

async function ensureDeckInitialized() {
  if (deckInstance || !map.value || !mapContainer.value) return deckInstance;
  const runtimeReady = await loadDeckRuntime();
  if (!runtimeReady || !DeckClass) return null;

  deckContainer = document.createElement('div');
  deckContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  `;
  mapContainer.value.appendChild(deckContainer);

  deckInstance = new DeckClass({
    parent: deckContainer,
    style: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
    initialViewState: getDeckViewState(),
    controller: false,
    layers: [],
    getTooltip: null,
    pickingRadius: 8,
  });

  const view = map.value.getView();
  view.on('change:resolution', scheduleDeckSync);
  view.on('change:center', scheduleDeckSync);
  view.on('change:rotation', scheduleDeckSync);

  nextTick(() => {
    const canvas = deckContainer?.querySelector?.('canvas');
    if (canvas) canvas.style.pointerEvents = 'none';
  });

  scheduleDeckSync();
  return deckInstance;
}

/**
 * deck.gl 相关说明
 */
function getDeckViewState() {
  if (!map.value) {
    return { longitude: 114.33, latitude: 30.58, zoom: 12, bearing: 0, pitch: 0 };
  }
  const view = map.value.getView();
  const center = view.getCenter();
  const zoom = view.getZoom();
  const rotation = view.getRotation();
  
  if (!center || zoom === undefined) {
    return { longitude: 114.33, latitude: 30.58, zoom: 12, bearing: 0, pitch: 0 };
  }
  
  // EPSG: 说明
  const [lon, lat] = toLonLat(center);
  
  return {
    longitude: lon,
    latitude: lat,
    zoom: zoom - 1, // deck.gl 相关说明
    bearing: (-rotation * 180) / Math.PI,
    pitch: 0,
  };
}

/**
 *
 */
function getColorByGroupIndex(groupIndex) {

  const colors = [
    [255, 0, 0, 180],
    [0, 128, 255, 180],
    [0, 200, 80, 180],
    [255, 165, 0, 180],
    [138, 43, 226, 180],
    [0, 206, 209, 180],
    [255, 20, 147, 180],
    [255, 215, 0, 180],
    [70, 130, 180, 180],
    [154, 205, 50, 180],
    [220, 20, 60, 180],
    [0, 139, 139, 180],
  ];
  return colors[groupIndex % colors.length] || colors[0];
}

/**
 * deck.gl 相关说明
 */
function updateDeckLayers() {
  if (!deckInstance || !ScatterplotLayerClass || !DeckHeatmapLayerClass || !map.value) return;
  
  const zoom = map.value.getView().getZoom() || 13;
  

  const minZ = 10, maxZ = 16;
  const clampedZoom = Math.max(minZ, Math.min(maxZ, zoom));
  const ratio = (clampedZoom - minZ) / (maxZ - minZ);
  // -> 80, -> 30
  const heatmapRadius = Math.round(90 - ratio * (90 - 40));
  
  const layers = [
    // 注释说明
    // OpenLayers 相关说明
    new ScatterplotLayerClass({
      id: 'highlight-layer',
      data: highlightData.value.filter(d => {
        // POI 相关说明
        if (!currentLocatedPoi) return true;
        const coords = currentLocatedPoi.geometry.coordinates;
        if (!coords) return true;
        return Math.abs(d.lon - coords[0]) > 0.000001 || Math.abs(d.lat - coords[1]) > 0.000001;
      }),
      pickable: true,
      opacity: 0.8,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 3,
      radiusMaxPixels: 7,
      lineWidthMinPixels: 1,
      getPosition: d => [d.lon, d.lat],
      getRadius: 4,
      getFillColor: d => getColorByGroupIndex(d.groupIndex || 0),
      getLineColor: d => {
        const fill = getColorByGroupIndex(d.groupIndex || 0);
        return [fill[0], fill[1], fill[2]]; // 注释说明
      },
      updateTriggers: {
        getFillColor: [highlightData.value, currentLocatedPoi],
        getPosition: [highlightData.value, currentLocatedPoi],
      },
    }),
    
    // POI 相关说明
    new DeckHeatmapLayerClass({
      id: 'heatmap-layer',
      data: heatmapData.value,
      visible: heatmapEnabled.value,
      pickable: false,
      getPosition: d => [d.lon, d.lat],
      getWeight: 1,
      radiusPixels: heatmapRadius,
      intensity: 5,
      threshold: 0.01,
      colorRange: [
        [255, 255, 178, 150],
        [254, 217, 118, 180],
        [254, 178, 76, 200],
        [253, 141, 60, 220],
        [240, 59, 32, 240],
        [189, 0, 38, 255],
      ],
      updateTriggers: {
        getPosition: [heatmapData.value],
        radiusPixels: [zoom],
      },
    }),
  ];
  
  deckInstance.setProps({ layers });
}

/**
 * deck.gl 相关说明
 */
function syncDeckView() {
  if (!deckInstance || !map.value) return;
  deckInstance.setProps({ viewState: getDeckViewState() });
}

let deckSyncAnimationId = null;

function scheduleDeckSync() {
  if (deckSyncAnimationId !== null) return;
  deckSyncAnimationId = requestAnimationFrame(() => {
    deckSyncAnimationId = null;
    syncDeckView();
    updateDeckLayers();
  });
}

onMounted(() => {
  // 注释说明
  const amapKey = import.meta.env.VITE_AMAP_KEY || '2b42a2f72ef6751f2cd7c7bd24139e72';
  const gaodeUrl = `https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}&key=${amapKey}`;

  const baseLayer = new TileLayer({
    source: new XYZ({ url: gaodeUrl, crossOrigin: 'anonymous' })
  });

  // OpenLayers 相关说明
  map.value = new OlMap({
    target: mapContainer.value,
    layers: [baseLayer, polygonLayer, centerLayer, hoverLayer, aiEvidenceLayer, locateLayer],
    controls: [],
    view: new View({
      center: fromLonLat([114.33, 30.58]),
      zoom: 14,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM
    }),
  });

  // OpenLayers 相关说明
  map.value.on('moveend', onMapMoveEnd);
  map.value.on('pointermove', onPointerMove);
  map.value.on('singleclick', onMapClick);

  // POI 相关说明
  rebuildPoiOlFeatures();


  nextTick(() => {
    emit('map-ready', map.value);
  });
});

// 与 TagCloud 联动说明
watch(() => props.hoveredFeatureId, (newVal) => {
  hoverLayerSource.clear();
  if (newVal && rawToOlMap.has(newVal)) {
    const olFeature = rawToOlMap.get(newVal);
    // 注释说明
    const clone = olFeature.clone();
    // 注释说明
    // 与 TagCloud 联动说明
    clone.set('__raw', olFeature.get('__raw'));
    hoverLayerSource.addFeature(clone);
  }
});

/**
 *
 *
 */
function onMapMoveEnd() {
  if (!map.value) return;
  const extent = map.value.getView().calculateExtent(map.value.getSize());
  const bl = toLonLat([extent[0], extent[1]]);
  const tr = toLonLat([extent[2], extent[3]]);
  // [   ]
  emit('map-move-end', [bl[0], bl[1], tr[0], tr[1]]);
}

const AI_BOUNDARY_KIND_PRIORITY = Object.freeze({
  fuzzyCore: 4.0,
  fuzzyTransition: 3.0,
  fuzzyOuter: 2.0,
  vernacular: 1.6,
  hotspot: 1.4,
  queryBoundary: 1.2,
  generic: 1.0
});

function findAiBoundaryAtCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;

  let bestMatch = null;
  aiEvidenceLayerSource.forEachFeature((feature) => {
    const geometry = feature?.getGeometry?.();
    if (!geometry || typeof geometry.intersectsCoordinate !== 'function') return;
    if (!geometry.intersectsCoordinate(coordinate)) return;

    const labelRaw = feature.get('__aiBoundaryLabel');
    const label = typeof labelRaw === 'string' ? labelRaw.trim() : '';
    if (!label) return;

    const kind = String(feature.get('__aiBoundaryKind') || 'generic');
    const priority = AI_BOUNDARY_KIND_PRIORITY[kind] ?? AI_BOUNDARY_KIND_PRIORITY.generic;
    const confidence = toFiniteBoundaryConfidence(feature.get('__aiBoundaryConfidence')) ?? 0;
    const score = priority + confidence;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        score,
        label,
        meta: feature.get('__aiBoundaryMeta') || null
      };
    }
  });

  return bestMatch;
}


function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}


const emitHover = debounce((feature) => {
  emit('hover-feature', feature);
}, 50); // 注释说明

/**
 *
 * deck.gl 相关说明
 */
function onMapClick(evt) {
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let foundRaw = null;
  let boundaryLabel = '';
  let boundaryMeta = null;

  // 注释说明
  map.value.forEachFeatureAtPixel(
    pixel,
    (feature) => {
      const label = feature.get('__aiBoundaryLabel');
      if (typeof label === 'string' && label.trim()) {
        boundaryLabel = label.trim();
        boundaryMeta = feature.get('__aiBoundaryMeta') || null;
        return true;
      }
      return false;
    },
    {
      hitTolerance: 12,
      layerFilter: (layer) => layer === aiEvidenceLayer
    }
  );

  if (!boundaryLabel) {
    const fallbackBoundary = findAiBoundaryAtCoordinate(evt.coordinate);
    if (fallbackBoundary) {
      boundaryLabel = fallbackBoundary.label;
      boundaryMeta = fallbackBoundary.meta;
    }
  }

  // POI 相关说明
  if (!boundaryLabel) {
    map.value.forEachFeatureAtPixel(
      pixel,
      (feature) => {
        const raw = feature.get('__raw');
        if (raw) {
          foundRaw = raw;
          return true;
        }
        return false;
      },
      {
        hitTolerance: 10,
        layerFilter: (layer) => layer === hoverLayer
      }
    );
  }

  // deck.gl 相关说明
  if (!boundaryLabel && !foundRaw && deckInstance && pixel && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1])) {
    try {
      const pickInfo = deckInstance.pickObject({
        x: pixel[0],
        y: pixel[1],
        radius: 10,
      });
      if (pickInfo && pickInfo.object && pickInfo.object.raw) {
        foundRaw = pickInfo.object.raw;
      }
    } catch (e) {
      // deck.gl 相关说明
    }
  }
  
  if (boundaryLabel) {
    showBoundaryPopup(boundaryLabel, pixel, boundaryMeta);
  } else if (foundRaw) {
    console.log('[MapContainer] 点击要素:', foundRaw);
    emit('click-feature', foundRaw);

    // POI 相关说明
    showPoiPopup(foundRaw, pixel);
  } else {

    hidePoiPopup();
  }
}

function positionPopup(anchor) {
  if (!poiPopup.value || !mapContainer.value) return;
  let x = null;
  let y = null;

  if (Array.isArray(anchor) && anchor.length >= 2) {
    x = Number(anchor[0]);
    y = Number(anchor[1]);
  } else if (anchor && typeof anchor === 'object') {
    const mapRect = mapContainer.value.getBoundingClientRect();
    x = Number(anchor.clientX) - mapRect.left;
    y = Number(anchor.clientY) - mapRect.top;
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  poiPopup.value.style.left = `${x}px`;
  poiPopup.value.style.top = `${y - 10}px`;
}

function showTextPopup(label, anchor, autoHideMs = 2800, detailLines = []) {
  popupName.value = String(label || '').trim() || '未命名片区';
  popupDetailLines.value = Array.isArray(detailLines)
    ? detailLines.map((line) => String(line || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  popupVisible.value = true;

  nextTick(() => {
    positionPopup(anchor);
  });

  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }

  popupHideTimer = setTimeout(() => {
    hidePoiPopup();
  }, autoHideMs);
}

/**
 * POI 相关说明
 */
function showPoiPopup(feature, event) {
  const props = feature.properties || feature;
  const name = props['名称'] || props.name || props.poi_name || props.poiName || props.title || props.label || '未命名POI';
  const category = props.category_small || props.category_mid || props.category_big || props.type || '';
  const address = props.address || props.addr || '';
  const detailLines = [category, address].map((value) => String(value || '').trim()).filter(Boolean).slice(0, 2);
  showTextPopup(name, event, 3200, detailLines);
}

function showBoundaryPopup(label, event, meta = null) {
  const detailLines = buildBoundaryPopupLines(meta);
  showTextPopup(label, event, 2800, detailLines);
}

/**
 * POI 相关说明
 */
function hidePoiPopup() {
  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }
  popupVisible.value = false;
  popupDetailLines.value = [];
}

/**
 *
 * deck.gl 相关说明
 */
function onPointerMove(evt) {
  if (evt.dragging) return;
  
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let hitRaw = null;
  
  // OpenLayers 相关说明
  map.value.forEachFeatureAtPixel(pixel, (feature) => {
    if (feature.get('__raw')) {
      hitRaw = feature.get('__raw');
      return true;
    }
  }, {
    hitTolerance: 8,
    layerFilter: (layer) => layer === hoverLayer
  });
  
  // deck.gl 相关说明
  if (!hitRaw && deckInstance && pixel && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1])) {
    try {
      const pickInfo = deckInstance.pickObject({
        x: pixel[0],
        y: pixel[1],
        radius: 8,
      });
      if (pickInfo && pickInfo.object && pickInfo.object.raw) {
        hitRaw = pickInfo.object.raw;
      }
    } catch (e) {
      // deck.gl 相关说明
    }
  }
  
  if (hitRaw) {
    map.value.getTargetElement().style.cursor = 'pointer';
    emitHover(hitRaw);
  } else {
    map.value.getTargetElement().style.cursor = '';
    emitHover(null);
  }
}

onBeforeUnmount(() => {

  if (deckSyncAnimationId !== null) {
    cancelAnimationFrame(deckSyncAnimationId);
    deckSyncAnimationId = null;
  }

  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }
  
  // deck.gl 相关说明
  if (deckInstance) {
    deckInstance.finalize();
    deckInstance = null;
  }
  
  // deck.gl 相关说明
  if (deckContainer && deckContainer.parentNode) {
    deckContainer.parentNode.removeChild(deckContainer);
    deckContainer = null;
  }
  
  // OpenLayers 相关说明
  if (map.value) map.value.setTarget(null);
});

// OpenLayers 相关说明
watch(() => props.poiFeatures, () => {
  rebuildPoiOlFeatures();

  if (currentGeometry && currentGeometryType) {
    if (currentGeometryType === 'Polygon') {
      onPolygonComplete(currentGeometry, true); // 注释说明
    } else if (currentGeometryType === 'Circle') {
      onCircleComplete(currentGeometry, true);
    }
  }
}, { deep: false });

/**
 * OpenLayers 相关说明
 * OpenLayers 相关说明
 */
function rebuildPoiOlFeatures() {
  olPoiFeatures = [];
  rawToOlMap.clear();
  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  for (const f of (props.poiFeatures || [])) {
    let [lon, lat] = f.geometry.coordinates;
    // 注释说明
    if (poiCoordSys.toLowerCase() === 'wgs84') {
      [lon, lat] = wgs84ToGcj02(lon, lat);
    }
    const feat = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
      __raw: f,
    });
    olPoiFeatures.push(feat);
    rawToOlMap.set(f, feat);
  }
}

/**
 *
 * @param {Object} feature - 要素对象
 */
let hasLocatedOnce = false;

function resolveFlyToLonLat(target) {
  if (!target) return null;

  if (Array.isArray(target) && target.length >= 2) {
    const lon = Number(target[0]);
    const lat = Number(target[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat];
    }
    return null;
  }

  if (Array.isArray(target?.geometry?.coordinates)) {
    const lon = Number(target.geometry.coordinates[0]);
    const lat = Number(target.geometry.coordinates[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat];
    }
    return null;
  }

  const lon = Number(target.lon ?? target.lng ?? target.longitude);
  const lat = Number(target.lat ?? target.latitude);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return [lon, lat];
  }

  return null;
}

function flyTo(target, options = {}) {
  if (!map.value || !target) return;
  const {
    showMarker = true,
    firstLocateZoom = true
  } = options || {};
  const lonLat = resolveFlyToLonLat(target);
  if (!lonLat) return;

  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  let [lon, lat] = lonLat;
  if (poiCoordSys.toLowerCase() === 'wgs84') {
    [lon, lat] = wgs84ToGcj02(lon, lat);
  }
  const center = fromLonLat([lon, lat]);

  const isPoiFeature = Array.isArray(target?.geometry?.coordinates);
  if (showMarker && isPoiFeature) {
    currentLocatedPoi = target;
  } else {
    currentLocatedPoi = null;
  }
  updateDeckLayers();

  hoverLayerSource.clear();
  locateLayerSource.clear();
  if (showMarker) {
    locateLayerSource.addFeature(
      new Feature({
        geometry: new Point(center)
      })
    );
  }

  const view = map.value.getView();
  if (view.cancelAnimations) {
    view.cancelAnimations();
  }

  const animateOptions = {
    center,
    duration: 800,
  };

  if (firstLocateZoom && !hasLocatedOnce) {
    animateOptions.zoom = 17;
    hasLocatedOnce = true;
  }

  view.animate(animateOptions);
}

/**
 * ()
 * @param {string} mode - 绘制模式
 */
function openPolygonDraw(mode = 'Polygon') {
  if (!map.value) return;
  

  if (!canAddRegion.value) {
    import('element-plus').then(({ ElNotification }) => {
      ElNotification({
        title: '选区数量已达上限',
        message: `最多只能绘制 ${MAX_REGIONS} 个选区，请先删除现有选区后再添加。`,
        type: 'warning',
        duration: 4000
      });
    });
    return;
  }
  

  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
  }
  
  drawInteraction = new Draw({ source: polygonLayerSource, type: mode });
  
  drawInteraction.on('drawstart', () => {

    // 注释说明
    // 注释说明
    clearHighlights();
    // 注释说明
    // 注释说明
  });

  drawInteraction.on('drawend', (evt) => {
    const geometry = evt.feature.getGeometry();
    const type = geometry.getType(); // 注释说明
    const feature = evt.feature;
    
    if (type === 'Polygon') {
      onPolygonCompleteMulti(geometry, feature);
    } else if (type === 'Circle') {
      onCircleCompleteMulti(geometry, feature);
    }
    

    closePolygonDraw();
  });
  map.value.addInteraction(drawInteraction);
}

/**
 *
 * @param {Object} circleGeom - 圆形几何对象
 * @param {boolean} isRefresh - 是否为刷新触发
 */
function onCircleComplete(circleGeom, isRefresh = false) {
  if (!isRefresh) {
    currentGeometry = circleGeom;
    currentGeometryType = 'Circle';
  }
  const center = circleGeom.getCenter();
  const radius = circleGeom.getRadius(); // EPSG: 说明
  
  const insideRaw = [];
  
  // POI 相关说明
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const dx = coord[0] - center[0];
    const dy = coord[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= radius) {
      insideRaw.push(feat.get('__raw'));
    }
  }

  // 与 TagCloud 联动说明
  const centerPixelObj = { 
    x: map.value.getPixelFromCoordinate(center)[0], 
    y: map.value.getPixelFromCoordinate(center)[1] 
  };

  // (
  centerLayerSource.clear();
  const centerFeature = new Feature({
    geometry: new Point(center)
  });
  centerLayerSource.addFeature(centerFeature);

  showHighlights(insideRaw, { full: true });
  
  emit('polygon-completed', { 
    polygon: null,
    center: centerPixelObj,
    selected: insideRaw,
    type: 'Circle',
    circleCenter: toLonLat(center),
    circleRadius: radius
  });
}

/**
 *
 */
function closePolygonDraw() {
  if (!map.value) return;
  
  // 1.
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
    drawInteraction = null;
  }
  
  // 注释说明
  // "
  const interactions = map.value.getInteractions().getArray().slice();
  interactions.forEach((interaction) => {
    if (interaction instanceof Draw) {
      map.value.removeInteraction(interaction);
    }
  });
}

// ============  ============

/**
 * ()
 */
function onCircleCompleteMulti(circleGeom, feature) {
  const center = circleGeom.getCenter();
  const centerLonLat = toLonLat(center);
  const radius = circleGeom.getRadius();
  
  // POI 相关说明
  const insideRaw = [];
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const dx = coord[0] - center[0];
    const dy = coord[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= radius) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  
  // 注释说明

  const numPoints = 64;
  const wktCoords = [];
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const x = center[0] + radius * Math.cos(angle);
    const y = center[1] + radius * Math.sin(angle);
    const [lon, lat] = toLonLat([x, y]);
    wktCoords.push(`${lon} ${lat}`);
  }
  const boundaryWKT = `POLYGON((${wktCoords.join(', ')}))`;
  

  const region = addRegion({
    type: 'Circle',
    geometry: {
      type: 'Point',
      coordinates: centerLonLat,
      radius: radius
    },
    center: centerLonLat,
    boundaryWKT,
    pois: insideRaw,
    olFeature: feature
  });
  
  if (region) {

    applyRegionStyle(feature, region);
    

    addRegionLabel(center, region);
    

    createRegionDeleteButton(region);
    
    // POI 相关说明
    updateRegionPois(region.id, insideRaw);
    

    showHighlights(insideRaw, { full: true });
    

    emit('polygon-completed', { 
      polygon: null,
      center: { x: map.value.getPixelFromCoordinate(center)[0], y: map.value.getPixelFromCoordinate(center)[1] },
      selected: insideRaw,
      type: 'Circle',
      circleCenter: centerLonLat,
      circleRadius: radius,
      regionId: region.id,
      regionName: region.name
    });
  }
}

/**
 * ()
 */
function onPolygonCompleteMulti(polygonGeom, feature) {
  const ringCoords = polygonGeom.getCoordinates()[0];
  const ringPixels = ringCoords.map((c) => map.value.getPixelFromCoordinate(c));
  
  // POI 相关说明
  const insideRaw = [];
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const px = map.value.getPixelFromCoordinate(coord);
    if (pointInPolygonPixel(px, ringPixels)) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  

  const geoCenter = calculatePolygonGeoCenter(ringCoords);
  const centerLonLat = geoCenter ? toLonLat(geoCenter) : null;
  
  // 注释说明
  const wktCoords = ringCoords.map(c => {
    const [lon, lat] = toLonLat(c);
    return `${lon} ${lat}`;
  });
  const boundaryWKT = `POLYGON((${wktCoords.join(', ')}))`;
  
  // GeoJSON 相关说明
  const geoJsonGeometry = {
    type: 'Polygon',
    coordinates: [ringCoords.map(c => toLonLat(c))]
  };
  

  const region = addRegion({
    type: 'Polygon',
    geometry: geoJsonGeometry,
    center: centerLonLat,
    boundaryWKT,
    pois: insideRaw,
    olFeature: feature
  });
  
  if (region) {

    applyRegionStyle(feature, region);
    

    if (geoCenter) {
      addRegionLabel(geoCenter, region);
    }
    

    createRegionDeleteButton(region);
    
    // POI 相关说明
    updateRegionPois(region.id, insideRaw);
    

    showHighlights(insideRaw, { full: true });
    

    emit('polygon-completed', { 
      polygon: ringCoords.map((c) => toLonLat(c)),
      center: calculatePolygonCenter(ringPixels),
      selected: insideRaw,
      type: 'Polygon',
      polygonCenter: centerLonLat,
      regionId: region.id,
      regionName: region.name
    });
  }
}

/**
 * 注释说明
 */
function applyRegionStyle(feature, region) {
  const color = region.color;
  feature.setStyle(new Style({
    stroke: new Stroke({ color: color.stroke, width: 2 }),
    fill: new Fill({ color: color.fill })
  }));
}

/**
 *
 */
function addRegionLabel(center, region) {
  const labelFeature = new Feature({
    geometry: new Point(center)
  });
  
  labelFeature.setStyle(new Style({
    text: new TextStyle({
      text: region.name,
      font: 'bold 14px Arial',
      fill: new Fill({ color: region.color.text }),
      stroke: new Stroke({ color: '#fff', width: 3 }),
      offsetY: -20
    }),
    image: new RegularShape({
      points: 5,
      radius: 10,
      radius2: 5,
      fill: new Fill({ color: region.color.stroke }),
      stroke: new Stroke({ color: '#fff', width: 2 })
    })
  }));
  
  centerLayerSource.addFeature(labelFeature);
  

  region.labelFeature = labelFeature;
}

/**
 * 注释说明
 */
function createRegionDeleteButton(region) {
  if (!map.value) return;
  
  let buttonPosition = null;
  
  if (region.olFeature) {
    const geometry = region.olFeature.getGeometry();
    const geometryType = geometry.getType();
    
    if (geometryType === 'Polygon') {


      const coords = geometry.getCoordinates()[0];
      if (coords && coords.length > 0) {
        // 注释说明
        let topRightVertex = coords[0];
        let maxScore = coords[0][0] + coords[0][1]; // 注释说明
        
        for (const coord of coords) {
          const score = coord[0] + coord[1];
          if (score > maxScore) {
            maxScore = score;
            topRightVertex = coord;
          }
        }
        buttonPosition = topRightVertex;
      }
    } else if (geometryType === 'Circle') {
      // 45
      const center = geometry.getCenter();
      const radius = geometry.getRadius();
      // 45
      const angle = Math.PI / 4; // 45 度
      buttonPosition = [
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle)
      ];
    } else {

      const extent = geometry.getExtent();
      buttonPosition = [extent[2], extent[3]];
    }
  }
  
  if (!buttonPosition) return;
  
  // DOM 相关说明
  const buttonElement = document.createElement('div');
  buttonElement.className = 'region-delete-btn';
  buttonElement.innerHTML = '×';
  buttonElement.title = `删除${region.name}`;
  buttonElement.style.cssText = `
    width: 24px;
    height: 24px;
    background: ${region.color.stroke};
    color: white;
    border: 2px solid white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    transition: transform 0.2s, background 0.2s;
    user-select: none;
  `;
  

  buttonElement.onmouseenter = () => {
    buttonElement.style.transform = 'scale(1.2)';
    buttonElement.style.background = '#e74c3c';
  };
  buttonElement.onmouseleave = () => {
    buttonElement.style.transform = 'scale(1)';
    buttonElement.style.background = region.color.stroke;
  };
  

  buttonElement.onclick = (e) => {
    e.stopPropagation();
    removeRegionFromMap(region.id);
  };
  
  // OpenLayers 相关说明
  const overlay = new Overlay({
    element: buttonElement,
    position: buttonPosition,
    positioning: 'bottom-left',
    offset: [5, -5],
    stopEvent: true
  });
  
  map.value.addOverlay(overlay);
  

  region.deleteOverlay = overlay;
}

/**
 * (
 */
function clearAllRegionsFromMap() {
  // 注释说明
  regions.value.forEach(region => {
    if (region.deleteOverlay && map.value) {
      map.value.removeOverlay(region.deleteOverlay);
    }
  });
  
  const count = clearAllRegions();
  polygonLayerSource.clear();
  centerLayerSource.clear();
  clearAiEvidenceBoundaries();
  clearHighlights();
  currentGeometry = null;
  currentGeometryType = null;


   if (count > 0) {
    emit('regions-cleared', { count });
  }

  return count;
}

/**
 *
 */
function removeRegionFromMap(regionId) {
  const region = getRegion(regionId);
  if (region) {
    // 注释说明
    if (region.olFeature) {
      polygonLayerSource.removeFeature(region.olFeature);
    }
    if (region.labelFeature) {
      centerLayerSource.removeFeature(region.labelFeature);
    }
    // 注释说明
    if (region.deleteOverlay && map.value) {
      map.value.removeOverlay(region.deleteOverlay);
    }

    removeRegion(regionId);
    

    emit('region-removed', { regionId, regionName: region.name });
    
    console.log(`[Map] 选区 ${region.name} 已删除，当前剩余 ${regions.value.length} 个选区`);
  }
}

/**
 *
 */
function clearHighlights() {
  highlightData.value = [];
  heatmapData.value = [];
  if (deckInstance) {
    updateDeckLayers();
  }
}

function parseBoundaryPayload(boundary) {
  if (typeof boundary !== 'string') return boundary;
  const raw = boundary.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toCoordinatePair(coord) {
  if (Array.isArray(coord) && coord.length >= 2) {
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat];
    }
  }

  if (coord && typeof coord === 'object') {
    const lonRaw = coord.lon ?? coord.lng ?? coord.longitude ?? coord.x;
    const latRaw = coord.lat ?? coord.latitude ?? coord.y;
    const lon = Number(lonRaw);
    const lat = Number(latRaw);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat];
    }
  }

  return null;
}

function extractBoundaryRings(boundary) {
  const payload = parseBoundaryPayload(boundary);
  if (!payload) return [];

  if (Array.isArray(payload)) {
    if (payload.length === 0) return [];

    if (toCoordinatePair(payload[0])) {
      return [payload];
    }

    const first = payload[0];
    if (Array.isArray(first) && toCoordinatePair(first[0])) {
      return [first];
    }

    return payload.flatMap((item) => extractBoundaryRings(item));
  }

  if (typeof payload !== 'object') {
    return [];
  }

  if (payload.type === 'Feature') {
    return extractBoundaryRings(payload.geometry);
  }

  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    return payload.features.flatMap((feature) => extractBoundaryRings(feature));
  }

  if (payload.type === 'Polygon') {
    return extractBoundaryRings(payload.coordinates);
  }

  if (payload.type === 'MultiPolygon' && Array.isArray(payload.coordinates)) {
    return payload.coordinates.flatMap((polygon) => extractBoundaryRings(polygon));
  }

  if (Array.isArray(payload.coordinates)) {
    return extractBoundaryRings(payload.coordinates);
  }

  if (Array.isArray(payload.boundary)) {
    return extractBoundaryRings(payload.boundary);
  }

  if (Array.isArray(payload.boundary_ring)) {
    return extractBoundaryRings(payload.boundary_ring);
  }

  if (payload.geometry && typeof payload.geometry === 'object') {
    return extractBoundaryRings(payload.geometry);
  }

  return [];
}

function normalizeClosedRing(ringCandidate) {
  const ring = (Array.isArray(ringCandidate) ? ringCandidate : [])
    .map((coord) => toCoordinatePair(coord))
    .filter(Boolean);

  if (ring.length < 3) return [];

  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    ring.push([firstLon, firstLat]);
  }

  return ring;
}

function toMapLonLat(lon, lat) {
  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  if (poiCoordSys.toLowerCase() === 'wgs84') {
    return wgs84ToGcj02(lon, lat);
  }
  return [lon, lat];
}

function ringToOlCoordinates(ringCandidate) {
  const ring = normalizeClosedRing(ringCandidate);
  if (ring.length < 4) return [];
  return ring.map(([lon, lat]) => {
    const [mapLon, mapLat] = toMapLonLat(lon, lat);
    return fromLonLat([mapLon, mapLat]);
  });
}

function toFiniteBoundaryConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function confidenceBucket(score) {
  const value = toFiniteBoundaryConfidence(score);
  if (value === null) return 'unknown';
  if (value >= 0.7) return 'high';
  if (value >= 0.4) return 'medium';
  return 'low';
}

function formatLegendPercent(value) {
  const score = toFiniteBoundaryConfidence(value);
  if (score === null) return '--';
  return `${Math.round(score * 100)}%`;
}

function resetAiBoundaryLegend() {
  aiBoundaryLegend.value = {
    visible: false,
    model: null,
    avg: null,
    min: null,
    max: null,
    buckets: { high: 0, medium: 0, low: 0 },
    anchorModel: null,
    semanticAnchorCoverage: null,
    dominantNicheType: null,
    avgWaterPenalty: null
  };
}

function updateAiBoundaryLegend({ stats = null, confidenceValues = [], renderedCount = 0 } = {}) {
  if (renderedCount <= 0) {
    resetAiBoundaryLegend();
    return;
  }

  const cleanValues = confidenceValues
    .map((value) => toFiniteBoundaryConfidence(value))
    .filter((value) => value !== null);

  const normalizedStats = stats && typeof stats === 'object' ? stats : {};
  const statAvg = toFiniteBoundaryConfidence(normalizedStats.avg_boundary_confidence);
  const statMin = toFiniteBoundaryConfidence(normalizedStats.min_boundary_confidence);
  const statMax = toFiniteBoundaryConfidence(normalizedStats.max_boundary_confidence);

  const avg = statAvg !== null
    ? statAvg
    : (cleanValues.length ? cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length : null);
  const min = statMin !== null ? statMin : (cleanValues.length ? Math.min(...cleanValues) : null);
  const max = statMax !== null ? statMax : (cleanValues.length ? Math.max(...cleanValues) : null);

  const buckets = { high: 0, medium: 0, low: 0 };
  cleanValues.forEach((value) => {
    const bucket = confidenceBucket(value);
    if (bucket in buckets) {
      buckets[bucket] += 1;
    }
  });

  aiBoundaryLegend.value = {
    visible: true,
    model: String(normalizedStats.boundary_confidence_model || 'composite_v5'),
    avg,
    min,
    max,
    buckets,
    anchorModel: normalizedStats.semantic_anchor_model ? String(normalizedStats.semantic_anchor_model) : null,
    semanticAnchorCoverage: toFiniteBoundaryConfidence(normalizedStats.semantic_anchor_coverage),
    dominantNicheType: normalizedStats.dominant_niche_type ? String(normalizedStats.dominant_niche_type) : null,
    avgWaterPenalty: toFiniteBoundaryConfidence(normalizedStats.avg_water_penalty)
  };
}

function createAiPolygonStyle(kind = 'generic', confidence = null) {
  const presets = {
    queryBoundary: { color: [59, 130, 246], fillAlpha: 0.08, strokeAlpha: 0.95, width: 3.0 },
    hotspot: { color: [249, 115, 22], fillAlpha: 0.12, strokeAlpha: 0.92, width: 2.0 },
    vernacular: { color: [244, 114, 182], fillAlpha: 0.10, strokeAlpha: 0.82, width: 2.0 },
    fuzzyOuter: { color: [56, 189, 248], fillAlpha: 0.08, strokeAlpha: 0.58, width: 1.6 },
    fuzzyTransition: { color: [168, 85, 247], fillAlpha: 0.10, strokeAlpha: 0.75, width: 2.0 },
    fuzzyCore: { color: [16, 185, 129], fillAlpha: 0.15, strokeAlpha: 0.90, width: 2.4 },
    generic: { color: [148, 163, 184], fillAlpha: 0.06, strokeAlpha: 0.75, width: 1.8 }
  };

  const preset = presets[kind] || presets.generic;
  const score = toFiniteBoundaryConfidence(confidence);
  const confidenceFactor = score === null ? 1 : (0.45 + score * 0.55);
  const fillAlpha = Math.max(0.02, Math.min(0.98, preset.fillAlpha * confidenceFactor));
  const strokeAlpha = Math.max(0.08, Math.min(0.98, preset.strokeAlpha * (score === null ? 1 : (0.35 + score * 0.65))));
  const strokeWidth = Math.max(1, preset.width * (score === null ? 1 : (0.75 + score * 0.5)));
  const [r, g, b] = preset.color;

  let lineDash;
  if (score !== null && score < 0.4) {
    lineDash = [8, 8];
  } else if (score !== null && score < 0.7) {
    lineDash = [6, 5];
  }

  return new Style({
    fill: new Fill({ color: `rgba(${r}, ${g}, ${b}, ${fillAlpha.toFixed(3)})` }),
    stroke: new Stroke({
      color: `rgba(${r}, ${g}, ${b}, ${strokeAlpha.toFixed(3)})`,
      width: Number(strokeWidth.toFixed(2)),
      lineDash,
      lineJoin: 'round',
      lineCap: 'round'
    })
  });
}

function addAiBoundaryFeature(boundary, kind = 'generic', options = {}) {
  const rings = extractBoundaryRings(boundary);
  if (!rings.length) return 0;

  const confidence = toFiniteBoundaryConfidence(options.confidence);
  const onFeatureAdded = typeof options.onFeatureAdded === 'function' ? options.onFeatureAdded : null;
  const label = typeof options.label === 'string' ? options.label.trim() : '';
  const meta = options.meta && typeof options.meta === 'object' ? options.meta : null;

  let addedCount = 0;
  rings.forEach((ringCandidate) => {
    const olCoords = ringToOlCoordinates(ringCandidate);
    if (olCoords.length < 4) return;

    const feature = new Feature({
      geometry: new Polygon([olCoords])
    });

    if (label) {
      feature.set('__aiBoundaryLabel', label);
    }
    feature.set('__aiBoundaryKind', kind);
    feature.set('__aiBoundaryConfidence', confidence);
    if (meta) {
      feature.set('__aiBoundaryMeta', meta);
    }
    feature.setStyle(createAiPolygonStyle(kind, confidence));
    aiEvidenceLayerSource.addFeature(feature);
    addedCount += 1;

    if (onFeatureAdded) {
      onFeatureAdded(confidence);
    }
  });

  return addedCount;
}

function fitToAiEvidenceIfNeeded(shouldFit = false) {
  if (!shouldFit || !map.value) return;
  const extent = aiEvidenceLayerSource.getExtent();
  if (!extent || isEmptyExtent(extent)) return;
  map.value.getView().fit(extent, {
    padding: [60, 60, 60, 60],
    duration: 600,
    maxZoom: 16
  });
}

function clearAiEvidenceBoundaries() {
  aiEvidenceLayerSource.clear();
  resetAiBoundaryLegend();
  hidePoiPopup();
}

function showAnalysisBoundary(boundary, options = {}) {
  const { fitView = true, clear = true, clearLocate = true, label = '片区边界' } = options;
  if (clear) clearAiEvidenceBoundaries();
  if (clearLocate) locateLayerSource.clear();
  addAiBoundaryFeature(boundary, 'queryBoundary', { label });
  aiBoundaryLegend.value.visible = false;
  fitToAiEvidenceIfNeeded(fitView);
}

function showAiSpatialEvidence(payload = {}, options = {}) {
  const inputPayload = payload && typeof payload === 'object' ? payload : {};
  const { fitView = false, clear = true, clearLocate = true } = options;
  if (clear) clearAiEvidenceBoundaries();
  if (clearLocate) locateLayerSource.clear();

  const normalized = normalizeAiEvidencePayload(inputPayload);
  const clusters = normalized.clusters;
  const vernacularRegions = normalized.vernacularRegions;
  const fuzzyRegions = normalized.fuzzyRegions;
  const boundary = normalized.boundary;
  const stats = normalized.stats;

  const confidenceValues = [];
  const collectConfidence = (value) => {
    const score = toFiniteBoundaryConfidence(value);
    if (score !== null) {
      confidenceValues.push(score);
    }
  };

  let renderedCount = 0;

  const hotspotList = Array.isArray(clusters?.hotspots) ? clusters.hotspots : [];

  if (hotspotList.length) {
    hotspotList.slice(0, 8).forEach((hotspot) => {
      const hotspotBoundary =
        hotspot.boundary_geojson ||
        hotspot.layers?.transition?.geojson ||
        hotspot.boundary ||
        hotspot.layers?.transition?.boundary ||
        hotspot.layers?.outer?.boundary ||
        hotspot.boundary_ring;
      const hotspotLabel = String(
        hotspot.name ||
        hotspot.dominantCategories?.[0]?.category ||
        hotspot.dominant_categories?.[0]?.category ||
        '高活力片区'
      );
      renderedCount += addAiBoundaryFeature(hotspotBoundary, 'hotspot', {
        confidence: hotspot.boundary_confidence,
        label: hotspotLabel,
        meta: buildAiBoundaryMeta(hotspot),
        onFeatureAdded: collectConfidence
      });
    });
  }

  if (Array.isArray(vernacularRegions) && vernacularRegions.length > 0) {
    vernacularRegions.slice(0, 8).forEach((region) => {
      const regionBoundary = resolveRegionBoundary(region);
      const regionLabel = String(region.name || region.dominant_category || region.theme || '生态片区');
      renderedCount += addAiBoundaryFeature(regionBoundary, 'vernacular', {
        confidence: region.boundary_confidence,
        label: regionLabel,
        meta: buildAiBoundaryMeta(region),
        onFeatureAdded: collectConfidence
    });
    });
  }

  if (Array.isArray(fuzzyRegions) && fuzzyRegions.length > 0) {
    fuzzyRegions.slice(0, 10).forEach((region) => {
      const baseLabel = String(region.name || region.theme || '片区');
      const layers = resolveFuzzyLayerBundle(region);

      // V5 路网地块边界：没有多层结构时只渲染单层，避免 3x 重复渲染导致卡顿
      const hasDistinctLayers = region.layers && (
        region.layers.outer?.boundary !== region.layers.transition?.boundary ||
        region.layers.transition?.boundary !== region.layers.core?.boundary
      );

      if (hasDistinctLayers) {
        // 有真正的多层模糊边界（V1-V4）
        renderedCount += addAiBoundaryFeature(layers.outer.boundary, 'fuzzyOuter', {
          confidence: layers.outer.confidence,
          label: `${baseLabel}（外层）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'outer' }),
          onFeatureAdded: collectConfidence
        });
        renderedCount += addAiBoundaryFeature(layers.transition.boundary, 'fuzzyTransition', {
          confidence: layers.transition.confidence,
          label: `${baseLabel}（过渡层）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'transition' }),
          onFeatureAdded: collectConfidence
        });
        renderedCount += addAiBoundaryFeature(layers.core.boundary, 'fuzzyCore', {
          confidence: layers.core.confidence,
          label: `${baseLabel}（核心层）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'core' }),
          onFeatureAdded: collectConfidence
        });
      } else {
        // V5 单层边界：只渲染一次
        const singleBoundary = layers.core.boundary || layers.transition.boundary || layers.outer.boundary;
        renderedCount += addAiBoundaryFeature(singleBoundary, 'fuzzyCore', {
          confidence: layers.core.confidence,
          label: `${baseLabel}（核心区）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'core' }),
          onFeatureAdded: collectConfidence
        });
      }
    });
  }

  if (renderedCount === 0 && boundary) {
    renderedCount += addAiBoundaryFeature(boundary, 'queryBoundary', {
      label: inputPayload.boundary_label || inputPayload.boundaryLabel || '边界'
    });
  }

  updateAiBoundaryLegend({
    stats,
    confidenceValues,
    renderedCount
  });

  fitToAiEvidenceIfNeeded(fitView);
}

/**
 * deck.gl 相关说明
 * @param {Array} features - 要素列表
 * @param {Object} options - 可选参数
 */
function showHighlights(features, options = {}) {
  // deck.gl 相关说明
  if (!features || !features.length) {
    clearHighlights();
    if (deckInstance) {
      updateDeckLayers();
    }
    return;
  }
  
  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  
  // deck.gl 相关说明
  const deckData = features.map(raw => {
    let [lon, lat] = raw.geometry.coordinates;

    if (poiCoordSys.toLowerCase() === 'wgs84') {
      [lon, lat] = wgs84ToGcj02(lon, lat);
    }
    return {
      lon,
      lat,
      groupIndex: raw.properties._groupIndex || 0,
      raw,
    };
  });
  

  highlightData.value = deckData;
  heatmapData.value = deckData;
  ensureDeckInitialized().then((instance) => {
    if (!instance) return;
    updateDeckLayers();
    scheduleDeckSync();
  });
  

  if (options.fitView && map.value) {

    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    deckData.forEach(d => {
      minLon = Math.min(minLon, d.lon);
      maxLon = Math.max(maxLon, d.lon);
      minLat = Math.min(minLat, d.lat);
      maxLat = Math.max(maxLat, d.lat);
    });
    

    if (minLon <= maxLon && minLat <= maxLat) {
      // Web Mercator 坐标说明
      const extent = [
        ...fromLonLat([minLon, minLat]),
        ...fromLonLat([maxLon, maxLat])
      ];
      
      map.value.getView().fit(extent, {
        padding: [50, 50, 50, 50],
        duration: 800,
        maxZoom: 16
      });
    }
  }
}


watch(heatmapEnabled, (enabled) => {
  if (enabled) {
    ensureDeckInitialized().then((instance) => {
      if (!instance) return;
      updateDeckLayers();
      scheduleDeckSync();
    });
    return;
  }
  updateDeckLayers();
});

/**
 *
 * @param {Object} polygonGeom - 多边形几何对象
 * @param {boolean} isRefresh - 是否为刷新触发
 */
function onPolygonComplete(polygonGeom, isRefresh = false) {
  if (!isRefresh) {
    currentGeometry = polygonGeom;
    currentGeometryType = 'Polygon';
  }
  const ringCoords = polygonGeom.getCoordinates()[0];
  const ringPixels = ringCoords.map((c) => map.value.getPixelFromCoordinate(c));

  const insideRaw = [];
  // POI 相关说明
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const px = map.value.getPixelFromCoordinate(coord);
    if (pointInPolygonPixel(px, ringPixels)) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  
  // 注释说明

  // +
  const centerPixelObj = calculatePolygonCenter(ringPixels);
  

  const geoCenter = calculatePolygonGeoCenter(ringCoords);
  
  // ( -
  centerLayerSource.clear();
  if (geoCenter) {
    const centerFeature = new Feature({
      geometry: new Point(geoCenter)
    });
    centerLayerSource.addFeature(centerFeature);
  }

  showHighlights(insideRaw, { full: true });
  
  emit('polygon-completed', { 
    polygon: ringCoords.map((c) => toLonLat(c)), 
    center: centerPixelObj,
    selected: insideRaw,
    type: 'Polygon',
    polygonCenter: geoCenter ? toLonLat(geoCenter) : null
  });
}

/**
 *
 */
function calculatePolygonCenter(ringPixels) {
  let x = 0, y = 0;
  const n = ringPixels.length;
  
  for (let i = 0; i < n; i++) {
    x += ringPixels[i][0];
    y += ringPixels[i][1];
  }
  
  return { x: x / n, y: y / n };
}

/**
 *
 * @param {Array} ringCoords - 多边形环坐标
 * @returns {Array} 返回值说明
 */
function calculatePolygonGeoCenter(ringCoords) {
  if (!ringCoords || ringCoords.length === 0) return null;
  
  let x = 0, y = 0;
  const n = ringCoords.length;
  
  for (let i = 0; i < n; i++) {
    x += ringCoords[i][0];
    y += ringCoords[i][1];
  }
  
  return [x / n, y / n];
}

/**
 *
 * @param {Array} pt - 点坐标
 * @param {Array} ringPixels - 像素环坐标
 */
function pointInPolygonPixel(pt, ringPixels) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ringPixels.length - 1; i < ringPixels.length; j = i++) {
    const xi = ringPixels[i][0], yi = ringPixels[i][1];
    const xj = ringPixels[j][0], yj = ringPixels[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 69
function clearPolygon() {
  polygonLayerSource.clear();
  centerLayerSource.clear();
  locateLayerSource.clear();
  clearAiEvidenceBoundaries();
  clearHighlights();
  currentGeometry = null;
  currentGeometryType = null;
  hasLocatedOnce = false;
  currentLocatedPoi = null; // POI 相关说明
}

/**
 *
 * @param {Array} coordinates - GeoJSON 坐标数组
 */
function addUploadedPolygon(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    import('element-plus').then(({ ElNotification }) => {
      ElNotification({
        title: 'Upload failed',
        message: 'Invalid polygon coordinates in uploaded file.',
        type: 'error',
        duration: 3500
      });
    });
    return;
  }

  // 注释说明
  if (!canAddRegion.value) {
    import('element-plus').then(({ ElNotification }) => {
      ElNotification({
        title: 'Region limit reached',
        message: `Only ${MAX_REGIONS} regions are allowed. Remove one before uploading another.`,
        type: 'warning',
        duration: 4000
      });
    });
    return;
  }

  const closedCoordinates = [...coordinates];
  const first = closedCoordinates[0];
  const last = closedCoordinates[closedCoordinates.length - 1];
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    closedCoordinates.push(first);
  }

  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  const olCoords = closedCoordinates.map(coord => {
    let [lon, lat] = coord;
    if (poiCoordSys.toLowerCase() === 'wgs84') {
      [lon, lat] = wgs84ToGcj02(lon, lat);
    }
    return fromLonLat([lon, lat]);
  });

  const geometry = new Polygon([olCoords]);
  const polygonFeature = new Feature({ geometry });
  polygonLayerSource.addFeature(polygonFeature);

  currentGeometry = geometry;
  currentGeometryType = 'Polygon';

  // 注释说明
  onPolygonCompleteMulti(geometry, polygonFeature);

  const extent = geometry.getExtent();
  map.value.getView().fit(extent, {
    padding: [50, 50, 50, 50],
    duration: 500
  });

  console.log('[MapContainer] Uploaded polygon is registered as a region');
}


defineExpose({
  map,
  openPolygonDraw,
  closePolygonDraw,
  showHighlights,
  showAnalysisBoundary,
  showAiSpatialEvidence,
  clearAiEvidenceBoundaries,
  clearHighlights,
  clearPolygon,
  clearAllRegionsFromMap,
  flyTo,
  addUploadedPolygon,
  clearPOIs: () => {
    centerLayerSource.clear();
    showHighlights([]);
  },
  highlightPOIs: (features, opts) => showHighlights(features, opts),
  setRegions: (newRegions) => {
    regions.value = newRegions;
    if (newRegions.length > 0) {
      if (globalAnalysisEnabled.value) {
        globalAnalysisEnabled.value = false;
        emit('global-analysis-change', false);
      }
    }
  },
  captureMapScreenshot
});

// 注释说明
// ()

function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat];
  const dlat = transformLat(lon - 105.0, lat - 35.0);
  const dlon = transformLon(lon - 105.0, lat - 35.0);
  const radlat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radlat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  const dLon = (dlon * 180.0) / (a / sqrtMagic * Math.cos(radlat) * Math.PI);
  const mgLat = lat + dLat;
  const mgLon = lon + dLon;
  return [mgLon, mgLat];
}

const a = 6378245.0;
const ee = 0.00669342162296594323;
function outOfChina(lon, lat) {
  return (lon < 72.004 || lon > 137.8347) || (lat < 0.8293 || lat > 55.8271);
}
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

/**
 * 捕获当前地图和叠加层的截图
 * 用于发给 VLM 进行视觉审查和地图文字/形态解析
 */
async function captureMapScreenshot() {
  if (!mapContainer.value) return null;
  try {
    if (!html2canvasModulePromise) {
      html2canvasModulePromise = import('html2canvas')
        .then((mod) => mod.default || mod)
        .catch((error) => {
          html2canvasModulePromise = null;
          throw error;
        });
    }
    const html2canvas = await html2canvasModulePromise;
    const canvas = await html2canvas(mapContainer.value, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#000000',
      scale: 0.75,
    });
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('[MapContainer] Screenshot capture failed:', err);
    return null;
  }
}


</script>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.map-container {
  width: 100%;
  height: 100%;
  background-color: #000;
}

.map-filter-control {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.7); /*  */
  backdrop-filter: blur(12px); /**/
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(99, 102, 241, 0.3); /**/
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  min-width: 160px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.filter-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.filter-label.disabled {
  color: rgba(255, 255, 255, 0.3);
}

.control-divider {
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.4), transparent);
  margin: 4px 0;
  border: none;
  flex-shrink: 0;
}

.weight-dialog-content {
  padding: 10px 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/*  */
.control-hint {
  font-size: 11px;
  color: #67c23a;
  padding: 4px 0 0 0;
  animation: fadeIn 0.3s ease-out;
}

.control-hint span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-boundary-legend {
  position: absolute;
  left: 10px;
  bottom: 12px;
  z-index: 1100;
  min-width: 220px;
  max-width: 320px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(10px);
  color: #e2e8f0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
  pointer-events: none;
}

.legend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.legend-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.legend-model {
  font-size: 10px;
  color: #93c5fd;
}

.legend-stats {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.9);
  margin-bottom: 8px;
}

.legend-semantic {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 8px;
  font-size: 10px;
  color: rgba(191, 219, 254, 0.88);
}

.legend-scale {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(226, 232, 240, 0.92);
}

.legend-swatch {
  width: 18px;
  height: 0;
  border-top-width: 2px;
  border-top-style: solid;
  border-radius: 999px;
  flex-shrink: 0;
}

.legend-item.high .legend-swatch {
  border-top-color: rgba(16, 185, 129, 0.95);
}

.legend-item.medium .legend-swatch {
  border-top-color: rgba(251, 191, 36, 0.88);
  border-top-style: dashed;
}

.legend-item.low .legend-swatch {
  border-top-color: rgba(239, 68, 68, 0.86);
  border-top-style: dashed;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

/* POI 相关说明 */
.poi-popup {
  position: absolute;
  background: rgba(15, 23, 42, 0.9);
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  border: 1px solid rgba(99, 102, 241, 0.5);
  transform: translate(-50%, -100%);
  margin-top: -10px;
  z-index: 2000;
  backdrop-filter: blur(4px);
}

.popup-content {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  white-space: normal;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 300px;
  overflow: hidden;
}

.popup-title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.3;
}

.popup-detail {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(226, 232, 240, 0.92);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.popup-arrow {
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid #16213e;
  margin: 0 auto;
}

@keyframes popupFadeIn {
  from { 
    opacity: 0; 
    transform: translate(-50%, -90%); 
  }
  to { 
    opacity: 1; 
    transform: translate(-50%, -100%); 
  }
}

@media (max-width: 768px) {
  .map-filter-control {
    display: none !important;
  }

  .ai-boundary-legend {
    left: 8px;
    right: 8px;
    bottom: 8px;
    min-width: 0;
    max-width: none;
    padding: 9px 10px;
  }

  .legend-stats {
    flex-wrap: wrap;
    gap: 6px 10px;
  }
}

/* 注释说明 */
/* 注释说明 */
.map-filter-control :deep(.el-switch:not(.is-checked)) {
  --el-switch-off-color: #475569; /* 注释说明 */
}

/* 注释说明 */
.map-filter-control :deep(.el-switch:not(.is-checked) .el-switch__core) {
  background-color: #475569 !important;
  border-color: #475569 !important;
}

/* 注释说明 */
.map-filter-control :deep(.el-switch.is-checked .el-switch__core) {
  background-color: #4338ca !important;
  border-color: #4338ca !important;
}

/*  */
.map-filter-control :deep(.el-switch:not(.is-checked) .el-switch__inner .is-text) {
  color: #ffffff !important;
  font-weight: 500;
}
</style>


