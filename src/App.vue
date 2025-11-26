<template>
  <div id="app" class="app-layout">
    <header class="top-controls">
      <ControlPanel @data-loaded="handleDataLoaded"
                    @toggle-draw="handleToggleDraw"
                    @debug-show="handleDebugShow"
                    @reset="handleReset"
                    :on-run-algorithm="handleRunAlgorithm" />
    </header>
    <main class="bottom-split">
      <section class="left-panel">
        <MapContainer ref="mapComponent" :poi-features="allPoiFeatures" @polygon-completed="handlePolygonCompleted" @map-ready="handleMapReady" />
      </section>
      <section class="right-panel">
        <TagCloud :data="tagData" :map="map" :algorithm="selectedAlgorithm" :selectedBounds="selectedBounds" :polygonCenter="polygonCenter" :spiralConfig="spiralConfig" :boundaryPolygon="selectedPolygon" />
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import ControlPanel from './components/ControlPanel.vue';
import TagCloud from './components/TagCloud.vue';
import MapContainer from './components/MapContainer.vue';

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

const handlePolygonCompleted = (payload) => {
  // payload: { polygon: [[lng,lat],...], center: {x, y}, selected: features[] }
  const inside = Array.isArray(payload?.selected) ? payload.selected : [];
  selectedFeatures.value = inside;
  polygonCenter.value = payload?.center || null;
  selectedPolygon.value = Array.isArray(payload?.polygon) ? payload.polygon : null;
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
  
  // 清空地图上的多边形和高亮
  if (mapComponent.value) {
    mapComponent.value.clearPolygon();
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
.app-layout { height: 100vh; width: 100vw; display: flex; flex-direction: column; }
.top-controls { height: 56px; padding: 8px; box-sizing: border-box; background: #0a0a0a; color: #fff; }
.bottom-split { height: calc(100vh - 56px); display: flex; overflow: hidden; }
.left-panel, .right-panel { flex: 1; height: 100%; overflow: hidden; }
.left-panel { background: #000; }
.right-panel { background: #001018; }
</style>
