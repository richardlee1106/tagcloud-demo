<template>
  <div class="embedded-tagcloud-container" ref="containerRef">
    <!-- 标题栏 + 控制按钮 -->
    <div class="tagcloud-header">
      <span class="tagcloud-title">📊 地名标签云</span>
      <div class="tagcloud-controls">
        <button 
          class="control-btn" 
          :class="{ active: currentMode === 'coarse' }"
          @click="switchMode('coarse')"
          title="粗略聚合 (50个)"
        >
          粗略聚合
        </button>
        <button 
          class="control-btn" 
          :class="{ active: currentMode === 'fine' }"
          @click="switchMode('fine')"
          title="高精聚合 (20个)"
        >
          高精聚合
        </button>
        <button 
          class="control-btn render-btn" 
          @click="renderToMap"
          title="将标签云渲染到地图"
        >
          渲染至地图
        </button>
      </div>
    </div>
    
    <!-- Canvas 画布区域 -->
    <div class="tagcloud-canvas-wrapper">
      <canvas 
        ref="canvasRef" 
        class="tagcloud-canvas"
        @click="handleCanvasClick"
        @mousedown="handleCanvasMouseDown"
        @wheel="handleCanvasWheel"
      ></canvas>
      
      <!-- 加载指示器 -->
      <div v-if="isCalculating" class="loading-overlay">
        <div class="loading-spinner"></div>
        <span>计算布局中...</span>
      </div>
    </div>
    
    <!-- 底部统计 -->
    <div class="tagcloud-footer">
      <span class="tag-count">{{ placedTags.length }} / {{ currentMode === 'coarse' ? 50 : 20 }} 个标签</span>
      <span class="mode-indicator">{{ intentMode === 'macro' ? '🌍 宏观分析' : '🔍 微观检索' }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { buildPlaceTagsFromPois } from '../utils/placeTagExtractor'

const props = defineProps({
  // 后端返回的 POI 数据
  pois: { type: Array, default: () => [] },
  // 意图模式：macro | micro
  intentMode: { type: String, default: 'macro' },
  // 默认高度
  height: { type: Number, default: 220 }
})

const emit = defineEmits(['render-to-map', 'tag-click'])

// 响应式状态
const containerRef = ref(null)
const canvasRef = ref(null)
const currentMode = ref('fine') // 'coarse' | 'fine'
const isCalculating = ref(false)
const placedTags = ref([])
const canvasWidth = ref(380) // 动态宽度

// 变换与交互
const transform = ref({ k: 1, x: 0, y: 0 })
const isDragging = ref(false)
const lastMousePos = ref({ x: 0, y: 0 })

// Worker 实例
let worker = null
let resizeObserver = null

// 初始化 Worker
onMounted(() => {
  // 1. 初始化 Worker
  worker = new Worker(new URL('../workers/basic.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => {
    placedTags.value = event.data || []
    isCalculating.value = false
    renderCanvas()
  }
  
  // 2. 监听容器宽度自适应
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          canvasWidth.value = Math.floor(entry.contentRect.width)
          // 宽度变化后，如果已有数据，重新渲染；如果没有数据，不管
          if (placedTags.value.length > 0) {
            requestAnimationFrame(renderCanvas)
          } else {
             // 首次加载且无数据时可能需要计算
             if (props.pois.length > 0 && !isCalculating.value) calculateLayout()
          }
        }
      }
    })
    resizeObserver.observe(containerRef.value)
  }
  
  // 初始计算
  if (props.pois.length > 0) {
    calculateLayout()
  }
})

onUnmounted(() => {
  if (worker) worker.terminate()
  if (resizeObserver) resizeObserver.disconnect()
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
})

// 监听 POI 数据变化
watch(() => props.pois, (newPois) => {
  if (newPois.length > 0) {
    calculateLayout()
  }
}, { immediate: true })

// 切换模式
function switchMode(mode) {
  if (mode === currentMode.value) return
  currentMode.value = mode
  calculateLayout()
}

// 计算布局
function calculateLayout() {
  if (!worker || props.pois.length === 0) return
  isCalculating.value = true
  
  const topK = currentMode.value === 'coarse' ? 50 : 20
  
  // 关键修复：使用 JSON.parse(JSON.stringify()) 深拷贝去除 Proxy 响应式包装
  let rawPois = []
  try {
    rawPois = JSON.parse(JSON.stringify(props.pois.slice(0, topK)))
  } catch (e) {
    console.warn('[TagCloud] POI 数据序列化失败，尝试手动提取:', e)
    rawPois = props.pois.slice(0, topK).map(p => ({
      id: p.id || p.poiid,
      name: p.name || p.名称,
      type: p.type || p.小类 || p.大类,
      score: p.score || p.relevance_score,
      properties: { ...p.properties },
      geometry: { ...p.geometry }
    }))
  }
  
  const tags = buildPlaceTagsFromPois(rawPois, {
    mode: currentMode.value,
    intentMode: props.intentMode,
    maxCount: topK
  })
  
  // 发送到 Worker 计算 (使用 canvasWidth.value)
  worker.postMessage({
    tags,
    width: canvasWidth.value || 380,
    height: props.height,
    config: {
      fontMin: 12,
      fontMax: 18,
      padding: 3,
      spiralStep: 4
    }
  })
}

// 渲染 Canvas
function renderCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const w = canvasWidth.value
  const h = props.height
  
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  
  // 基础缩放 (DPR)
  ctx.scale(dpr, dpr)
  
  // 清空画布
  ctx.clearRect(0, 0, w, h)
  
  // 绘制背景
  ctx.fillStyle = 'rgba(20, 25, 35, 0.6)'
  ctx.fillRect(0, 0, w, h)

  // 应用视图变换 (缩放 + 平移)
  ctx.save()
  ctx.translate(transform.value.x, transform.value.y)
  ctx.scale(transform.value.k, transform.value.k)
  
  // 绘制标签
  placedTags.value.forEach((tag, index) => {
    if (!tag.placed) return
    
    ctx.save()
    ctx.translate(tag.x, tag.y)
    
    // 根据权重/索引计算颜色
    const hue = 200 + (index * 5) % 60 // 蓝-紫色系
    const saturation = 60 + Math.random() * 20
    const lightness = 65 + Math.random() * 15 // 稍微调亮一点
    
    ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
    const fontSize = tag.fontSize
    ctx.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    
    // 文字阴影
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = 4
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    
    ctx.fillText(tag.text, 0, 0)
    
    ctx.restore()
  })
  
  ctx.restore()
}

// 如果放置完成，自动适配视图
watch([placedTags, canvasWidth], () => {
  if (placedTags.value.length > 0) {
    fitToView()
  }
})

// 自动适配视图算法
function fitToView() {
    if (placedTags.value.length === 0) return
    
    // 1. 计算内容边界
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    let hasPlaced = false
    
    placedTags.value.forEach(tag => {
        if (!tag.placed) return
        hasPlaced = true
        minX = Math.min(minX, tag.x - tag.width/2)
        maxX = Math.max(maxX, tag.x + tag.width/2)
        minY = Math.min(minY, tag.y - tag.height/2)
        maxY = Math.max(maxY, tag.y + tag.height/2)
    })
    
    if (!hasPlaced) return
    
    // 2. 增加 padding
    const padding = 20
    const w = canvasWidth.value
    const h = props.height
    
    const contentWidth = maxX - minX + padding * 2
    const contentHeight = maxY - minY + padding * 2
    
    // 3. 计算缩放比
    const scaleX = w / contentWidth
    const scaleY = h / contentHeight
    const scale = Math.min(scaleX, scaleY) * 0.9 // 留出 10% 余量
    
    // 4. 计算中心偏移
    const contentCenterX = (minX + maxX) / 2
    const contentCenterY = (minY + maxY) / 2
    
    const tx = w / 2 - contentCenterX * scale
    const ty = h / 2 - contentCenterY * scale
    
    transform.value = { k: scale, x: tx, y: ty }
    renderCanvas()
}

const dragStartPos = ref({ x: 0, y: 0 })

// Canvas 交互事件处理
function handleCanvasMouseDown(e) {
  isDragging.value = true
  lastMousePos.value = { x: e.clientX, y: e.clientY }
  dragStartPos.value = { x: e.clientX, y: e.clientY } // 记录起始位置
  document.body.style.cursor = 'grabbing'
  
  // 绑定全局事件
  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
}

function handleWindowMouseMove(e) {
  if (!isDragging.value) return
  const dx = e.clientX - lastMousePos.value.x
  const dy = e.clientY - lastMousePos.value.y
  
  transform.value.x += dx
  transform.value.y += dy
  lastMousePos.value = { x: e.clientX, y: e.clientY }
  renderCanvas()
}

function handleWindowMouseUp() {
  isDragging.value = false
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
}

function handleCanvasWheel(e) {
  e.preventDefault()
  
  const zoomIntensity = 0.1
  const delta = e.deltaY > 0 ? (1 - zoomIntensity) : (1 + zoomIntensity)
  
  // 以鼠标为中心缩放
  const rect = canvasRef.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  
  const newK = transform.value.k * delta
  if (newK < 0.1 || newK > 10) return

  transform.value.x = mouseX - (mouseX - transform.value.x) * delta
  transform.value.y = mouseY - (mouseY - transform.value.y) * delta
  transform.value.k = newK
  
  renderCanvas()
}

// 处理 Canvas 点击
function handleCanvasClick(event) {
  // 计算总位移
  const dx = Math.abs(event.clientX - dragStartPos.value.x)
  const dy = Math.abs(event.clientY - dragStartPos.value.y)
  
  // 如果位移超过 3px，说明是拖拽，不触发点击
  if (dx > 3 || dy > 3) return

  const rect = canvasRef.value.getBoundingClientRect()
  const rawX = event.clientX - rect.left
  const rawY = event.clientY - rect.top
  
  const width = canvasWidth.value
  const height = props.height
  
  // (rawX, rawY) 是 Canvas 内的坐标
  // 需要将其转换回 World 坐标
  const wx = (rawX - transform.value.x) / transform.value.k
  const wy = (rawY - transform.value.y) / transform.value.k
  
  for (const tag of placedTags.value) {
    if (!tag.placed) continue
    if (
      wx >= tag.x - tag.width/2 && wx <= tag.x + tag.width/2 &&
      wy >= tag.y - tag.height/2 && wy <= tag.y + tag.height/2
    ) {
      emit('tag-click', tag)
      return
    }
  }
}

// 渲染至地图
function renderToMap() {
  // 提取所有已放置标签对应的原始 POI
  const poisToRender = placedTags.value
    .filter(t => t.placed && t.originalPoi)
    .map(t => t.originalPoi)
  
  emit('render-to-map', poisToRender)
}
</script>

<style scoped>
.embedded-tagcloud-container {
  background: linear-gradient(135deg, rgba(25, 32, 48, 0.95), rgba(15, 20, 30, 0.98));
  border-radius: 12px;
  border: 1px solid rgba(100, 120, 180, 0.3);
  overflow: hidden;
  margin: 12px 0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  width: 100%;
}

.tagcloud-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(40, 50, 70, 0.5);
  border-bottom: 1px solid rgba(100, 120, 180, 0.2);
}

.tagcloud-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(200, 210, 230, 0.9);
}

.tagcloud-controls {
  display: flex;
  gap: 6px;
}

.control-btn {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid rgba(100, 140, 200, 0.4);
  border-radius: 6px;
  background: rgba(60, 80, 120, 0.3);
  color: rgba(180, 200, 230, 0.9);
  cursor: pointer;
  transition: all 0.2s ease;
}

.control-btn:hover {
  background: rgba(80, 100, 150, 0.5);
  border-color: rgba(120, 160, 220, 0.6);
}

.control-btn.active {
  background: rgba(60, 120, 200, 0.5);
  border-color: rgba(100, 160, 240, 0.7);
  color: #fff;
}

.control-btn.render-btn {
  background: linear-gradient(135deg, rgba(80, 160, 120, 0.4), rgba(60, 140, 100, 0.5));
  border-color: rgba(100, 180, 140, 0.5);
}

.control-btn.render-btn:hover {
  background: linear-gradient(135deg, rgba(100, 180, 140, 0.6), rgba(80, 160, 120, 0.7));
}

.tagcloud-canvas-wrapper {
  position: relative;
  /* width: 100%; 由父容器控制 */
  background: rgba(20, 25, 35, 0.6);
}

.tagcloud-canvas {
  display: block;
  cursor: grab;
  user-select: none; /* 防止选中 */
}

.tagcloud-canvas:active {
  cursor: grabbing;
}

.loading-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(20, 25, 35, 0.8);
  color: rgba(180, 200, 230, 0.9);
  font-size: 12px;
  gap: 8px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(100, 150, 220, 0.3);
  border-top-color: rgba(100, 180, 255, 0.9);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.tagcloud-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  background: rgba(40, 50, 70, 0.4);
  border-top: 1px solid rgba(100, 120, 180, 0.15);
  font-size: 11px;
  color: rgba(150, 170, 200, 0.7);
}

.mode-indicator {
  font-weight: 500;
}
</style>
