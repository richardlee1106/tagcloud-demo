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
                      @map-move-end="handleMapMoveEnd"
                      @toggle-filter="handleToggleFilter" />
      </section>
      <section class="right-panel">
        <TagCloud :data="filteredTagData" 
                  :map="map" 
                  :algorithm="selectedAlgorithm" 
                  :selectedBounds="selectedBounds" 
                  :polygonCenter="polygonCenter" 
                  :spiralConfig="spiralConfig" 
                  :boundaryPolygon="selectedPolygon"
                  :hovered-feature-id="hoveredFeatureId"
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

const controlPanelRef = ref(null);
const mapComponent = ref(null);
const map = ref(null);
const tagData = ref([]);
const selectedAlgorithm = ref('spiral');
const spiralConfig = ref(null);
const selectedBounds = ref(null);
const allPoiFeatures = ref([]); // loaded but hidden
const selectedFeatures = ref([]);
const polygonCenter = ref(null);
const selectedPolygon = ref(null);

// New State
const hoveredFeatureId = ref(null);
const filterEnabled = ref(false);
const mapBounds = ref(null);

// Throttle utility
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

// Filtered data based on map bounds
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

  // Initialize tag cloud with empty data; user loads group explicitly
  tagData.value = [];
});

const handleResize = () => {
  if (map.value && typeof map.value.updateSize === 'function') {
    map.value.updateSize();
  }
};

const handleRunAlgorithm = (payload) => {
  const algorithm = typeof payload === 'string' ? payload : payload?.algorithm;
  selectedAlgorithm.value = algorithm || 'spiral';
  spiralConfig.value = typeof payload === 'object' ? payload?.config || null : null;
  // Run with currently selected features (inside polygon)
  // 直接传递原始 GeoJSON 特征，供标签云计算像素与字段
  console.log('Selected Features in App.vue:', selectedFeatures.value);
  console.log('Map object in App.vue:', map.value); // 检查map对象是否已初始化
  tagData.value = selectedFeatures.value;
};

const handleDataLoaded = (payload) => {
  // payload: { success, name, features }
  if (payload && payload.success && payload.features) {
    allPoiFeatures.value = payload.features;
  }
};

const handleToggleDraw = (enabled) => {
  if (!mapComponent.value) return;
  if (enabled) {
    mapComponent.value.openPolygonDraw();
  } else {
    mapComponent.value.closePolygonDraw();
  }
};

const handleToggleFilter = (enabled) => {
  filterEnabled.value = enabled;
  if (!enabled) {
    // Reset bounds to show all if disabled, or just rely on computed property logic
  } else {
    // Trigger immediate update if possible
    if (mapComponent.value) {
       // mapComponent.value.emitBounds(); // If we implement this
    }
  }
};

const handleMapMoveEnd = throttle((bounds) => {
  mapBounds.value = bounds;
}, 500); // Throttle 2 times per second (500ms)

const handleFeatureHover = (id) => {
  hoveredFeatureId.value = id;
};

const handleFeatureLocate = (feature) => {
  if (mapComponent.value) {
    mapComponent.value.flyTo(feature);
  }
};

const handlePolygonCompleted = (payload) => {
  // payload: { polygon: [[lng,lat],...], center: {x, y}, selected: features[] }
  const inside = Array.isArray(payload?.selected) ? payload.selected : [];
  selectedFeatures.value = inside;
  polygonCenter.value = payload?.center || null;
  selectedPolygon.value = Array.isArray(payload?.polygon) ? payload.polygon : null;
  
  // Sync drawing state in ControlPanel
  if (controlPanelRef.value) {
    controlPanelRef.value.setDrawEnabled(false);
  }
  
  if (!inside.length) {
    ElMessage.warning('该多边形内没有任何信息！');
  } else {
    ElMessage.success(`已选中 ${inside.length} 个POI，并在地图中高亮显示`);
  }
};

// Handle the map-ready event from MapContainer
const handleMapReady = (mapInstance) => {
  console.log('handleMapReady called with:', mapInstance);
  map.value = mapInstance;
};

// TianDiTu-based selection helpers removed; handled within MapContainer via OpenLayers

// Debug show: render currently selected group's POIs as highlights
function handleDebugShow(groupName) {
  if (!allPoiFeatures.value.length) {
    ElMessage.warning('请先加载地理语义分组数据');
    return;
    }
  mapComponent.value.showHighlights(allPoiFeatures.value, { full: true });
  ElMessage.success(`调试显示：${groupName} 的POI已在地图中高亮`);
}

// 初始化：清空所有数据
function handleReset() {
  // 清空标签云数据
  tagData.value = [];
  selectedFeatures.value = [];
  polygonCenter.value = null;
  selectedPolygon.value = null;
  hoveredFeatureId.value = null;
  
  // 清空地图上的多边形和高亮
  if (mapComponent.value) {
    mapComponent.value.clearPolygon();
    mapComponent.value.closePolygonDraw(); // Ensure drawing is stopped
  }
  
  // Reset Control Panel state
  if (controlPanelRef.value) {
    controlPanelRef.value.setDrawEnabled(false);
  }
  
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
  flex: 0 0 56px; /* Fixed height */
  background: #0a0a0a;
  padding: 8px;
  box-sizing: border-box;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000; /* Ensure it's above map */
  position: relative;
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
</style>
