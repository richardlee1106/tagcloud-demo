<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container"></div>
    
    <!-- 实时过滤 & 热力图控制 -->
    <div class="map-filter-control">
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
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import HeatmapLayer from 'ol/layer/Heatmap';
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';
import { Vector as VectorLayer } from 'ol/layer';
import { Draw } from 'ol/interaction';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';

/**
 * 定义组件事件
 * polygon-completed: 当绘制完成（多边形或圆形）并筛选出 POI 时触发
 * map-ready: 地图初始化完成时触发
 * hover-feature: 当鼠标悬停在 POI 上时触发
 * click-feature: 当鼠标点击 POI 时触发
 * map-move-end: 当地图移动结束（视野变化）时触发
 * toggle-filter: 当切换实时过滤开关时触发
 */
const emit = defineEmits(['polygon-completed', 'map-ready', 'hover-feature', 'click-feature', 'map-move-end', 'toggle-filter']);

/**
 * 定义组件属性
 * poiFeatures: 原始 POI 数据数组（GeoJSON Feature 格式）
 * hoveredFeatureId: 当前被悬停的 Feature 对象（来自 TagCloud 组件）
 */
const props = defineProps({
  poiFeatures: { type: Array, default: () => [] },
  hoveredFeatureId: { type: Object, default: null }, // 我们直接使用 feature 对象作为 ID
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
const filterEnabled = ref(false);
// 热力图开关状态
const heatmapEnabled = ref(false);

/**
 * 切换实时过滤状态
 * @param {boolean} val - 开关状态
 */
const toggleFilter = (val) => {
  emit('toggle-filter', val);
};

// --- 图层定义 ---

// 1. 多边形绘制图层
// 用于显示用户绘制的多边形或圆形区域
const polygonLayerSource = new VectorSource();
const polygonLayer = new VectorLayer({
  source: polygonLayerSource,
  style: new Style({
    stroke: new Stroke({ color: '#2ecc71', width: 2 }), // 绿色边框
    fill: new Fill({ color: 'rgba(46,204,113,0.1)' }), // 浅绿色填充
  }),
  zIndex: 50 // 层级较低
});

// 2. 高亮图层
// 用于显示被选中的 POI（在多边形/圆形内部的点）
const highlightLayerSource = new VectorSource();
const highlightLayer = new VectorLayer({
  source: highlightLayerSource,
  style: new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: 'rgba(255,0,0,0.4)' }), // 红色半透明填充
      stroke: new Stroke({ color: 'red', width: 2 }), // 红色边框
    }),
  }),
  zIndex: 100 // 层级较高
});

// 3. 热力图图层
// 用于显示 POI 的密度分布
const heatmapSource = new VectorSource();
const heatmapLayer = new HeatmapLayer({
  source: heatmapSource,
  blur: 15, // 模糊度
  radius: 8, // 半径
  zIndex: 90, // 位于高亮图层之下，多边形图层之上
  visible: false, // 默认隐藏
});

// 4. 悬停高亮图层
// 专门用于显示单个被悬停的 POI（无论是来自地图悬停还是 TagCloud 悬停）
const hoverLayerSource = new VectorSource();
const hoverLayer = new VectorLayer({
  source: hoverLayerSource,
  style: new Style({
    image: new CircleStyle({
      radius: 9, // 1.5倍大小
      fill: new Fill({ color: 'rgba(255, 165, 0, 0.8)' }), // 橙色高亮
      stroke: new Stroke({ color: '#fff', width: 2 }), // 白色描边
    }),
    zIndex: 999 // 最高层级
  }),
  zIndex: 200
});

// 缓存的 OpenLayers Feature 对象，用于优化性能
// 避免每次渲染都重新创建 Feature
let olPoiFeatures = [];
// 映射表：原始数据对象 -> OpenLayers Feature 对象
let rawToOlMap = new Map();

/**
 * 动态更新热力图样式
 * 根据地图缩放级别自动调整热力点的半径和模糊度
 * 缩放级别大（视角近）：半径小，显示离散点
 * 缩放级别小（视角远）：半径大，显示聚合效果
 */
function updateHeatmapStyle() {
  if (!map.value) return;
  const zoom = map.value.getView().getZoom();
  
  const minZ = 10;
  const maxZ = 18;
  // 限制缩放级别范围
  const clampedZoom = Math.max(minZ, Math.min(maxZ, zoom));
  // 计算比例 0 (远) -> 1 (近)
  const ratio = (clampedZoom - minZ) / (maxZ - minZ); 
  
  // 半径: 远 -> 30, 近 -> 5
  const radius = 30 - ratio * (30 - 5);
  // 模糊度: 远 -> 25, 近 -> 5
  const blur = 25 - ratio * (25 - 5);
  
  heatmapLayer.setRadius(radius);
  heatmapLayer.setBlur(blur);
}

onMounted(() => {
  // 基础底图：高德地图 XYZ 瓦片
  // 如果 key 失效，可能需要替换或使用 OSM
  const amapKey = import.meta.env.VITE_AMAP_KEY || '2b42a2f72ef6751f2cd7c7bd24139e72';
  const gaodeUrl = `https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}&key=${amapKey}`;

  const baseLayer = new TileLayer({
    source: new XYZ({ url: gaodeUrl, crossOrigin: 'anonymous' })
  });

  // 初始化地图
  map.value = new OlMap({
    target: mapContainer.value,
    layers: [baseLayer, polygonLayer, heatmapLayer, highlightLayer, hoverLayer],
    view: new View({
      center: fromLonLat([114.307, 30.549]), // 默认中心点（武汉）
      zoom: 13,
    }),
  });

  // 绑定地图事件
  map.value.on('moveend', onMapMoveEnd); // 移动结束
  map.value.on('pointermove', onPointerMove); // 鼠标移动
  map.value.on('singleclick', onMapClick); // 点击
  
  // 监听缩放变化以更新热力图样式
  map.value.getView().on('change:resolution', updateHeatmapStyle);

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
 * 优先检测精确点击，如果没有则进行距离检测
 */
function onMapClick(evt) {
  // if (evt.dragging) return; // 允许轻微移动
  
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let foundRaw = null;
  
  // 1. 尝试标准点击检测 (Hit Detection)
  map.value.forEachFeatureAtPixel(pixel, (feature) => {
    const raw = feature.get('__raw');
    if (raw) {
      foundRaw = raw;
      return true;
    }
  }, { 
    // 移除特定图层过滤器，检查所有图层，只要有 __raw 属性
    hitTolerance: 10 
  });
  
  // 2. 降级方案：距离检测
  // 如果标准检测未命中（可能是点太小或点击偏移），则搜索附近的点
  if (!foundRaw) {
     const view = map.value.getView();
     const resolution = view.getResolution();
     const clickCoord = evt.coordinate;
     const threshold = resolution * 15; // 15像素容差（地图单位）
     
     let closestDist = Infinity;
     let closestFeature = null;
     
     // 在高亮图层中检查可见要素
     highlightLayerSource.forEachFeature((feat) => {
        const geom = feat.getGeometry();
        // 仅处理点要素
        if (geom instanceof Point) {
           const coord = geom.getCoordinates();
           const dx = coord[0] - clickCoord[0];
           const dy = coord[1] - clickCoord[1];
           const dist = Math.sqrt(dx*dx + dy*dy);
           if (dist < threshold && dist < closestDist) {
              closestDist = dist;
              closestFeature = feat;
           }
        }
     });
     
     if (closestFeature) {
        foundRaw = closestFeature.get('__raw');
        console.log('[MapContainer] 通过距离检测找到要素:', closestDist);
     }
  }
  
  if (foundRaw) {
    console.log('[MapContainer] 点击了要素:', foundRaw);
    emit('click-feature', foundRaw);
  } else {
    console.log('[MapContainer] 点击地图但未找到要素');
  }
}

/**
 * 鼠标移动处理（悬停效果）
 */
function onPointerMove(evt) {
  if (evt.dragging) return;
  
  const pixel = map.value.getEventPixel(evt.originalEvent);
  
  // 简化的悬停检测
  let hitRaw = null;
  map.value.forEachFeatureAtPixel(pixel, (feature) => {
     if (feature.get('__raw')) {
        hitRaw = feature.get('__raw');
        return true;
     }
  }, {
     hitTolerance: 8
  });
  
  if (hitRaw) {
    map.value.getTargetElement().style.cursor = 'pointer'; // 鼠标变手型
    emitHover(hitRaw);
    return;
  }
  
  map.value.getTargetElement().style.cursor = ''; // 恢复默认鼠标
  emitHover(null);
}

onBeforeUnmount(() => {
  if (map.value) map.value.setTarget(null); // 销毁地图实例
});

// 监听 POI 数据变化，重建 OpenLayers 要素
watch(() => props.poiFeatures, () => {
  rebuildPoiOlFeatures();
}, { deep: true });

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
function flyTo(feature) {
  if (!map.value || !feature) return;
  const [lon, lat] = feature.geometry.coordinates;
  
  let center;
  if (rawToOlMap.has(feature)) {
    // 优先使用缓存的 OL Feature 坐标（已经过投影转换）
    center = rawToOlMap.get(feature).getGeometry().getCoordinates();
  } else {
     // 降级：直接转换坐标
     center = fromLonLat([lon, lat]);
  }
  
  map.value.getView().animate({
    center: center,
    duration: 1000,
    zoom: 16
  });
}

/**
 * 开启绘制模式
 * @param {string} mode - 'Polygon' (多边形) 或 'Circle' (圆形)
 */
function openPolygonDraw(mode = 'Polygon') {
  if (!map.value) return;
  // 确保同一时间只有一个绘制交互
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
  }
  
  drawInteraction = new Draw({ source: polygonLayerSource, type: mode });
  
  drawInteraction.on('drawend', (evt) => {
    const geometry = evt.feature.getGeometry();
    const type = geometry.getType(); // 'Polygon' 或 'Circle'
    
    if (type === 'Polygon') {
      onPolygonComplete(geometry);
    } else if (type === 'Circle') {
      onCircleComplete(geometry);
    }
    
    // 完成一个形状后自动停止绘制
    closePolygonDraw();
  });
  map.value.addInteraction(drawInteraction);
}

/**
 * 圆形绘制完成回调
 * @param {Object} circleGeom - 圆形几何对象
 */
function onCircleComplete(circleGeom) {
  const center = circleGeom.getCenter();
  const radius = circleGeom.getRadius(); // 半径（地图单位，EPSG:3857下为米）
  
  const insideRaw = [];
  
  // 筛选圆内的 POI
  // 由于 POI 和圆都在同一投影下 (EPSG:3857)，可以直接使用欧几里得距离
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const dx = coord[0] - center[0];
    const dy = coord[1] - center[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= radius) {
      insideRaw.push(feat.get('__raw'));
    }
  }
  
  // 更新热力图数据
  heatmapSource.clear();
  if (insideRaw.length > 0) {
     const feats = insideRaw.map(raw => {
        if (rawToOlMap.has(raw)) return rawToOlMap.get(raw);
        const [lon, lat] = raw.geometry.coordinates;
        return new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
     });
     heatmapSource.addFeatures(feats);
  }

  // 计算 TagCloud 定位的中心像素点（使用圆心）
  const centerPixelObj = { 
    x: map.value.getPixelFromCoordinate(center)[0], 
    y: map.value.getPixelFromCoordinate(center)[1] 
  };

  showHighlights(insideRaw, { full: true });
  
  emit('polygon-completed', { 
    polygon: null, // 圆形模式下没有多边形边界
    center: centerPixelObj,
    selected: insideRaw,
    type: 'Circle', // 标识模式
    circleCenter: toLonLat(center), // 转换圆心坐标为经纬度
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

function clearHighlights() {
  highlightLayerSource.clear();
}

/**
 * 显示高亮要素
 * @param {Array} features - 要高亮的原始特征数组
 * @param {Object} options - 配置项 { full: boolean }
 */
function showHighlights(features, options = {}) {
  clearHighlights();
  if (!features || !features.length) return;
  const full = !!options.full;
  let subset = features;
  // 如果数量过多且非全量模式，进行采样显示
  if (!full && subset.length > 400) {
    const step = Math.ceil(subset.length / 400);
    subset = subset.filter((_, i) => i % step === 0);
  }
  const toFeature = (raw) => {
    if (raw instanceof Feature) return raw; // 如果已经是 OL feature
    
    // 尝试先从缓存获取
    if (rawToOlMap.has(raw)) {
      return rawToOlMap.get(raw);
    }

    const [lon, lat] = raw.geometry.coordinates;
    const f = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
    f.set('__raw', raw); // 确保绑定原始数据
    return f;
  };
  const feats = subset.map(toFeature);
  highlightLayerSource.addFeatures(feats);
}


// 监听器
watch(heatmapEnabled, (val) => {
  if (heatmapLayer) {
    heatmapLayer.setVisible(val);
    if (val) {
      updateHeatmapStyle();
    }
  }
});

/**
 * 多边形绘制完成回调
 * @param {Object} polygonGeom - 多边形几何对象
 */
function onPolygonComplete(polygonGeom) {
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
  
  // 更新热力图数据
  heatmapSource.clear();
  if (insideRaw.length > 0) {
     const feats = insideRaw.map(raw => {
        if (rawToOlMap.has(raw)) return rawToOlMap.get(raw);
        const [lon, lat] = raw.geometry.coordinates;
        return new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
     });
     heatmapSource.addFeatures(feats);
  }

  // 计算多边形中心点
  const centerPixelObj = calculatePolygonCenter(ringPixels);

  showHighlights(insideRaw, { full: true });
  emit('polygon-completed', { 
    polygon: ringCoords.map((c) => toLonLat(c)), 
    center: centerPixelObj,
    selected: insideRaw,
    type: 'Polygon'
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
  highlightLayerSource.clear();
  heatmapSource.clear();
}

// 暴露给父组件的方法
defineExpose({ map, openPolygonDraw, closePolygonDraw, showHighlights, clearHighlights, clearPolygon, flyTo });

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
}

.map-filter-control {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  background-color: rgba(255, 255, 255, 0.9);
  padding: 10px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-width: 140px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.filter-label {
  font-size: 14px;
  color: #333;
  font-weight: 500;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .map-filter-control {
    top: 50px;
    right: 5px;
    min-width: auto;
    padding: 8px;
    gap: 6px;
  }
  
  .filter-label {
    font-size: 12px;
  }

  .control-row {
    gap: 8px;
  }
}
</style>
