<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container"></div>
    
    <!-- POI 名称气泡 -->
    <div ref="poiPopup" class="poi-popup" v-show="popupVisible">
      <div class="popup-content">{{ popupName }}</div>
      <div class="popup-arrow"></div>
    </div>
    
    <!-- 实时过滤 & 热力图控制 -->
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
      
      
      <!-- 新增：标签权重控件 -->
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
      
      <!-- 全域感知控件（GeoLoom-RAG 增强）- 仅示意 -->
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
    
    <!-- 权重选择弹窗 -->
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

// deck.gl 高性能渲染
import { Deck } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import { HeatmapLayer as DeckHeatmapLayer } from '@deck.gl/aggregation-layers';

// 多选区管理
import { useRegions, REGION_COLORS, MAX_REGIONS } from '../composables/useRegions';

/**
 * 定义组件事件
 * polygon-completed: 当绘制完成（多边形或圆形）并筛选出 POI 时触发
 * map-ready: 地图初始化完成时触发
 * hover-feature: 当鼠标悬停在 POI 上时触发
 * click-feature: 当鼠标点击 POI 时触发
 * map-move-end: 当地图移动结束（视野变化）时触发
 * toggle-filter: 当切换实时过滤开关时触发
 * toggle-overlay: 当切换叠加模式时触发
 * weight-change: 当权重设置变化时触发
 * region-added: 当添加新选区时触发
 * region-removed: 当删除选区时触发
 * regions-cleared: 当清空所有选区时触发
 */
const emit = defineEmits([
  'polygon-completed', 'map-ready', 'hover-feature', 'click-feature', 
  'map-move-end', 'toggle-filter', 'toggle-overlay', 'weight-change', 
  'global-analysis-change', 'region-added', 'region-removed', 'regions-cleared'
]);

/**
 * 定义组件属性
 * poiFeatures: 原始 POI 数据数组（GeoJSON Feature 格式）
 * hoveredFeatureId: 当前被悬停的 Feature 对象（来自 TagCloud 组件）
 */
const props = defineProps({
  poiFeatures: { type: Array, default: () => [] },
  hoveredFeatureId: { type: Object, default: null }, // 我们直接使用 feature 对象作为 ID
  // 外部控制的状态
  filterEnabled: { type: Boolean, default: false },
  heatmapEnabled: { type: Boolean, default: false },
  overlayEnabled: { type: Boolean, default: false },
  weightEnabled: { type: Boolean, default: false },
  showWeightValue: { type: Boolean, default: false },
  globalAnalysisEnabled: { type: Boolean, default: true },
  showControls: { type: Boolean, default: true },
});

// 地图容器 DOM 引用
const mapContainer = ref(null);
// OpenLayers 地图实例
const map = ref(null);
// 当前的绘制交互对象（用于多边形或圆形绘制）
let drawInteraction = null;
// 内部跟踪当前地图上悬停的 feature
let hoveredFeature = null; 
// 实时过滤开关状态
const filterEnabled = ref(props.filterEnabled);
// 热力图开关状态
const heatmapEnabled = ref(props.heatmapEnabled);


// ============ 权重控制相关状态 ============
const weightEnabled = ref(props.weightEnabled); // 标签权重开关
const showWeightValue = ref(props.showWeightValue); // 显示权重值开关
const weightDialogVisible = ref(false); // 权重选择弹窗可见性
const selectedWeightType = ref('population'); // 选择的权重类型
const weightLoading = ref(false); // 权重加载状态

// 监听 props 变化同步内部状态
watch(() => props.filterEnabled, (val) => { filterEnabled.value = val; });
watch(() => props.heatmapEnabled, (val) => { heatmapEnabled.value = val; });

watch(() => props.weightEnabled, (val) => { weightEnabled.value = val; });
watch(() => props.showWeightValue, (val) => { showWeightValue.value = val; });

// ============ POI 名称气泡 ============
const poiPopup = ref(null); // 气泡 DOM 引用
const popupVisible = ref(false); // 气泡是否可见
const popupName = ref(''); // 气泡显示的名称

// 权重选项
const weightOptions = ref([
  { value: 'population', label: '人口密度' },
]);

// ============ 多选区管理 ============
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

// 缓存当前绘制的几何图形，用于数据更新时重新筛选 (保留单选区兼容)
let currentGeometry = null;
let currentGeometryType = null; // 'Polygon' | 'Circle'

/**
 * 切换实时过滤状态
 * @param {boolean} val - 开关状态
 */
const toggleFilter = (val) => {
  emit('toggle-filter', val);
};



/**
 * 处理标签权重开关变化
 * 开启时显示权重选择弹窗
 */
function handleWeightToggle(val) {
  if (val) {
    // 开启时，显示权重选择弹窗
    weightDialogVisible.value = true;
  } else {
    // 关闭时，同时关闭显示权重值
    showWeightValue.value = false;
    emit('weight-change', { enabled: false, showValue: false });
  }
}

/**
 * 处理显示权重值开关变化
 */
function handleShowWeightToggle(val) {
  emit('weight-change', { enabled: weightEnabled.value, showValue: val });
}


/**
 * 取消权重选择弹窗
 */
function cancelWeightDialog() {
  weightDialogVisible.value = false;
  weightEnabled.value = false;
}

/**
 * 确认权重选择
 */
async function confirmWeightDialog() {
  if (!selectedWeightType.value) {
    return;
  }
  
  weightLoading.value = true;
  
  // 发送权重启用事件，让父组件通知 TagCloud 加载栅格
  emit('weight-change', { 
    enabled: true, 
    showValue: showWeightValue.value,
    weightType: selectedWeightType.value,
    needLoad: true  // 表示需要加载栅格
  });
  
  // 延迟关闭弹窗
  setTimeout(() => {
    weightLoading.value = false;
    weightDialogVisible.value = false;
    // 强制同步父组件状态 (可选)
    emit('weight-change', { 
      enabled: true, 
      showValue: showWeightValue.value,
      weightType: selectedWeightType.value,
      needLoad: true 
    });
  }, 500);
}

// --- 图层定义 ---

// 1. 多边形绘制图层（保留 OpenLayers，用于绘制交互）
const polygonLayerSource = new VectorSource();
const polygonLayer = new VectorLayer({
  source: polygonLayerSource,
  style: new Style({
    stroke: new Stroke({ color: '#2ecc71', width: 2 }),
    fill: new Fill({ color: 'rgba(46,204,113,0.1)' }),
  }),
  zIndex: 50
});

// 2. 圆心标记图层（保留 OpenLayers）
const centerLayerSource = new VectorSource();
const centerLayer = new VectorLayer({
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

// 3. 悬停高亮图层（保留 OpenLayers，仅用于单个悬停点）
const hoverLayerSource = new VectorSource();
const hoverLayer = new VectorLayer({
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

// 4. 定位高亮图层（水蓝色五角星，最高层级）
const locateLayerSource = new VectorSource();
const locateLayer = new VectorLayer({
  source: locateLayerSource,
  style: new Style({
    image: new RegularShape({
      points: 5,
      radius: 8,
      radius2: 6,
      fill: new Fill({ color: '#00BFFF' }),      // 水蓝色填充
      stroke: new Stroke({ color: '#0080FF', width: 1 })  // 深蓝色描边
    })
  }),
  zIndex: 300
});

// --- deck.gl 高性能渲染层 ---
// 使用 deck.gl 替代 OpenLayers 的 VectorLayer 和 HeatmapLayer
// deck.gl 使用 WebGL 渲染，可以处理数万个点而不卡顿

let deckInstance = null; // deck.gl 实例
let deckContainer = null; // deck.gl 的 canvas 容器
const highlightData = ref([]); // 用于 deck.gl ScatterplotLayer 的高亮数据
const heatmapData = ref([]); // 用于 deck.gl HeatmapLayer (POI 密度) 的热力图数据

// 当前定位的 POI（用于在 deck.gl 中隐藏该点，用 OpenLayers 显示五角星）
let currentLocatedPoi = null;

// 缓存的 OpenLayers Feature 对象（仅用于绘制筛选）
let olPoiFeatures = [];
// 映射表：原始数据对象 -> OpenLayers Feature 对象
let rawToOlMap = new Map();

/**
 * 获取 deck.gl 视图状态（从 OpenLayers 同步）
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
  
  // 将 EPSG:3857 坐标转换为经纬度
  const [lon, lat] = toLonLat(center);
  
  return {
    longitude: lon,
    latitude: lat,
    zoom: zoom - 1, // deck.gl vs OpenLayers zoom 偏移
    bearing: (-rotation * 180) / Math.PI,
    pitch: 0,
  };
}

/**
 * 根据分组索引获取颜色
 */
function getColorByGroupIndex(groupIndex) {
  // 扩展颜色列表：前几个颜色差异大，后续颜色递进
  const colors = [
    [255, 0, 0, 180],      // 红色
    [0, 128, 255, 180],    // 蓝色
    [0, 200, 80, 180],     // 绿色
    [255, 165, 0, 180],    // 橙色
    [138, 43, 226, 180],   // 紫色
    [0, 206, 209, 180],    // 青色
    [255, 20, 147, 180],   // 深粉
    [255, 215, 0, 180],    // 金色
    [70, 130, 180, 180],   // 钢青
    [154, 205, 50, 180],   // 黄绿
    [220, 20, 60, 180],    // 猩红
    [0, 139, 139, 180],    // 深青
  ];
  return colors[groupIndex % colors.length] || colors[0];
}

/**
 * 更新 deck.gl 图层
 */
function updateDeckLayers() {
  if (!deckInstance) return;
  
  const zoom = map.value?.getView()?.getZoom() || 13;
  
  // 根据缩放级别动态调整热力图参数
  const minZ = 10, maxZ = 16;
  const clampedZoom = Math.max(minZ, Math.min(maxZ, zoom));
  const ratio = (clampedZoom - minZ) / (maxZ - minZ);
  // 增大热力图半径范围: 远 -> 80, 近 -> 30
  const heatmapRadius = Math.round(90 - ratio * (90 - 40));
  
  const layers = [
    // 高亮点图层 - 使用 ScatterplotLayer
    // 当前定位的 POI 会被过滤掉（用 OpenLayers 五角星显示）
    new ScatterplotLayer({
      id: 'highlight-layer',
      data: highlightData.value.filter(d => {
        // 过滤掉当前定位的 POI
        if (!currentLocatedPoi) return true;
        const coords = currentLocatedPoi.geometry?.coordinates;
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
        return [fill[0], fill[1], fill[2]]; // 移除 alpha
      },
      updateTriggers: {
        getFillColor: [highlightData.value, currentLocatedPoi],
        getPosition: [highlightData.value, currentLocatedPoi],
      },
    }),
    
    // POI 密度热力图图层
    new DeckHeatmapLayer({
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
 * 同步 OpenLayers 视图到 deck.gl
 */
function syncDeckView() {
  if (!deckInstance || !map.value) return;
  deckInstance.setProps({ viewState: getDeckViewState() });
}

// 动画帧 ID，用于持续同步
let syncAnimationId = null;

/**
 * 开始持续同步视图（处理平滑动画）
 */
function startViewSync() {
  const sync = () => {
    syncDeckView();
    updateDeckLayers();
    syncAnimationId = requestAnimationFrame(sync);
  };
  sync();
}

onMounted(() => {
  // 基础底图：高德地图 XYZ 瓦片
  const amapKey = import.meta.env.VITE_AMAP_KEY || '2b42a2f72ef6751f2cd7c7bd24139e72';
  const gaodeUrl = `https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}&key=${amapKey}`;

  const baseLayer = new TileLayer({
    source: new XYZ({ url: gaodeUrl, crossOrigin: 'anonymous' })
  });

  // 初始化 OpenLayers 地图（仅保留绘制相关图层）
  map.value = new OlMap({
    target: mapContainer.value,
    layers: [baseLayer, polygonLayer, centerLayer, hoverLayer, locateLayer],
    controls: [], // 移除默认控件（包括缩放按钮）
    view: new View({
      center: fromLonLat([114.33, 30.58]),
      zoom: 14,
    }),
  });

  // 创建 deck.gl 容器
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

  // 初始化 deck.gl
  deckInstance = new Deck({
    parent: deckContainer,
    style: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
    initialViewState: getDeckViewState(),
    controller: false,
    layers: [],
    getTooltip: null,
    pickingRadius: 8,
  });
  
  // 确保 deck.gl 的 canvas 不阻挡地图拖拽
  nextTick(() => {
    if (deckContainer) {
      const canvas = deckContainer.querySelector('canvas');
      if (canvas) {
        canvas.style.pointerEvents = 'none';
      }
    }
  });
  
  // 交互通过 onPointerMove 和 onMapClick 中调用 deckInstance.pickObject 实现

  // 绑定 OpenLayers 地图事件
  map.value.on('moveend', onMapMoveEnd);
  map.value.on('pointermove', onPointerMove);
  map.value.on('singleclick', onMapClick);
  
  // 监听视图变化以同步 deck.gl
  map.value.getView().on('change:resolution', syncDeckView);
  map.value.getView().on('change:center', syncDeckView);
  map.value.getView().on('change:rotation', syncDeckView);

  // 开始持续视图同步
  startViewSync();

  // 初始化 POI 特征
  rebuildPoiOlFeatures();

  // 初始化完成后通知父组件
  nextTick(() => {
    emit('map-ready', map.value);
  });
});

// 监听来自 TagCloud 的悬停事件
watch(() => props.hoveredFeatureId, (newVal) => {
  hoverLayerSource.clear();
  if (newVal && rawToOlMap.has(newVal)) {
    const olFeature = rawToOlMap.get(newVal);
    // 克隆 Feature 以显示在悬停图层中
    const clone = olFeature.clone();
    // 显式复制 __raw 属性，确保克隆对象也包含原始数据
    // 这对于反向交互（从地图悬停克隆对象 -> TagCloud）至关重要
    clone.set('__raw', olFeature.get('__raw'));
    hoverLayerSource.addFeature(clone);
  }
});

/**
 * 地图移动结束处理
 * 计算当前视野的边界并发送给父组件
 */
function onMapMoveEnd() {
  if (!map.value) return;
  const extent = map.value.getView().calculateExtent(map.value.getSize());
  const bl = toLonLat([extent[0], extent[1]]); // 左下角
  const tr = toLonLat([extent[2], extent[3]]); // 右上角
  // [最小经度, 最小纬度, 最大经度, 最大纬度]
  emit('map-move-end', [bl[0], bl[1], tr[0], tr[1]]);
}

// 防抖工具函数
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// 防抖发射悬停事件，避免频繁触发
const emitHover = debounce((feature) => {
  emit('hover-feature', feature);
}, 50); // 50ms 防抖

/**
 * 地图点击处理
 * 使用 deck.gl pickObject 检测高亮点，并显示 POI 名称气泡
 */
function onMapClick(evt) {
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let foundRaw = null;
  
  // 1. 首先在 OpenLayers 图层中检测（悬停图层等）
  map.value.forEachFeatureAtPixel(pixel, (feature) => {
    const raw = feature.get('__raw');
    if (raw) {
      foundRaw = raw;
      return true;
    }
  }, { hitTolerance: 10 });
  
  // 2. 如果 OpenLayers 未检测到，使用 deck.gl pickObject
  if (!foundRaw && deckInstance && pixel && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1])) {
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
      // deck.gl 可能未完全初始化，忽略 pick 错误
    }
  }
  
  if (foundRaw) {
    console.log('[MapContainer] 点击了要素:', foundRaw);
    emit('click-feature', foundRaw);
    
    // 显示 POI 名称气泡
    showPoiPopup(foundRaw, evt.originalEvent);
  } else {
    // 点击空白处关闭气泡
    hidePoiPopup();
  }
}

/**
 * 显示 POI 名称气泡
 */
function showPoiPopup(feature, event) {
  const props = feature.properties || feature;
  const name = props['名称'] || props.name || '未知名称';
  
  popupName.value = name;
  popupVisible.value = true;
  
  // 定位气泡到点击位置
  nextTick(() => {
    if (poiPopup.value) {
      const mapRect = mapContainer.value.getBoundingClientRect();
      const x = event.clientX - mapRect.left;
      const y = event.clientY - mapRect.top;
      
      poiPopup.value.style.left = `${x}px`;
      poiPopup.value.style.top = `${y - 10}px`; // 稍微向上偏移
    }
  });
  
  // 3秒后自动关闭
  setTimeout(() => {
    hidePoiPopup();
  }, 3000);
}

/**
 * 隐藏 POI 名称气泡
 */
function hidePoiPopup() {
  popupVisible.value = false;
}

/**
 * 鼠标移动处理（悬停效果）
 * 使用 deck.gl pickObject 检测高亮点
 */
function onPointerMove(evt) {
  if (evt.dragging) return;
  
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let hitRaw = null;
  
  // 1. 首先在 OpenLayers 图层中检测
  map.value.forEachFeatureAtPixel(pixel, (feature) => {
    if (feature.get('__raw')) {
      hitRaw = feature.get('__raw');
      return true;
    }
  }, { hitTolerance: 8 });
  
  // 2. 如果 OpenLayers 未检测到，使用 deck.gl pickObject
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
      // deck.gl 可能未完全初始化，忽略 pick 错误
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
  // 停止视图同步动画
  if (syncAnimationId) {
    cancelAnimationFrame(syncAnimationId);
    syncAnimationId = null;
  }
  
  // 销毁 deck.gl 实例
  if (deckInstance) {
    deckInstance.finalize();
    deckInstance = null;
  }
  
  // 移除 deck.gl 容器
  if (deckContainer && deckContainer.parentNode) {
    deckContainer.parentNode.removeChild(deckContainer);
    deckContainer = null;
  }
  
  // 销毁 OpenLayers 地图实例
  if (map.value) map.value.setTarget(null);
});

// 监听 POI 数据变化，重建 OpenLayers 要素
watch(() => props.poiFeatures, () => {
  rebuildPoiOlFeatures();
  // 如果当前有绘制区域，重新筛选
  if (currentGeometry && currentGeometryType) {
    if (currentGeometryType === 'Polygon') {
      onPolygonComplete(currentGeometry, true); // true 表示内部刷新
    } else if (currentGeometryType === 'Circle') {
      onCircleComplete(currentGeometry, true);
    }
  }
}, { deep: false });

/**
 * 重建 OpenLayers 要素
 * 将原始 GeoJSON 数据转换为 OpenLayers Feature 对象并缓存
 */
function rebuildPoiOlFeatures() {
  olPoiFeatures = [];
  rawToOlMap.clear();
  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  for (const f of (props.poiFeatures || [])) {
    let [lon, lat] = f.geometry.coordinates;
    // 如果数据是 WGS84，转换为 GCJ02 以匹配高德地图底图
    if (poiCoordSys.toLowerCase() === 'wgs84') {
      [lon, lat] = wgs84ToGcj02(lon, lat);
    }
    const feat = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
      __raw: f, // 绑定原始数据
    });
    olPoiFeatures.push(feat);
    rawToOlMap.set(f, feat);
  }
}

/**
 * 飞行动画：定位到指定要素
 * @param {Object} feature - 要定位的要素对象
 */
let hasLocatedOnce = false; // 标记是否已经进行过定位

function flyTo(feature) {
  if (!map.value || !feature) return;
  const [lon, lat] = feature.geometry.coordinates;
  
  let center;
  if (rawToOlMap.has(feature)) {
    center = rawToOlMap.get(feature).getGeometry().getCoordinates();
  } else {
     let [lon, lat] = feature.geometry.coordinates;
     const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
     if (poiCoordSys.toLowerCase() === 'wgs84') {
       [lon, lat] = wgs84ToGcj02(lon, lat);
     }
     center = fromLonLat([lon, lat]);
  }
  
  // 记录当前定位的 POI，并刷新 deck.gl（隐藏该 POI 的红圆圈）
  currentLocatedPoi = feature;
  updateDeckLayers();
  
  // 清空悬停图层
  hoverLayerSource.clear();
  
  // 显示水蓝色五角星
  locateLayerSource.clear();
  const locateFeature = new Feature({
    geometry: new Point(center)
  });
  locateLayerSource.addFeature(locateFeature);
  
  // 动画参数
  const animateOptions = {
    center: center,
    duration: 1000,
  };
  
  // 第一次定位时缩放到17级，之后不再缩放
  if (!hasLocatedOnce) {
    animateOptions.zoom = 17;
    hasLocatedOnce = true;
  }
  
  map.value.getView().animate(animateOptions);
}

/**
 * 开启绘制模式 (支持多选区)
 * @param {string} mode - 'Polygon' (多边形) 或 'Circle' (圆形)
 */
function openPolygonDraw(mode = 'Polygon') {
  if (!map.value) return;
  
  // 检查选区数量限制
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
  
  // 确保同一时间只有一个绘制交互
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
  }
  
  drawInteraction = new Draw({ source: polygonLayerSource, type: mode });
  
  drawInteraction.on('drawstart', () => {
    // 多选区模式：不清空之前的图形，只清空高亮
    // polygonLayerSource.clear();  // 注释掉，保留之前的选区
    // centerLayerSource.clear();   // 注释掉，保留之前的标签
    clearHighlights(); // 清空当前高亮，准备显示新选区的
    // currentGeometry = null;
    // currentGeometryType = null;
  });

  drawInteraction.on('drawend', (evt) => {
    const geometry = evt.feature.getGeometry();
    const type = geometry.getType(); // 'Polygon' 或 'Circle'
    const feature = evt.feature;
    
    if (type === 'Polygon') {
      onPolygonCompleteMulti(geometry, feature);
    } else if (type === 'Circle') {
      onCircleCompleteMulti(geometry, feature);
    }
    
    // 完成一个形状后自动停止绘制
    closePolygonDraw();
  });
  map.value.addInteraction(drawInteraction);
}

/**
 * 圆形绘制完成回调
 * @param {Object} circleGeom - 圆形几何对象
 * @param {boolean} isRefresh - 是否是数据更新引起的刷新
 */
function onCircleComplete(circleGeom, isRefresh = false) {
  if (!isRefresh) {
    currentGeometry = circleGeom;
    currentGeometryType = 'Circle';
  }
  const center = circleGeom.getCenter();
  const radius = circleGeom.getRadius(); // 半径（地图单位，EPSG:3857下为米）
  
  const insideRaw = [];
  
  // 筛选圆内的 POI
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const dx = coord[0] - center[0];
    const dy = coord[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= radius) {
      insideRaw.push(feat.get('__raw'));
    }
  }

  // 计算 TagCloud 定位的中心像素点（使用圆心）
  const centerPixelObj = { 
    x: map.value.getPixelFromCoordinate(center)[0], 
    y: map.value.getPixelFromCoordinate(center)[1] 
  };

  // 添加圆心标记 (蓝色五角星)
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
 * 关闭绘制模式
 */
function closePolygonDraw() {
  if (!map.value) return;
  
  // 1. 移除特定的交互对象引用
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
    drawInteraction = null;
  }
  
  // 2. 强健性清理：遍历所有交互并移除任何激活的 Draw 交互
  // 修复了"停止绘制"按钮失效的问题
  const interactions = map.value.getInteractions().getArray().slice();
  interactions.forEach((interaction) => {
    if (interaction instanceof Draw) {
      map.value.removeInteraction(interaction);
    }
  });
}

// ============ 多选区完成回调 ============

/**
 * 圆形绘制完成回调 (多选区版本)
 */
function onCircleCompleteMulti(circleGeom, feature) {
  const center = circleGeom.getCenter();
  const centerLonLat = toLonLat(center);
  const radius = circleGeom.getRadius();
  
  // 收集圆内的 POI
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
  
  // 生成 WKT (用于 PostGIS 查询)
  // 圆形需要转换为近似多边形
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
  
  // 注册到选区管理器
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
    // 应用选区专属样式
    applyRegionStyle(feature, region);
    
    // 添加中心标签
    addRegionLabel(center, region);
    
    // 添加删除按钮
    createRegionDeleteButton(region);
    
    // 更新选区 POI 统计
    updateRegionPois(region.id, insideRaw);
    
    // 显示高亮
    showHighlights(insideRaw, { full: true });
    
    // 发送事件
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
 * 多边形绘制完成回调 (多选区版本)
 */
function onPolygonCompleteMulti(polygonGeom, feature) {
  const ringCoords = polygonGeom.getCoordinates()[0];
  const ringPixels = ringCoords.map((c) => map.value.getPixelFromCoordinate(c));
  
  // 收集多边形内的 POI
  const insideRaw = [];
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const px = map.value.getPixelFromCoordinate(coord);
    if (pointInPolygonPixel(px, ringPixels)) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  
  // 计算地理中心点
  const geoCenter = calculatePolygonGeoCenter(ringCoords);
  const centerLonLat = geoCenter ? toLonLat(geoCenter) : null;
  
  // 生成 WKT
  const wktCoords = ringCoords.map(c => {
    const [lon, lat] = toLonLat(c);
    return `${lon} ${lat}`;
  });
  const boundaryWKT = `POLYGON((${wktCoords.join(', ')}))`;
  
  // 生成 GeoJSON 几何
  const geoJsonGeometry = {
    type: 'Polygon',
    coordinates: [ringCoords.map(c => toLonLat(c))]
  };
  
  // 注册到选区管理器
  const region = addRegion({
    type: 'Polygon',
    geometry: geoJsonGeometry,
    center: centerLonLat,
    boundaryWKT,
    pois: insideRaw,
    olFeature: feature
  });
  
  if (region) {
    // 应用选区专属样式
    applyRegionStyle(feature, region);
    
    // 添加中心标签
    if (geoCenter) {
      addRegionLabel(geoCenter, region);
    }
    
    // 添加删除按钮
    createRegionDeleteButton(region);
    
    // 更新选区 POI 统计
    updateRegionPois(region.id, insideRaw);
    
    // 显示高亮
    showHighlights(insideRaw, { full: true });
    
    // 发送事件
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
 * 为选区 Feature 应用专属样式
 */
function applyRegionStyle(feature, region) {
  const color = region.color;
  feature.setStyle(new Style({
    stroke: new Stroke({ color: color.stroke, width: 2 }),
    fill: new Fill({ color: color.fill })
  }));
}

/**
 * 在选区中心添加标签
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
  
  // 保存引用以便后续删除
  region.labelFeature = labelFeature;
}

/**
 * 为选区创建删除按钮 (Overlay)
 */
function createRegionDeleteButton(region) {
  if (!map.value) return;
  
  let buttonPosition = null;
  
  if (region.olFeature) {
    const geometry = region.olFeature.getGeometry();
    const geometryType = geometry.getType();
    
    if (geometryType === 'Polygon') {
      // 多边形：使用第一个顶点（通常是用户开始绘制的点）
      // 或者找到最右上角的顶点
      const coords = geometry.getCoordinates()[0]; // 外环坐标
      if (coords && coords.length > 0) {
        // 找到 Y 值最大的点中 X 值最大的（右上角顶点）
        let topRightVertex = coords[0];
        let maxScore = coords[0][0] + coords[0][1]; // X + Y 作为评分
        
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
      // 圆形：使用圆周上的右上角点（45度方向）
      const center = geometry.getCenter();
      const radius = geometry.getRadius();
      // 右上角 45 度方向的点
      const angle = Math.PI / 4; // 45度
      buttonPosition = [
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle)
      ];
    } else {
      // 兜底：使用边界框右上角
      const extent = geometry.getExtent();
      buttonPosition = [extent[2], extent[3]];
    }
  }
  
  if (!buttonPosition) return;
  
  // 创建按钮 DOM 元素
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
  
  // 悬停效果
  buttonElement.onmouseenter = () => {
    buttonElement.style.transform = 'scale(1.2)';
    buttonElement.style.background = '#e74c3c';
  };
  buttonElement.onmouseleave = () => {
    buttonElement.style.transform = 'scale(1)';
    buttonElement.style.background = region.color.stroke;
  };
  
  // 点击删除
  buttonElement.onclick = (e) => {
    e.stopPropagation();
    removeRegionFromMap(region.id);
  };
  
  // 创建 OpenLayers Overlay
  const overlay = new Overlay({
    element: buttonElement,
    position: buttonPosition,
    positioning: 'bottom-left',
    offset: [5, -5],
    stopEvent: true
  });
  
  map.value.addOverlay(overlay);
  
  // 保存引用以便后续删除
  region.deleteOverlay = overlay;
}

/**
 * 清空所有选区 (供外部调用)
 */
function clearAllRegionsFromMap() {
  // 移除所有删除按钮 Overlay
  regions.value.forEach(region => {
    if (region.deleteOverlay && map.value) {
      map.value.removeOverlay(region.deleteOverlay);
    }
  });
  
  const count = clearAllRegions();
  polygonLayerSource.clear();
  centerLayerSource.clear();
  clearHighlights();
  currentGeometry = null;
  currentGeometryType = null;

  // 告知父组件“选区集合已清空”，用于触发统一的数据源重算。
   if (count > 0) {
    emit('regions-cleared', { count });
  }

  return count;
}

/**
 * 删除指定选区
 */
function removeRegionFromMap(regionId) {
  const region = getRegion(regionId);
  if (region) {
    // 从图层中移除 Feature
    if (region.olFeature) {
      polygonLayerSource.removeFeature(region.olFeature);
    }
    if (region.labelFeature) {
      centerLayerSource.removeFeature(region.labelFeature);
    }
    // 移除删除按钮 Overlay
    if (region.deleteOverlay && map.value) {
      map.value.removeOverlay(region.deleteOverlay);
    }
    // 从管理器中移除
    removeRegion(regionId);
    
    // 发送事件
    emit('region-removed', { regionId, regionName: region.name });
    
    console.log(`[Map] 选区 ${region.name} 已删除，当前剩余 ${regions.value.length} 个选区`);
  }
}

/**
 * 清空高亮数据
 */
function clearHighlights() {
  highlightData.value = [];
  heatmapData.value = [];
}

/**
 * 显示高亮要素 (使用 deck.gl)
 * @param {Array} features - 要高亮的原始特征数组
 * @param {Object} options - 配置项 { full: boolean }
 */
function showHighlights(features, options = {}) {
  // 清空并更新数据，deck.gl 会自动重新渲染
  if (!features || !features.length) {
    clearHighlights();
    return;
  }
  
  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  
  // 将原始 GeoJSON 数据转换为 deck.gl 数据格式
  const deckData = features.map(raw => {
    let [lon, lat] = raw.geometry.coordinates;
    // 坐标转换
    if (poiCoordSys.toLowerCase() === 'wgs84') {
      [lon, lat] = wgs84ToGcj02(lon, lat);
    }
    return {
      lon,
      lat,
      groupIndex: raw.properties?._groupIndex || 0,
      raw, // 保留原始数据引用，用于交互回调
    };
  });
  
  // 更新高亮数据和热力图数据
  highlightData.value = deckData;
  heatmapData.value = deckData;
  
  console.log(`[MapContainer] deck.gl 数据更新: ${deckData.length} 个点`);
  
  // 自动缩放视图以包含所有点
  if (options.fitView && map.value) {
    // 计算边界
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    deckData.forEach(d => {
      minLon = Math.min(minLon, d.lon);
      maxLon = Math.max(maxLon, d.lon);
      minLat = Math.min(minLat, d.lat);
      maxLat = Math.max(maxLat, d.lat);
    });
    
    // 如果有效
    if (minLon <= maxLon && minLat <= maxLat) {
      // 转换为 Web Mercator 投影
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

// 监听热力图开关
watch(heatmapEnabled, () => {
  // deck.gl 图层会在 updateDeckLayers 中自动根据 heatmapEnabled.value 更新可见性
  updateDeckLayers();
});

/**
 * 多边形绘制完成回调
 * @param {Object} polygonGeom - 多边形几何对象
 * @param {boolean} isRefresh - 是否是数据更新引起的刷新
 */
function onPolygonComplete(polygonGeom, isRefresh = false) {
  if (!isRefresh) {
    currentGeometry = polygonGeom;
    currentGeometryType = 'Polygon';
  }
  const ringCoords = polygonGeom.getCoordinates()[0];
  const ringPixels = ringCoords.map((c) => map.value.getPixelFromCoordinate(c));

  const insideRaw = [];
  // 筛选多边形内的 POI（使用射线法判断点在多边形内）
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const px = map.value.getPixelFromCoordinate(coord);
    if (pointInPolygonPixel(px, ringPixels)) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  
  // 热力图数据会在 showHighlights 中自动同步更新

  // 计算多边形中心点（像素坐标 + 地理坐标）
  const centerPixelObj = calculatePolygonCenter(ringPixels);
  
  // 计算地理中心点（用于标签云布局）
  const geoCenter = calculatePolygonGeoCenter(ringCoords);
  
  // 添加中心点标记 (蓝色五角星) - 与圆形模式保持一致
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
    polygonCenter: geoCenter ? toLonLat(geoCenter) : null  // 传递地理中心坐标
  });
}

/**
 * 计算多边形质心（用于标签云布局中心）
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
 * 计算多边形地理中心点（用于地图标记和标签云布局）
 * @param {Array} ringCoords - 多边形顶点坐标数组（EPSG:3857）
 * @returns {Array} 中心点坐标 [x, y]（EPSG:3857）
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
 * 判断点是否在多边形内（射线法）
 * @param {Array} pt - [x, y] 待测点坐标
 * @param {Array} ringPixels - 多边形顶点数组
 */
function pointInPolygonPixel(pt, ringPixels) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ringPixels.length - 1; i < ringPixels.length; j = i++) {
    const xi = ringPixels[i][0], yi = ringPixels[i][1];
    const xj = ringPixels[j][0], yj = ringPixels[j][1];
    // 处理水平线段避免除以零
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 清空多边形、高亮和热力图
function clearPolygon() {
  polygonLayerSource.clear();
  centerLayerSource.clear();
  locateLayerSource.clear();
  clearHighlights();
  currentGeometry = null;
  currentGeometryType = null;
  hasLocatedOnce = false;
  currentLocatedPoi = null; // 清空当前定位的 POI
}

/**
 * 添加上传的多边形到地图
 * @param {Array} coordinates - GeoJSON 格式的多边形坐标数组 [[lng, lat], ...]
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

  // Keep upload behavior aligned with draw behavior: uploaded polygons become regions.
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

  // Route through multi-region completion so labels, region IDs and context are consistent.
  onPolygonCompleteMulti(geometry, polygonFeature);

  const extent = geometry.getExtent();
  map.value.getView().fit(extent, {
    padding: [50, 50, 50, 50],
    duration: 500
  });

  console.log('[MapContainer] Uploaded polygon is registered as a region');
}

// 向父组件暴露选区管理与高亮控制方法。
defineExpose({
  map,
  openPolygonDraw,
  closePolygonDraw,
  showHighlights,
  clearHighlights,
  clearPolygon,
  clearAllRegionsFromMap,
  flyTo,
  addUploadedPolygon
});

// --- WGS84 转 GCJ-02 工具函数 ---
// (近似算法，仅中国区域有效)

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
  return ret;
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
  background: rgba(15, 23, 42, 0.7); /* 深色透明背景 */
  backdrop-filter: blur(12px); /* 玻璃拟态 */
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(99, 102, 241, 0.3); /* 紫色细边框 */
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

/* 全域感知提示样式 */
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

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

/* POI 名称气泡 */
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
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
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
}

/* el-switch inactive 状态文字颜色修复 - 使用更强的选择器覆盖 */
/* el-switch inactive 状态背景颜色修复（Slate-600），比原本的深岩灰稍浅 */
.map-filter-control :deep(.el-switch:not(.is-checked)) {
  --el-switch-off-color: #475569; /* Slate-600 */
}

/* 核心背景强制覆盖 - Inactive */
.map-filter-control :deep(.el-switch:not(.is-checked) .el-switch__core) {
  background-color: #475569 !important;
  border-color: #475569 !important;
}

/* 核心背景强制覆盖 - Active (主题紫) */
.map-filter-control :deep(.el-switch.is-checked .el-switch__core) {
  background-color: #4338ca !important;
  border-color: #4338ca !important;
}

/* 文字颜色保持默认（通常是白色），无需覆盖，或者强制设为白色以防万一 */
.map-filter-control :deep(.el-switch:not(.is-checked) .el-switch__inner .is-text) {
  color: #ffffff !important;
  font-weight: 500;
}
</style>
