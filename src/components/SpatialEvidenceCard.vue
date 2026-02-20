<template>
  <div class="spatial-evidence-card" v-if="hasEvidence">
    <section v-if="topHotspots.length" class="evidence-section clusters-section">
      <button type="button" class="section-header" @click="toggleSection('clusters')">
        <span class="section-icon">{{ copy.hotspots.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.hotspots.title }} ({{ topHotspots.length }})</span>
          <span class="section-subtitle">{{ copy.hotspots.subtitle }}</span>
        </div>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.clusters }">></span>
      </button>

      <div v-if="expandedSections.clusters" class="section-body">
        <div class="section-actions">
          <button type="button" class="mini-action-btn" @click.stop="askHotspotCause">
            {{ copy.hotspots.actions.cause }}
          </button>
          <button type="button" class="mini-action-btn" @click.stop="askHotspotOpportunity">
            {{ copy.hotspots.actions.opportunity }}
          </button>
        </div>

        <button
          v-for="(h, i) in topHotspots"
          :key="`hotspot-${i}`"
          type="button"
          class="hotspot-chip"
          :style="{ '--stagger': i }"
          @click="handleHotspotClick(h)"
        >
          <div class="chip-top-line">
            <span class="chip-rank">#{{ i + 1 }}</span>
            <span class="chip-label">{{ formatHotspotLabel(h) }}</span>
            <span
              v-if="hasBoundaryConfidence(h)"
              class="chip-confidence"
              :class="confidenceClass(resolveBoundaryConfidence(h))"
            >
              边界 {{ formatConfidencePercent(resolveBoundaryConfidence(h)) }}
            </span>
          </div>

          <div class="chip-bottom-line">
            <span class="chip-meta">{{ formatHotspotMeta(h) }}</span>
            <span v-if="formatSemanticSummary(h)" class="chip-semantic">
              {{ formatSemanticSummary(h) }}
            </span>
          </div>

          <div v-if="buildHoverDetail(h)" class="chip-hover-panel">
            {{ buildHoverDetail(h) }}
          </div>
        </button>
      </div>
    </section>

    <section v-if="topRegions.length" class="evidence-section regions-section">
      <button type="button" class="section-header" @click="toggleSection('regions')">
        <span class="section-icon">{{ copy.regions.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.regions.title }} ({{ topRegions.length }})</span>
          <span class="section-subtitle">{{ copy.regions.subtitle }}</span>
        </div>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.regions }">></span>
      </button>

      <div v-if="expandedSections.regions" class="section-body">
        <div class="section-actions">
          <button type="button" class="mini-action-btn" @click.stop="askRegionCompare">
            {{ copy.regions.actions.compare }}
          </button>
          <button type="button" class="mini-action-btn" @click.stop="askRegionStrategy">
            {{ copy.regions.actions.strategy }}
          </button>
        </div>

        <button
          v-for="(vr, i) in topRegions"
          :key="`region-${i}`"
          type="button"
          class="region-chip"
          :style="{ '--stagger': i }"
          @click="handleRegionClick(vr)"
        >
          <div class="chip-top-line">
            <span class="chip-rank">#{{ i + 1 }}</span>
            <span class="chip-label">{{ formatRegionLabel(vr) }}</span>
            <span v-if="vr.membership?.score" class="chip-confidence" :class="confidenceClass(vr.membership.score)">
              {{ Math.round(vr.membership.score * 100) }}%
            </span>
            <span
              v-if="hasBoundaryConfidence(vr)"
              class="chip-boundary-confidence"
              :class="confidenceClass(resolveBoundaryConfidence(vr))"
            >
              边界 {{ formatConfidencePercent(resolveBoundaryConfidence(vr)) }}
            </span>
            <span v-if="vr.membership?.level" class="chip-level">{{ levelLabel(vr.membership.level) }}</span>
          </div>

          <div class="chip-bottom-line">
            <span v-if="formatSemanticSummary(vr)" class="chip-semantic">
              {{ formatSemanticSummary(vr) }}
            </span>
          </div>

          <div v-if="buildHoverDetail(vr)" class="chip-hover-panel">
            {{ buildHoverDetail(vr) }}
          </div>
        </button>
      </div>
    </section>

    <section v-if="fuzzyRegions?.length" class="evidence-section fuzzy-section">
      <button type="button" class="section-header" @click="toggleSection('fuzzy')">
        <span class="section-icon">{{ copy.fuzzy.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.fuzzy.title }} ({{ fuzzyRegions.length }})</span>
          <span class="section-subtitle">{{ copy.fuzzy.subtitle }}</span>
        </div>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.fuzzy }">></span>
      </button>

      <div v-if="expandedSections.fuzzy" class="section-body">
        <div class="fuzzy-summary">
          <span v-for="level in fuzzyLevelSummary" :key="level.key" class="fuzzy-level-badge" :class="level.key">
            {{ level.label }} {{ level.count }}
          </span>
        </div>
        <div v-if="fuzzyBoundaryConfidence.avg !== null" class="confidence-row">
          <span class="fuzzy-confidence-badge" :class="confidenceClass(fuzzyBoundaryConfidence.avg)">
            边界可信 {{ formatConfidencePercent(fuzzyBoundaryConfidence.avg) }}
          </span>
          <span class="confidence-model-note">模型 {{ confidenceModel || 'composite_v1' }}</span>
        </div>
      </div>
    </section>

    <section v-if="boundary" class="evidence-section boundary-section">
      <div class="section-header static">
        <span class="section-icon">{{ copy.boundary.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.boundary.title }}</span>
          <span class="section-subtitle">{{ copy.boundary.subtitle }}</span>
          <span v-if="confidenceModel" class="section-subtitle boundary-model">
            可信度模型：{{ confidenceModel }}
          </span>
        </div>
        <button type="button" class="boundary-btn" @click="handleBoundarySectionClick">
          {{ copy.boundary.action }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'

const props = defineProps({
  clusters: { type: Object, default: null },
  vernacularRegions: { type: Array, default: null },
  fuzzyRegions: { type: Array, default: null },
  boundary: { type: [Object, Array], default: null }
})

const emit = defineEmits(['locate', 'show-boundary', 'ask-followup'])

const copy = {
  hotspots: {
    icon: '🔥',
    title: '高活力片区',
    subtitle: '按 POI 密度聚类，识别人流/业态聚集核心',
    actions: {
      cause: '追问成因',
      opportunity: '找机会点'
    }
  },
  regions: {
    icon: '🧭',
    title: '主导业态片区',
    subtitle: '按主导类别与空间连续性构建可解释分区',
    actions: {
      compare: '做相邻对比',
      strategy: '给经营建议'
    }
  },
  fuzzy: {
    icon: '🌫️',
    title: '渐变边界',
    subtitle: '展示核心-过渡-边缘层级'
  },
  boundary: {
    icon: '🗺️',
    title: '分析边界',
    subtitle: '查看本轮对话的空间约束范围',
    action: '显示'
  }
}

const expandedSections = reactive({
  clusters: true,
  regions: true,
  fuzzy: false
})

const hasEvidence = computed(() => {
  return (
    props.clusters?.hotspots?.length > 0 ||
    props.vernacularRegions?.length > 0 ||
    props.fuzzyRegions?.length > 0 ||
    !!props.boundary
  )
})

const topHotspots = computed(() => {
  if (!Array.isArray(props.clusters?.hotspots)) return []
  return [...props.clusters.hotspots]
    .sort((a, b) => Number(b?.poiCount || b?.poi_count || 0) - Number(a?.poiCount || a?.poi_count || 0))
    .slice(0, 5)
})

const topRegions = computed(() => {
  if (!Array.isArray(props.vernacularRegions)) return []
  return [...props.vernacularRegions]
    .sort((a, b) => Number(b?.membership?.score || 0) - Number(a?.membership?.score || 0))
    .slice(0, 6)
})

const fuzzyLevelSummary = computed(() => {
  if (!props.fuzzyRegions?.length) return []
  const counts = { core: 0, transition: 0, periphery: 0 }
  props.fuzzyRegions.forEach((fr) => {
    const level = fr.level || fr.membership?.level || 'transition'
    if (counts[level] !== undefined) counts[level] += 1
  })
  return [
    { key: 'core', label: '核心', count: counts.core },
    { key: 'transition', label: '过渡', count: counts.transition },
    { key: 'periphery', label: '边缘', count: counts.periphery }
  ].filter((item) => item.count > 0)
})

const confidenceModel = computed(() => {
  const extractModel = (item) => item?.confidence_explain?.model || item?.confidenceExplain?.model || null
  const pools = [
    ...(Array.isArray(props.clusters?.hotspots) ? props.clusters.hotspots : []),
    ...(Array.isArray(props.vernacularRegions) ? props.vernacularRegions : []),
    ...(Array.isArray(props.fuzzyRegions) ? props.fuzzyRegions : [])
  ]
  for (const item of pools) {
    const model = extractModel(item)
    if (model) return String(model)
  }
  return null
})

const fuzzyBoundaryConfidence = computed(() => {
  if (!Array.isArray(props.fuzzyRegions) || props.fuzzyRegions.length === 0) {
    return { avg: null, count: 0 }
  }
  const values = props.fuzzyRegions
    .map((region) => resolveBoundaryConfidence(region))
    .filter((score) => Number.isFinite(score))
  if (values.length === 0) {
    return { avg: null, count: 0 }
  }
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    avg: Number(avg.toFixed(4)),
    count: values.length
  }
})

function toggleSection(key) {
  expandedSections[key] = !expandedSections[key]
}

function formatHotspotLabel(hotspot) {
  const categories = hotspot?.dominantCategories || hotspot?.dominant_categories
  const category = Array.isArray(categories) && categories[0]?.category ? categories[0].category : '综合'
  return `${category}活力带`
}

function formatHotspotMeta(hotspot) {
  const poiCount = Number(hotspot?.poiCount || hotspot?.poi_count || 0)
  const density = Number(hotspot?.density || 0)
  if (density > 0) {
    return `${poiCount} POI / 密度 ${density.toFixed(2)}`
  }
  return `${poiCount} POI`
}

function formatRegionLabel(region) {
  const raw = region?.name || region?.dominant_category || region?.theme || '区域'
  return String(raw).replace(/区域$/u, '') + '片区'
}

function resolveSemanticAnchorName(entity) {
  const raw = entity?.semantic_anchor?.name || entity?.semanticAnchor?.name || ''
  return String(raw || '').trim()
}

function resolveNicheType(entity) {
  const raw = entity?.niche_profile?.niche_type || entity?.nicheProfile?.nicheType || ''
  return String(raw || '').trim().toLowerCase()
}

function resolveNicheConfidence(entity) {
  const candidates = [entity?.niche_profile?.confidence, entity?.nicheProfile?.confidence]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) {
      if (value < 0) return 0
      if (value > 1) return 1
      return value
    }
  }
  return null
}

function nicheTypeLabel(nicheType) {
  const map = {
    ecology: '生态',
    commerce: '商业',
    education: '科教',
    mixed: '复合'
  }
  return map[nicheType] || nicheType || '复合'
}

function resolveSemanticReasonText(entity) {
  const reasoning = entity?.semantic_reasoning || entity?.semanticReasoning
  const evidence = Array.isArray(reasoning?.evidence) ? reasoning.evidence : []
  if (!evidence.length) return ''

  const typeSet = new Set(
    evidence
      .map((item) => String(item?.type || '').trim())
      .filter(Boolean)
  )

  const parts = []
  if (typeSet.has('anchor')) parts.push('关键词')
  if (typeSet.has('landuse')) parts.push('用地')
  if (typeSet.has('water_context')) parts.push('水域')

  return parts.length ? `约束 ${parts.join('/')}` : ''
}

function formatSemanticSummary(entity) {
  const parts = []
  const anchorName = resolveSemanticAnchorName(entity)
  if (anchorName) {
    parts.push(`锚点 ${anchorName}`)
  }

  const nicheType = resolveNicheType(entity)
  if (nicheType) {
    const nicheConfidence = resolveNicheConfidence(entity)
    if (nicheConfidence === null) {
      parts.push(`生态位 ${nicheTypeLabel(nicheType)}`)
    } else {
      parts.push(`生态位 ${nicheTypeLabel(nicheType)} ${formatConfidencePercent(nicheConfidence)}`)
    }
  }

  const reasonText = resolveSemanticReasonText(entity)
  if (reasonText) {
    parts.push(reasonText)
  }

  return parts.join(' / ')
}

function buildHoverDetail(entity) {
  if (!entity || typeof entity !== 'object') return ''
  const quality = entity.boundary_quality || entity.boundaryQuality || {}
  const generation = entity.boundary_generation || entity.boundaryGeneration || {}
  const parts = []

  const qualityScore = Number(quality.quality_score)
  if (Number.isFinite(qualityScore)) {
    parts.push(`质量 ${formatConfidencePercent(qualityScore)}`)
  }
  const roadAlignment = Number(quality.road_alignment_score)
  if (Number.isFinite(roadAlignment)) {
    parts.push(`路网贴合 ${formatConfidencePercent(roadAlignment)}`)
  }
  const landuseAlignment = Number(quality.landuse_alignment_score)
  if (Number.isFinite(landuseAlignment)) {
    parts.push(`用地贴合 ${formatConfidencePercent(landuseAlignment)}`)
  }

  const refinement = generation.refinement || {}
  if (refinement?.model) {
    const appliedText = refinement.applied ? '已应用' : '未应用'
    parts.push(`后处理 ${appliedText}`)
  }

  return parts.join(' · ')
}

function confidenceClass(score) {
  const value = Number(score)
  if (!Number.isFinite(value)) return 'low'
  if (value >= 0.7) return 'high'
  if (value >= 0.4) return 'medium'
  return 'low'
}

function levelLabel(level) {
  const map = { core: '核心', transition: '过渡', periphery: '边缘' }
  return map[level] || level
}

function resolveBoundaryPayload(entity) {
  if (!entity) return null
  return (
    entity.boundary_geojson ||
    entity.boundary ||
    entity.boundary_ring ||
    entity.layers?.transition?.geojson ||
    entity.layers?.transition?.boundary ||
    entity.layers?.outer?.geojson ||
    entity.layers?.outer?.boundary ||
    null
  )
}

function resolveBoundaryConfidence(entity) {
  if (!entity || typeof entity !== 'object') return null

  const candidates = [
    entity.boundary_confidence,
    entity.boundaryConfidence,
    entity.layers?.transition?.confidence,
    entity.layers?.outer?.confidence
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) {
      if (value < 0) return 0
      if (value > 1) return 1
      return value
    }
  }
  return null
}

function hasBoundaryConfidence(entity) {
  return resolveBoundaryConfidence(entity) !== null
}

function formatConfidencePercent(score) {
  const value = Number(score)
  if (!Number.isFinite(value)) return '--'
  return `${Math.round(value * 100)}%`
}

function handleHotspotClick(hotspot) {
  const boundary = resolveBoundaryPayload(hotspot)
  if (boundary) {
    emit('show-boundary', {
      boundary,
      center: hotspot?.center || null,
      label: formatHotspotLabel(hotspot)
    })
    return
  }

  if (hotspot?.center) {
    emit('locate', hotspot.center)
  }
}

function handleRegionClick(region) {
  const boundary = resolveBoundaryPayload(region)
  if (boundary) {
    emit('show-boundary', {
      boundary,
      center: region?.center || null,
      label: formatRegionLabel(region)
    })
    return
  }

  if (region?.center) {
    emit('locate', region.center)
  }
}

function handleBoundarySectionClick() {
  if (!props.boundary) return
  emit('show-boundary', {
    boundary: props.boundary,
    label: copy.boundary.title
  })
}

function emitFollowup(prompt) {
  if (!prompt) return
  emit('ask-followup', prompt)
}

function askHotspotCause() {
  const top = topHotspots.value[0]
  const label = top ? formatHotspotLabel(top) : '高活力片区'
  emitFollowup(`请解释「${label}」为什么会成为活力热点，并给出 3 个可验证指标。`)
}

function askHotspotOpportunity() {
  const top = topHotspots.value[0]
  const label = top ? formatHotspotLabel(top) : '高活力片区'
  emitFollowup(`围绕「${label}」帮我找 3 个低供给高需求的机会点，说明原因和适合业态。`)
}

function askRegionCompare() {
  const [first, second] = topRegions.value
  const firstName = first ? formatRegionLabel(first) : '片区 A'
  const secondName = second ? formatRegionLabel(second) : '片区 B'
  emitFollowup(`请对比「${firstName}」和「${secondName}」的业态结构差异与潜在风险。`)
}

function askRegionStrategy() {
  const top = topRegions.value[0]
  const name = top ? formatRegionLabel(top) : '主导业态片区'
  emitFollowup(`针对「${name}」输出一份可执行经营策略：目标人群、业态组合、投入优先级。`)
}
</script>

<style scoped>
.spatial-evidence-card {
  margin: 12px 0;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  color: rgba(248, 250, 252, 0.95);
  overflow: hidden;
  font-family: "Inter", "Outfit", "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0.01em;
}

.evidence-section + .evidence-section {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.section-header {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s ease;
}

.section-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.section-header.static {
  cursor: default;
}

.section-header.static:hover {
  background: transparent;
}

.boundary-section .section-header.static {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
}

.section-icon {
  font-size: 16px;
  line-height: 1;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
}

.section-title-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.section-subtitle {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  line-height: 1.4;
}

.section-subtitle.boundary-model {
  color: rgba(56, 189, 248, 0.85);
  font-size: 11px;
}

.toggle-arrow {
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.toggle-arrow.expanded {
  transform: rotate(90deg);
}

.section-body {
  padding: 0 16px 16px;
  display: grid;
  gap: 10px;
}

.section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.mini-action-btn {
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.mini-action-btn:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.mini-action-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(94, 234, 212, 0.82);
  background: rgba(13, 148, 136, 0.28);
}

.hotspot-chip,
.region-chip {
  position: relative;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.03);
  color: inherit;
  text-align: left;
  border-radius: 12px;
  padding: 12px 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  animation: chipFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--stagger, 0) * 45ms);
}

.hotspot-chip:hover,
.region-chip:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.chip-top-line {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.chip-bottom-line {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.chip-rank {
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 3px 6px;
}

.chip-label {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.chip-meta {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.chip-semantic {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 3px 8px;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-confidence,
.chip-boundary-confidence {
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  padding: 3px 8px;
}

.chip-confidence.high,
.chip-boundary-confidence.high {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.chip-confidence.medium,
.chip-boundary-confidence.medium {
  background: rgba(251, 191, 36, 0.24);
  color: #fde68a;
}

.chip-confidence.low,
.chip-boundary-confidence.low {
  background: rgba(239, 68, 68, 0.22);
  color: #fca5a5;
}

.chip-level {
  font-size: 10px;
  color: rgba(226, 232, 240, 0.82);
}

.chip-hover-panel {
  position: absolute;
  right: 10px;
  top: calc(100% + 6px);
  max-width: min(84vw, 320px);
  border-radius: 10px;
  border: 1px solid rgba(45, 212, 191, 0.34);
  background: rgba(2, 44, 34, 0.94);
  color: rgba(204, 251, 241, 0.95);
  font-size: 10px;
  line-height: 1.4;
  padding: 7px 8px;
  z-index: 3;
  opacity: 0;
  transform: translateY(5px);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.hotspot-chip:hover .chip-hover-panel,
.region-chip:hover .chip-hover-panel {
  opacity: 1;
  transform: translateY(0);
}

.fuzzy-summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.fuzzy-level-badge {
  font-size: 11px;
  border-radius: 999px;
  padding: 3px 9px;
}

.fuzzy-level-badge.core {
  background: rgba(20, 184, 166, 0.24);
  color: #99f6e4;
}

.fuzzy-level-badge.transition {
  background: rgba(251, 191, 36, 0.22);
  color: #fde68a;
}

.fuzzy-level-badge.periphery {
  background: rgba(148, 163, 184, 0.22);
  color: #d1d5db;
}

.confidence-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.fuzzy-confidence-badge {
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 4px 10px;
}

.fuzzy-confidence-badge.high {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.fuzzy-confidence-badge.medium {
  background: rgba(251, 191, 36, 0.22);
  color: #fde68a;
}

.fuzzy-confidence-badge.low {
  background: rgba(239, 68, 68, 0.2);
  color: #fda4af;
}

.confidence-model-note {
  font-size: 10px;
  color: rgba(186, 230, 253, 0.86);
}

.boundary-btn {
  border: 1px solid rgba(34, 211, 238, 0.56);
  background: rgba(6, 182, 212, 0.2);
  color: rgba(224, 242, 254, 0.98);
  font-size: 11px;
  border-radius: 999px;
  padding: 4px 11px;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.boundary-btn:hover {
  background: rgba(6, 182, 212, 0.34);
  border-color: rgba(103, 232, 249, 0.88);
}

@media (max-width: 640px) {
  .spatial-evidence-card {
    border-radius: 12px;
  }

  .section-header {
    padding: 9px 10px;
  }

  .section-body {
    padding: 7px 8px 10px;
  }

  .boundary-section .section-header.static {
    grid-template-columns: auto minmax(0, 1fr);
    row-gap: 6px;
  }

  .boundary-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@keyframes chipFadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
