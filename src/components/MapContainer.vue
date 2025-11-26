<template>
  <div ref="mapContainer" class="map-container"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import Map from 'ol/Map';
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

const emit = defineEmits(['polygon-completed', 'map-ready']);
const props = defineProps({
  poiFeatures: { type: Array, default: () => [] },
});

const mapContainer = ref(null);
const map = ref(null);
let drawInteraction = null;

// Layers
const polygonLayerSource = new VectorSource();
const polygonLayer = new VectorLayer({
  source: polygonLayerSource,
  style: new Style({
    stroke: new Stroke({ color: '#2ecc71', width: 2 }),
    fill: new Fill({ color: 'rgba(46,204,113,0.1)' }),
  }),
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
});

// Cached OL features for POIs
let olPoiFeatures = [];

onMounted(() => {
  // Base layer: Gaode (Amap) XYZ tiles with key; fallback to OSM if blocked
  const amapKey = import.meta.env.VITE_AMAP_KEY || '2b42a2f72ef6751f2cd7c7bd24139e72';
  const gaodeUrl = `https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}&key=${amapKey}`;

  const baseLayer = new TileLayer({
    source: new XYZ({ url: gaodeUrl, crossOrigin: 'anonymous' })
  });

  map.value = new Map({
    target: mapContainer.value,
    layers: [baseLayer, polygonLayer, highlightLayer],
    view: new View({
      center: fromLonLat([114.307, 30.549]),
      zoom: 13,
    }),
  });

  rebuildPoiOlFeatures();

  // Emit the map instance to the parent component after initialization
  nextTick(() => {
    emit('map-ready', map.value);
  });
});

onBeforeUnmount(() => {
  if (map.value) map.value.setTarget(null);
});

watch(() => props.poiFeatures, () => {
  rebuildPoiOlFeatures();
}, { deep: true });

function rebuildPoiOlFeatures() {
  olPoiFeatures = [];
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
  }
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
  if (drawInteraction) {
    map.value.removeInteraction(drawInteraction);
    drawInteraction = null;
  }
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
    if (raw.getGeometry) return raw;
    const [lon, lat] = raw.geometry.coordinates;
    return new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
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

defineExpose({ map, openPolygonDraw, closePolygonDraw, showHighlights, clearHighlights, clearPolygon });

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
.map-container {
  width: 100%;
  height: 100%;
}
</style>



