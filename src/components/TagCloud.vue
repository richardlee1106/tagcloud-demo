<template>
  <div class="tag-cloud-wrapper">
    <div ref="tagCloudContainer" class="tag-cloud-container"></div>
    <div class="zoom-controls">
      <button @click="zoomIn" class="zoom-btn" title="放大">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <button @click="zoomOut" class="zoom-btn" title="缩小">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <button @click="resetZoom" class="zoom-btn" title="重置视图">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path>
          <path d="M13 13l6 6"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import * as d3 from 'd3';
import BasicWorker from '../workers/basic.worker.js?worker';
import SpiralWorker from '../workers/spiral.worker.js?worker';
import { fromLonLat } from 'ol/proj';

const emit = defineEmits(['hover-feature', 'locate-feature']);
const props = defineProps({
  data: Array,
  map: Object,
  algorithm: String,
  selectedBounds: Object,
  polygonCenter: Object,
  spiralConfig: Object,
  boundaryPolygon: Array,
  hoveredFeatureId: Object, // Pass the feature object
});

const tagCloudContainer = ref(null);
let worker = null;
let svgRef = null;
let rootGroupRef = null;
let zoomGroupRef = null;
let debounceTimer = null;
const MAX_TAGS = 1000; // 增加标签显示上限
const RESIZE_DEBOUNCE_MS = 120;

// Zoom and pan state
let currentTransform = d3.zoomIdentity;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;

// 初始化worker
function initWorker(algorithm) {
  // 清理旧worker
  if (worker) {
    worker.terminate();
  }
  
  // 根据算法类型创建对应的worker
  if (algorithm === 'basic') {
    worker = new BasicWorker();
  } else {
    worker = new SpiralWorker();
  }
  
  // 设置worker消息处理
  worker.onmessage = event => {
    const tags = event.data;
    console.log('TagCloud received tags from Worker:', tags);

    const svg = d3.select(tagCloudContainer.value).select('svg');
    const root = svg.select('g.main-group');
    rootGroupRef = root; // Update reference
    const zoomGroup = svg.select('g.zoom-group');

    if (svg.empty() || root.empty() || zoomGroup.empty()) {
      console.error('SVG, main group, or zoom group not found during worker.onmessage.');
      return;
    }

    const texts = root
      .selectAll('text')
      .data(tags, (d) => (d.name ? `${d.name}-${d.originalIndex}` : `${d.originalIndex}`));

    texts.join(
      enter => enter.append('text')
        .attr('text-anchor', 'middle')
        .text(d => d.name)
        .attr('dy', '.35em')
        .style('font-size', d => `${(d.fontSize || (8 + (1 - d.normalizedDensity) * (24 - 8)))}px`)
        .style('fill', d => d.selected ? '#d23' : '#bfeaf1')
        .style('font-weight', d => d.selected ? '700' : '400')
        .style('cursor', 'pointer') // Add pointer cursor
        .attr('transform', d => `translate(${d.x}, ${d.y}) rotate(${d.rotation || 0})`)
        .on('mouseover', (event, d) => {
           const feature = props.data[d.originalIndex];
           emit('hover-feature', feature);
        })
        .on('mouseout', () => {
           emit('hover-feature', null);
        })
        .on('click', (event, d) => {
           event.stopPropagation();
           const feature = props.data[d.originalIndex];
           emit('locate-feature', feature);
        }),
      update => update
        .transition().duration(250)
        .style('font-size', d => `${(d.fontSize || (8 + (1 - d.normalizedDensity) * (24 - 8)))}px`)
        .style('fill', d => d.selected ? '#d23' : '#bfeaf1')
        .style('font-weight', d => d.selected ? '700' : '400')
        .attr('transform', d => `translate(${d.x}, ${d.y}) rotate(${d.rotation || 0})`)
        // Re-attach listeners if needed, but D3 preserves them on update usually. 
        // However, data might change, so it's safer to ensure they are correct.
        // Actually join update selection keeps listeners.
        ,
      exit => exit.remove()
    );
    
    // Apply current hover highlight if any
    if (props.hoveredFeatureId) {
      updateHighlight(props.hoveredFeatureId);
    }
  };
}

function updateHighlight(hoveredFeature) {
  if (!rootGroupRef || rootGroupRef.empty()) return;
  
  rootGroupRef.selectAll('text')
    .transition().duration(200)
    .style('fill', d => {
      const feature = props.data[d.originalIndex];
      const isHovered = feature === hoveredFeature;
      return isHovered ? 'orange' : (d.selected ? '#d23' : '#bfeaf1');
    })
    .style('font-weight', d => {
      const feature = props.data[d.originalIndex];
      const isHovered = feature === hoveredFeature;
      return isHovered ? 'bold' : (d.selected ? '700' : '400');
    });
}

watch(() => props.hoveredFeatureId, (newVal) => {
  updateHighlight(newVal);
});

const runLayout = (algorithm) => {
  console.log('runLayout called. Props.data:', props.data, 'Props.map:', props.map); // 检查传入的data和map
  if (!props.data) {
    console.log('runLayout early return. Data exists:', !!props.data);
    return;
  }

  console.log('TagCloud received data:', props.data); // 打印接收到的数据

  const width = tagCloudContainer.value.clientWidth;
  const height = tagCloudContainer.value.clientHeight;

  // Always re-select to ensure refs are not stale
  let svg = d3.select(tagCloudContainer.value).select('svg');
  if (svg.empty()) {
    svg = d3.select(tagCloudContainer.value).append('svg');
    // Create nested group structure for zoom/pan
    svg.append('g').attr('class', 'zoom-group');
  }

  // Get zoom group and set up main group within it
  const zoomGroup = svg.select('g.zoom-group');
  let root = zoomGroup.select('g.main-group');
  if (root.empty()) {
    root = zoomGroup.append('g').attr('class', 'main-group');
  }

  svg.attr('width', width)
     .attr('height', height)
     .style('background-color', 'rgba(255, 255, 255, 0.1)'); // Debug background

  // Set up zoom behavior if not already set up
  if (!svgRef || !zoomGroupRef) {
    const zoom = d3.zoom()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .on('zoom', (event) => {
        currentTransform = event.transform;
        zoomGroup.attr('transform', currentTransform);
      });

    svg.call(zoom);
    svgRef = svg;
    zoomGroupRef = zoomGroup;
  }

  // Compute tag positions and selection flag
  let tags = (props.data || []).map((feature, index) => {
    const name = feature?.properties?.['名称'] ?? feature?.properties?.name ?? feature?.properties?.Name ?? '';
    const weight = feature?.properties?.weight; // Extract weight if available
    return {
      name,
      weight, // Pass weight to worker
      x: width / 2,
      y: height / 2,
      originalIndex: index, // Keep track of index in props.data
    };
  }).filter(t => t.name && t.name.trim() !== '');

  console.log('[TagCloud] After name extraction:', tags.length, 'tags');

  // Thin out very large datasets to keep DOM size manageable
  if (tags.length > MAX_TAGS) {
    // 按密度排序后选取前MAX_TAGS个，而不是简单抽样
    const tempTags = calculateDensityGrid(tags, 64, width, height);
    tempTags.sort((a, b) => b.normalizedDensity - a.normalizedDensity);
    tags = tempTags.slice(0, MAX_TAGS);
    console.log('[TagCloud] Thinned to MAX_TAGS:', tags.length);
  }

  // Fast approximate density using grid to avoid O(n^2)
  if (tags.length <= MAX_TAGS) {
    tags = calculateDensityGrid(tags, 64, width, height);
  }

  console.log('[TagCloud] After density calculation:', tags.length, 'tags');

  // Highlight tags inside selected bounds (if any)
  const rect = getSelectedRect(props.selectedBounds);
  if (rect) {
    tags = tags.map(t => ({
      ...t,
      selected: t.x >= rect.xMin && t.x <= rect.xMax && t.y >= rect.yMin && t.y <= rect.yMax,
    }));
  } else {
    tags = tags.map(t => ({ ...t, selected: false }));
  }

  console.log('[TagCloud] Sending to worker:', tags.length, 'tags');
  
  // Pass polygon center to worker for spiral algorithm (ensure it's serializable)
  const serializablePolygonCenter = (props.polygonCenter && typeof props.polygonCenter.x === 'number' && typeof props.polygonCenter.y === 'number')
    ? { x: props.polygonCenter.x, y: props.polygonCenter.y }
    : { x: width / 2, y: height / 2 };
  const plainConfig = props.spiralConfig ? {
    initialDistance: Number(props.spiralConfig.initialDistance ?? 5),
    spiralSpacing: Number(props.spiralConfig.spiralSpacing ?? 8),
    angleStep: Number(props.spiralConfig.angleStep ?? 0.2),
    minTagSpacing: Number(props.spiralConfig.minTagSpacing ?? 25),
    fontMin: 8,
    fontMax: 24
  } : null;
  let boundaryPixels = null;
  if (Array.isArray(props.boundaryPolygon) && props.boundaryPolygon.length && props.map) {
    try {
      boundaryPixels = props.boundaryPolygon.map(([lng, lat]) => {
        const coord = fromLonLat([lng, lat]);
        const px = props.map.getPixelFromCoordinate(coord);
        return [px[0], px[1]];
      });
    } catch (e) {
      boundaryPixels = null;
    }
  }
  
  worker.postMessage({ 
    tags, 
    algorithm, 
    width, 
    height,
    polygonCenter: serializablePolygonCenter,
    config: plainConfig,
    boundary: boundaryPixels
  });
};

onMounted(() => {
  initWorker(props.algorithm || 'basic');
  runLayout(props.algorithm);

  window.addEventListener('resize', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runLayout(props.algorithm), RESIZE_DEBOUNCE_MS);
  });
});

function scheduleRunLayout() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runLayout(props.algorithm), 80);
}

watch([
  () => props.algorithm,
  () => props.data,
  () => props.selectedBounds,
  () => props.polygonCenter,
  () => props.boundaryPolygon,
], ([newAlgorithm, ...rest], [oldAlgorithm]) => {
  // 如果算法改变,重新初始化worker
  if (newAlgorithm !== oldAlgorithm) {
    initWorker(newAlgorithm || 'basic');
  }
  scheduleRunLayout();
});

// Utilities
function getSelectedRect(bounds) {
  return null; // Temporarily disable selection logic
  if (!bounds || !props.map) return null;
  try {
    const sw = bounds.getSouthWest ? bounds.getSouthWest() : (bounds.sw || bounds.SW || bounds.bottomLeft || bounds.min);
    const ne = bounds.getNorthEast ? bounds.getNorthEast() : (bounds.ne || bounds.NE || bounds.topRight || bounds.max);
    if (!sw || !ne) return null;
    const p1Arr = props.map.getPixelFromCoordinate(fromLonLat([sw.lng ?? sw[0], sw.lat ?? sw[1]]));
    const p2Arr = props.map.getPixelFromCoordinate(fromLonLat([ne.lng ?? ne[0], ne.lat ?? ne[1]]));
    const xMin = Math.min(p1Arr[0], p2Arr[0]);
    const xMax = Math.max(p1Arr[0], p2Arr[0]);
    const yMin = Math.min(p1Arr[1], p2Arr[1]);
    const yMax = Math.max(p1Arr[1], p2Arr[1]);
    return { xMin, xMax, yMin, yMax };
  } catch (e) {
    return null;
  }
}

function calculateDensityGrid(items, cellSize, width, height) {
  if (!items || items.length === 0) return [];
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const t of items) {
    const ci = Math.min(cols - 1, Math.max(0, Math.floor(t.x / cellSize)));
    const ri = Math.min(rows - 1, Math.max(0, Math.floor(t.y / cellSize)));
    grid[ri][ci] += 1;
  }
  const densities = items.map(t => {
    const ci = Math.min(cols - 1, Math.max(0, Math.floor(t.x / cellSize)));
    const ri = Math.min(rows - 1, Math.max(0, Math.floor(t.y / cellSize)));
    let sum = 0, count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = ri + dr, c = ci + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          sum += grid[r][c];
          count++;
        }
      }
    }
    return sum / Math.max(1, count);
  });
  const max = Math.max(1, ...densities);
  return items.map((t, i) => ({ ...t, normalizedDensity: densities[i] / max }));
}

// Zoom control methods
const zoomIn = () => {
  if (svgRef) {
    svgRef.transition().duration(300).call(
      d3.zoom().scaleBy, 1.5
    );
  }
};

const zoomOut = () => {
  if (svgRef) {
    svgRef.transition().duration(300).call(
      d3.zoom().scaleBy, 1 / 1.5
    );
  }
};

const resetZoom = () => {
  if (svgRef) {
    currentTransform = d3.zoomIdentity;
    svgRef.transition().duration(300).call(
      d3.zoom().transform, d3.zoomIdentity
    );
  }
};

</script>
<style scoped>
.tag-cloud-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
}

.tag-cloud-container {
  width: 100%;
  height: 100%;
}

.zoom-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  z-index: 10;
}

.zoom-btn {
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.zoom-btn:hover {
  background: #f5f5f5;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.zoom-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.zoom-btn svg {
  stroke: #333;
}

.zoom-btn:hover svg {
  stroke: #007acc;
}
</style>
