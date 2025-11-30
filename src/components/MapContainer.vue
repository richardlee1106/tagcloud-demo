<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container"></div>
    
    <!-- Real-time Filter Control -->
    <div class="map-filter-control">
      <span class="filter-label">实时过滤</span>
      <el-switch 
        v-model="filterEnabled" 
        @change="toggleFilter"
        inline-prompt
        active-text="开启"
        inactive-text="关闭"
      />
    </div>
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
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';

const emit = defineEmits(['polygon-completed', 'map-ready', 'hover-feature', 'click-feature', 'map-move-end', 'toggle-filter']);
const props = defineProps({
  poiFeatures: { type: Array, default: () => [] },
  hoveredFeatureId: { type: Object, default: null }, // We use the feature object itself as ID
});

const mapContainer = ref(null);
const map = ref(null);
let drawInteraction = null;
let hoveredFeature = null; // Internal track of currently hovered feature on map
const filterEnabled = ref(false);

const toggleFilter = (val) => {
  emit('toggle-filter', val);
};

// Layers
const polygonLayerSource = new VectorSource();
const polygonLayer = new VectorLayer({
  source: polygonLayerSource,
  style: new Style({
    stroke: new Stroke({ color: '#2ecc71', width: 2 }),
    fill: new Fill({ color: 'rgba(46,204,113,0.1)' }),
  }),
  zIndex: 50 // Lower z-index
});

const highlightLayerSource = new VectorSource();
const highlightLayer = new VectorLayer({
  source: highlightLayerSource,
  style: new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: 'rgba(255,0,0,0.4)' }),
      stroke: new Stroke({ color: 'red', width: 2 }),
    }),
  }),
  zIndex: 100 // Higher z-index
});

// Special layer for single hover highlight
const hoverLayerSource = new VectorSource();
const hoverLayer = new VectorLayer({
  source: hoverLayerSource,
  style: new Style({
    image: new CircleStyle({
      radius: 9, // 1.5x size
      fill: new Fill({ color: 'rgba(255, 165, 0, 0.8)' }), // Orange
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    zIndex: 999 // Highest z-index
  }),
  zIndex: 200 // Also set layer z-index
});

// Cached OL features for POIs
let olPoiFeatures = [];
let rawToOlMap = new Map();

onMounted(() => {
  // Base layer: Gaode (Amap) XYZ tiles with key; fallback to OSM if blocked
  const amapKey = import.meta.env.VITE_AMAP_KEY || '2b42a2f72ef6751f2cd7c7bd24139e72';
  const gaodeUrl = `https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}&key=${amapKey}`;

  const baseLayer = new TileLayer({
    source: new XYZ({ url: gaodeUrl, crossOrigin: 'anonymous' })
  });

  map.value = new OlMap({
    target: mapContainer.value,
    layers: [baseLayer, polygonLayer, highlightLayer, hoverLayer],
    view: new View({
      center: fromLonLat([114.307, 30.549]),
      zoom: 13,
    }),
  });

  // Event Listeners
  map.value.on('moveend', onMapMoveEnd);
  map.value.on('pointermove', onPointerMove);
  map.value.on('singleclick', onMapClick);

  rebuildPoiOlFeatures();

  // Emit the map instance to the parent component after initialization
  nextTick(() => {
    emit('map-ready', map.value);
  });
});

// Watch for external hover (from TagCloud)
watch(() => props.hoveredFeatureId, (newVal) => {
  hoverLayerSource.clear();
  if (newVal && rawToOlMap.has(newVal)) {
    const olFeature = rawToOlMap.get(newVal);
    // We clone it to display in the hover layer
    const clone = olFeature.clone();
    // Explicitly copy the __raw property to ensure it persists in the clone
    // This is critical for the reverse interaction (Map -> TagCloud) when hovering the cloned feature
    clone.set('__raw', olFeature.get('__raw'));
    hoverLayerSource.addFeature(clone);
  }
});

function onMapMoveEnd() {
  if (!map.value) return;
  const extent = map.value.getView().calculateExtent(map.value.getSize());
  const bl = toLonLat([extent[0], extent[1]]);
  const tr = toLonLat([extent[2], extent[3]]);
  // [minLon, minLat, maxLon, maxLat]
  emit('map-move-end', [bl[0], bl[1], tr[0], tr[1]]);
}

// Debounce helper
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
}, 50); // 50ms debounce

function onMapClick(evt) {
  // if (evt.dragging) return; // Allow slight movement
  
  const pixel = map.value.getEventPixel(evt.originalEvent);
  let foundRaw = null;
  
  // 1. Try standard hit detection
  map.value.forEachFeatureAtPixel(pixel, (feature) => {
    const raw = feature.get('__raw');
    if (raw) {
      foundRaw = raw;
      return true;
    }
  }, { 
    // Remove specific layer filter to be safe, just check for __raw
    hitTolerance: 10 
  });
  
  // 2. Fallback: Distance check
  if (!foundRaw) {
     const view = map.value.getView();
     const resolution = view.getResolution();
     const clickCoord = evt.coordinate;
     const threshold = resolution * 15; // 15 pixels tolerance in map units
     
     let closestDist = Infinity;
     let closestFeature = null;
     
     // Check visible features in highlight layer
     highlightLayerSource.forEachFeature((feat) => {
        const geom = feat.getGeometry();
        // Only points
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
        console.log('[MapContainer] Fallback found feature by distance:', closestDist);
     }
  }
  
  if (foundRaw) {
    console.log('[MapContainer] Clicked feature:', foundRaw);
    emit('click-feature', foundRaw);
  } else {
    console.log('[MapContainer] Clicked map but no feature found');
  }
}

function onPointerMove(evt) {
  if (evt.dragging) return;
  
  const pixel = map.value.getEventPixel(evt.originalEvent);
  
  // Simplified hover detection
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
    map.value.getTargetElement().style.cursor = 'pointer';
    emitHover(hitRaw);
    return;
  }
  
  map.value.getTargetElement().style.cursor = '';
  emitHover(null);
}

onBeforeUnmount(() => {
  if (map.value) map.value.setTarget(null);
});

watch(() => props.poiFeatures, () => {
  rebuildPoiOlFeatures();
}, { deep: true });

function rebuildPoiOlFeatures() {
  olPoiFeatures = [];
  rawToOlMap.clear();
  const poiCoordSys = import.meta.env.VITE_POI_COORD_SYS || 'gcj02';
  for (const f of (props.poiFeatures || [])) {
    let [lon, lat] = f.geometry.coordinates;
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

function flyTo(feature) {
  if (!map.value || !feature) return;
  const [lon, lat] = feature.geometry.coordinates;
  // Assuming coordinates are already consistent with map projection (GCJ02 handling needed?)
  // rebuildPoiOlFeatures handles the conversion for display.
  // But feature.geometry.coordinates are likely original.
  // We should check how they are stored.
  // In rebuildPoiOlFeatures, we convert.
  // We should use the stored OL feature position if possible.
  
  let center;
  if (rawToOlMap.has(feature)) {
    center = rawToOlMap.get(feature).getGeometry().getCoordinates();
  } else {
     // Fallback
     center = fromLonLat([lon, lat]);
  }
  
  map.value.getView().animate({
    center: center,
    duration: 1000,
    zoom: 16
  });
}

function openPolygonDraw() {
  if (!map.value) return;
  // Ensure only one draw interaction is active at a time
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
  }
  drawInteraction = new Draw({ source: polygonLayerSource, type: 'Polygon' });
  drawInteraction.on('drawend', (evt) => {
    const polygon = evt.feature.getGeometry();
    onPolygonComplete(polygon);
    // Automatically stop drawing after one polygon is completed
    closePolygonDraw();
  });
  map.value.addInteraction(drawInteraction);
}

function closePolygonDraw() {
  if (!map.value) return;
  
  // 1. Remove specific interaction if reference exists
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
    drawInteraction = null;
  }
  
  // 2. Robust cleanup: Iterate all interactions and remove any active Draw interactions
  // This fixes the issue where "Stop Drawing" didn't work if the reference was lost or mismatched
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

function showHighlights(features, options = {}) {
  clearHighlights();
  if (!features || !features.length) return;
  const full = !!options.full;
  let subset = features;
  if (!full && subset.length > 400) {
    const step = Math.ceil(subset.length / 400);
    subset = subset.filter((_, i) => i % step === 0);
  }
  const toFeature = (raw) => {
    if (raw instanceof Feature) return raw; // If it's already an OL feature
    
    // Try to find cached feature first
    if (rawToOlMap.has(raw)) {
      return rawToOlMap.get(raw);
    }

    const [lon, lat] = raw.geometry.coordinates;
    const f = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
    f.set('__raw', raw); // Ensure raw data is attached
    return f;
  };
  const feats = subset.map(toFeature);
  highlightLayerSource.addFeatures(feats);
}

function onPolygonComplete(polygonGeom) {
  const ringCoords = polygonGeom.getCoordinates()[0];
  const ringPixels = ringCoords.map((c) => map.value.getPixelFromCoordinate(c));

  const insideRaw = [];
  for (const feat of olPoiFeatures) {
    const coord = feat.getGeometry().getCoordinates();
    const px = map.value.getPixelFromCoordinate(coord);
    if (pointInPolygonPixel(px, ringPixels)) {
      insideRaw.push(feat.get('__raw'));
    }
  }

  // Calculate polygon center point
  const centerPixel = calculatePolygonCenter(ringPixels);

  showHighlights(insideRaw, { full: true });
  emit('polygon-completed', { 
    polygon: ringCoords.map((c) => toLonLat(c)), 
    center: centerPixel,
    selected: insideRaw 
  });
}

// Calculate the centroid of polygon for tag cloud layout
function calculatePolygonCenter(ringPixels) {
  let x = 0, y = 0;
  const n = ringPixels.length;
  
  for (let i = 0; i < n; i++) {
    x += ringPixels[i][0];
    y += ringPixels[i][1];
  }
  
  return { x: x / n, y: y / n };
}

function pointInPolygonPixel(pt, ringPixels) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ringPixels.length - 1; i < ringPixels.length; j = i++) {
    const xi = ringPixels[i][0], yi = ringPixels[i][1];
    const xj = ringPixels[j][0], yj = ringPixels[j][1];
    // Handle horizontal segments to avoid division by zero
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 清空多边形和高亮
function clearPolygon() {
  polygonLayerSource.clear();
  clearHighlights();
}

defineExpose({ map, openPolygonDraw, closePolygonDraw, showHighlights, clearHighlights, clearPolygon, flyTo });

// WGS84 -> GCJ-02 transform (approximate, China region only)
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
  padding: 6px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 14px;
  color: #333;
  font-weight: 500;
  white-space: nowrap;
}
</style>



