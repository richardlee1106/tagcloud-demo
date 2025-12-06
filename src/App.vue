<template>
  <div id="app" class="app-layout">
    <header class="top-controls">
      <ControlPanel ref="controlPanelRef"
                    @data-loaded="handleDataLoaded"
                    @toggle-draw="handleToggleDraw"
                    @debug-show="handleDebugShow"
                    @reset="handleReset"
                    :on-run-algorithm="handleRunAlgorithm" />
    </header>
    <main class="bottom-split">
      <section class="left-panel">
        <MapContainer ref="mapComponent" 
                      :poi-features="allPoiFeatures" 
                      :hovered-feature-id="hoveredFeatureId"
                      @polygon-completed="handlePolygonCompleted" 
                      @map-ready="handleMapReady"
                      @hover-feature="handleFeatureHover"
                      @click-feature="handleFeatureClick"
                      @map-move-end="handleMapMoveEnd"
                      @toggle-filter="handleToggleFilter" />
      </section>
      <section class="right-panel">
        <TagCloud ref="tagCloudRef"
                  :data="filteredTagData" 
                  :map="map" 
                  :algorithm="selectedAlgorithm" 
                  :selectedBounds="selectedBounds" 
                  :polygonCenter="polygonCenter" 
                  :spiralConfig="spiralConfig" 
                  :boundaryPolygon="selectedPolygon"
                  :hovered-feature-id="hoveredFeatureId"
                  :draw-mode="selectedDrawMode"
                  :circle-center="circleCenterGeo"
                  @hover-feature="handleFeatureHover"
                  @locate-feature="handleFeatureLocate" />
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue';
import { ElMessage } from 'element-plus';
import ControlPanel from './components/ControlPanel.vue';
import TagCloud from './components/TagCloud.vue';
import MapContainer from './components/MapContainer.vue';

// 组件引用
const controlPanelRef = ref(null);
const tagCloudRef = ref(null);
const mapComponent = ref(null);

// 核心数据状态
const map = ref(null); // OpenLayers 地图实例
const tagData = ref([]); // 传递给 TagCloud 的数据（通常是选中区域的 POI）
const selectedAlgorithm = ref('spiral'); // 当前选择的布局算法
const spiralConfig = ref(null); // 螺旋布局配置
const selectedBounds = ref(null); // 选中区域的边界
const allPoiFeatures = ref([]); // 所有加载的 POI 数据（虽然加载了但在未过滤前可能不全部显示）
const selectedFeatures = ref([]); // 当前选中的 POI 集合（通过绘图选择）
const polygonCenter = ref(null); // 选中多边形的中心点（屏幕像素坐标）
const selectedPolygon = ref(null); // 选中多边形的经纬度坐标数组

// 交互状态
const hoveredFeatureId = ref(null); // 当前悬停的要素 ID（用于联动高亮）
const filterEnabled = ref(false); // 是否开启实时视野过滤
const mapBounds = ref(null); // 当前地图视野边界 [minLon, minLat, maxLon, maxLat]

// 绘图模式状态
const selectedDrawMode = ref(''); // 存储当前的绘图模式 ('Polygon' 或 'Circle')
const circleCenterGeo = ref(null); // 存储圆心经纬度（用于地理布局校正）

/**
 * 节流函数工具
 * 用于限制高频事件（如地图移动）的触发频率
 * @param {Function} func - 需要节流的函数
 * @param {number} limit - 时间间隔（毫秒）
 */
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

/**
 * 计算属性：过滤后的标签数据
 * 如果开启了实时过滤，则只显示当前地图视野内的 POI
 * 否则显示所有 tagData 中的数据（通常是绘图选中的数据）
 */
const filteredTagData = computed(() => {
  if (!filterEnabled.value || !mapBounds.value) {
    return tagData.value;
  }
  const bounds = mapBounds.value; // [minLon, minLat, maxLon, maxLat]
  return tagData.value.filter(f => {
    const [lon, lat] = f.geometry.coordinates;
    return lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
  });
});

onMounted(() => {
  window.addEventListener('resize', handleResize);

  // 初始化标签云为空数据；用户需要显式加载数据
  tagData.value = [];
});

// 处理窗口大小调整，更新地图尺寸
const handleResize = () => {
  if (map.value && typeof map.value.updateSize === 'function') {
    map.value.updateSize();
  }
};

/**
 * 处理运行算法请求
 * 当用户在控制面板点击"生成词云"时触发
 * @param {Object|string} payload - 包含算法名称和配置的对象，或仅算法名称字符串
 */
const handleRunAlgorithm = (payload) => {
  const algorithm = typeof payload === 'string' ? payload : payload?.algorithm;
  selectedAlgorithm.value = algorithm || 'spiral';
  spiralConfig.value = typeof payload === 'object' ? payload?.config || null : null;
  
  // 如果当前模式是 'Circle'，TagCloud 组件会根据 selectedDrawMode 自动处理
  // 这里主要确保数据源是最新的选中数据
  
  console.log('[App] 选中的要素:', selectedFeatures.value);
  console.log('[App] 地图对象:', map.value); 
  tagData.value = selectedFeatures.value;
};

/**
 * 处理数据加载完成
 * 当用户上传文件或加载预设数据后触发
 * @param {Object} payload - { success, name, features }
 */
const handleDataLoaded = (payload) => {
  if (payload && payload.success && payload.features) {
    allPoiFeatures.value = payload.features;
    console.log(`[App] 数据已加载: ${payload.features.length} 个要素`);
  }
};

/**
 * 处理开启/关闭绘制模式
 * @param {Object|boolean} payload - 包含模式信息的对象或布尔值(旧版)
 */
const handleToggleDraw = (payload) => {
  if (!mapComponent.value) return;
  
  // 支持布尔值（旧版兼容）和对象负载
  const enabled = (typeof payload === 'object') ? payload.active : payload;
  const mode = (typeof payload === 'object') ? payload.mode : 'Polygon';

  if (enabled) {
    console.log(`[App] 开启绘制模式: ${mode}`);
    mapComponent.value.openPolygonDraw(mode);
  } else {
    console.log('[App] 关闭绘制模式');
    mapComponent.value.closePolygonDraw();
  }
};

/**
 * 处理实时过滤开关切换
 * @param {boolean} enabled - 是否开启
 */
const handleToggleFilter = (enabled) => {
  filterEnabled.value = enabled;
  console.log('[App] 实时过滤状态:', enabled ? '开启' : '关闭');
  if (!enabled) {
    // 关闭时重置或保持当前状态
  } else {
    // 开启时可能需要立即触发一次更新
    if (mapComponent.value) {
       // mapComponent.value.emitBounds(); // 如果需要立即更新边界
    }
  }
};

/**
 * 处理地图移动结束
 * 使用节流函数限制频率，更新地图边界用于实时过滤
 */
const handleMapMoveEnd = throttle((bounds) => {
  mapBounds.value = bounds;
  // console.log('[App] 地图边界更新:', bounds);
}, 500); // 每500ms最多触发一次

/**
 * 处理要素悬停
 * 实现 MapContainer 和 TagCloud 之间的联动高亮
 * @param {Object|string} id - 悬停的要素或其 ID
 */
const handleFeatureHover = (id) => {
  hoveredFeatureId.value = id;
};

/**
 * 处理要素点击
 * 当在地图上点击要素时，TagCloud 自动定位并高亮该标签
 * @param {Object} feature - 被点击的要素对象
 */
const handleFeatureClick = (feature) => {
    console.log('[App] 处理要素点击:', feature);
    // 1. 更新高亮状态
    hoveredFeatureId.value = feature;
    
    // 2. 通知 TagCloud 组件定位到该标签
      if (tagCloudRef.value) {
        tagCloudRef.value.centerOnFeature(feature);
      }
    };

/**
 * 处理要素定位请求
 * 当在 TagCloud 点击标签时，地图自动飞向该 POI
 * @param {Object} feature - 目标要素对象
 */
const handleFeatureLocate = (feature) => {
  if (mapComponent.value) {
    console.log('[App] 定位到地图要素');
    mapComponent.value.flyTo(feature);
  }
};

/**
 * 处理多边形/圆形绘制完成
 * 接收地图组件筛选出的 POI 数据
 * @param {Object} payload - { polygon, center, selected, type, circleCenter }
 */
const handlePolygonCompleted = (payload) => {
  const inside = Array.isArray(payload?.selected) ? payload.selected : [];
  selectedFeatures.value = inside;
  polygonCenter.value = payload?.center || null;
  selectedPolygon.value = Array.isArray(payload?.polygon) ? payload.polygon : null;
  
  // 存储绘图模式特定的数据
  selectedDrawMode.value = payload?.type || 'Polygon';
  circleCenterGeo.value = payload?.circleCenter || null;
  
  console.log(`[App] 绘制完成 (${selectedDrawMode.value}). 选中 ${inside.length} 个要素`);
  
  // 同步控制面板状态（自动关闭绘制按钮状态）
  if (controlPanelRef.value) {
    controlPanelRef.value.setDrawEnabled(false);
  }
  
  if (!inside.length) {
    ElMessage.warning('该区域内没有任何信息！');
  } else {
    ElMessage.success(`已选中 ${inside.length} 个POI，并在地图中高亮显示`);
  }
};

/**
 * 处理地图初始化完成
 * 获取 OpenLayers 地图实例引用
 */
const handleMapReady = (mapInstance) => {
  console.log('[App] 地图初始化完成:', mapInstance);
  map.value = mapInstance;
};

/**
 * 调试显示：渲染当前分组的所有 POI 为高亮
 */
function handleDebugShow(groupName) {
  if (!allPoiFeatures.value.length) {
    ElMessage.warning('请先加载地理语义分组数据');
    return;
  }
  console.log('[App] 调试显示所有要素');
  mapComponent.value.showHighlights(allPoiFeatures.value, { full: true });
  selectedFeatures.value = allPoiFeatures.value;
}

/**
 * 初始化：清空所有数据
 * 重置所有状态到初始值
 */
function handleReset() {
  // 清空标签云数据
  tagData.value = [];
  selectedFeatures.value = [];
  polygonCenter.value = null;
  selectedPolygon.value = null;
  hoveredFeatureId.value = null;
  
  // 重置绘图模式状态
  selectedDrawMode.value = '';
  circleCenterGeo.value = null;

  // 清空地图上的多边形和高亮
  if (mapComponent.value) {
    mapComponent.value.clearPolygon();
    mapComponent.value.closePolygonDraw(); // 确保停止绘制
  }
  
  // 重置控制面板状态
  if (controlPanelRef.value) {
    controlPanelRef.value.setDrawEnabled(false);
  }
  
  console.log('[App] 已重置所有数据');
  ElMessage.success('已清空所有数据');
}
</script>

<style>
html, body, #app {
  height: 100vh;
  width: 100vw;
  margin: 0;
  overflow: hidden;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.top-controls {
  flex: 0 0 56px; /* 固定高度 */
  background: #333; /* 深灰色背景 */
  padding: 8px;
  box-sizing: border-box;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000; /* 确保在地图之上 */
  position: relative;
}

@media (max-width: 768px) {
  .top-controls {
    flex: 0 0 auto; /* 允许高度自适应 */
    height: auto;
    min-height: 56px;
    padding: 8px;
    flex-wrap: wrap;
  }
}

.bottom-split {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.left-panel, .right-panel { flex: 1; height: 100%; overflow: hidden; }
.left-panel { background: #000; }
.right-panel { background: #001018; }

@media (max-width: 768px) {
  .bottom-split {
    flex-direction: column;
  }
  .left-panel, .right-panel {
    width: 100%;
    height: auto;
    flex: 1;
  }
}
</style>
