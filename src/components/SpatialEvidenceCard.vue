<template>
  <section v-if="hasEvidence" class="evidence-board">
    <header class="board-head">
      <div>
        <p class="board-kicker">空间证据聚合</p>
        <h3 class="board-title">意图驱动组件</h3>
      </div>
      <span class="board-intent">{{ intentLabel }}</span>
    </header>

    <div class="template-grid">
      <article
        v-for="widget in selectedWidgets"
        :key="widget.key"
        class="template-card"
      >
        <div class="template-head">
          <span class="template-icon">{{ widget.icon }}</span>
          <div class="template-title-wrap">
            <h4 class="template-title">{{ widget.title }}</h4>
            <p class="template-subtitle">{{ widget.subtitle }}</p>
          </div>
        </div>

        <ul class="template-list">
          <li
            v-for="(line, lineIndex) in widget.lines"
            :key="`${widget.key}-line-${lineIndex}`"
            class="template-line"
          >
            {{ line }}
          </li>
        </ul>

        <div v-if="widget.actions.length" class="template-actions">
          <button
            v-for="action in widget.actions"
            :key="`${widget.key}-${action.label}`"
            type="button"
            class="template-action"
            @click="runAction(action)"
          >
            {{ action.label }}
          </button>
        </div>
      </article>
    </div>

    <details v-if="detailRows.length" class="detail-panel">
      <summary>查看详细片区列表</summary>
      <div class="detail-list">
        <button
          v-for="item in detailRows"
          :key="item.key"
          type="button"
          class="detail-row"
          @click="handleLocate(item.center)"
        >
          <span class="detail-rank">{{ item.rank }}</span>
          <span class="detail-name">{{ item.name }}</span>
          <span class="detail-metric">{{ item.metric }}</span>
        </button>
      </div>
    </details>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  clusters: { type: Object, default: null },
  vernacularRegions: { type: Array, default: null },
  fuzzyRegions: { type: Array, default: null },
  analysisStats: { type: Object, default: null },
  intentMode: { type: String, default: 'macro_overview' },
  queryType: { type: String, default: 'area_analysis' }
})

const emit = defineEmits(['locate', 'ask-followup'])

const topHotspots = computed(() => {
  const hotspots = Array.isArray(props.clusters?.hotspots) ? props.clusters.hotspots : []
  return [...hotspots]
    .sort((a, b) => Number(b?.poiCount || b?.poi_count || 0) - Number(a?.poiCount || a?.poi_count || 0))
    .slice(0, 6)
})

const topRegions = computed(() => {
  const regions = Array.isArray(props.vernacularRegions) ? props.vernacularRegions : []
  return [...regions]
    .sort((a, b) => Number(b?.membership?.score || 0) - Number(a?.membership?.score || 0))
    .slice(0, 6)
})

const topFuzzyRegions = computed(() => {
  const regions = Array.isArray(props.fuzzyRegions) ? props.fuzzyRegions : []
  return [...regions]
    .sort((a, b) => Number(b?.score ?? b?.membership?.score ?? 0) - Number(a?.score ?? a?.membership?.score ?? 0))
    .slice(0, 6)
})

const fuzzyLevelSummary = computed(() => {
  const counter = { core: 0, transition: 0, periphery: 0 }
  topFuzzyRegions.value.forEach((item) => {
    const level = String(item?.level || item?.membership?.level || 'transition')
    if (counter[level] !== undefined) counter[level] += 1
  })
  return counter
})

const derivedBoundaryConfidence = computed(() => {
  const fromStats = Number(props.analysisStats?.avg_boundary_confidence)
  if (Number.isFinite(fromStats)) return clamp01(fromStats)

  const values = [
    ...topHotspots.value.map((item) => resolveBoundaryConfidence(item)),
    ...topRegions.value.map((item) => resolveBoundaryConfidence(item)),
    ...topFuzzyRegions.value.map((item) => resolveBoundaryConfidence(item))
  ].filter((value) => Number.isFinite(value))

  if (!values.length) return null
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length)
})

const intentType = computed(() => {
  const merged = `${props.intentMode || ''}|${props.queryType || ''}`.toLowerCase()
  if (merged.includes('comparison') || merged.includes('region_comparison')) return 'comparison'
  if (merged.includes('local_search') || merged.includes('poi_search') || merged.includes('micro')) return 'micro'
  return 'macro'
})

const intentLabel = computed(() => {
  if (intentType.value === 'comparison') return '对比意图'
  if (intentType.value === 'micro') return '微观意图'
  return '宏观意图'
})

const widgetPriority = {
  macro: {
    hotspot_overview: 100,
    industry_pattern: 90,
    confidence_watch: 82,
    opportunity_window: 74,
    fuzzy_risk: 68,
    comparison_digest: 60
  },
  micro: {
    opportunity_window: 100,
    confidence_watch: 94,
    hotspot_overview: 88,
    fuzzy_risk: 84,
    industry_pattern: 70,
    comparison_digest: 58
  },
  comparison: {
    comparison_digest: 100,
    confidence_watch: 92,
    fuzzy_risk: 88,
    industry_pattern: 82,
    hotspot_overview: 76,
    opportunity_window: 66
  }
}

const selectedWidgets = computed(() => {
  const widgets = buildWidgets()
    .filter((widget) => widget.available)
    .map((widget) => ({
      ...widget,
      priority: (widgetPriority[intentType.value] || {})[widget.key] || 50
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
  return widgets
})

const detailRows = computed(() => {
  const rows = []

  topHotspots.value.slice(0, 3).forEach((item, index) => {
    rows.push({
      key: `hotspot-${index}`,
      rank: `热区 #${index + 1}`,
      name: formatHotspotLabel(item),
      metric: `${Number(item?.poiCount || item?.poi_count || 0)} POI`,
      center: item?.center
    })
  })

  topRegions.value.slice(0, 3).forEach((item, index) => {
    rows.push({
      key: `region-${index}`,
      rank: `业态 #${index + 1}`,
      name: formatRegionLabel(item),
      metric: `隶属度 ${formatPercent(item?.membership?.score)}`,
      center: item?.center
    })
  })

  topFuzzyRegions.value.slice(0, 2).forEach((item, index) => {
    rows.push({
      key: `fuzzy-${index}`,
      rank: `边界 #${index + 1}`,
      name: formatFuzzyLabel(item),
      metric: `歧义 ${formatPercent(item?.ambiguity?.score)}`,
      center: item?.center
    })
  })

  return rows
})

const hasEvidence = computed(() => {
  return topHotspots.value.length > 0 || topRegions.value.length > 0 || topFuzzyRegions.value.length > 0
})

function buildWidgets() {
  const bestHotspot = topHotspots.value[0]
  const bestRegion = topRegions.value[0]
  const firstFuzzy = topFuzzyRegions.value[0]
  const secondRegion = topRegions.value[1]
  const secondHotspot = topHotspots.value[1]

  const hotspotWidget = {
    key: 'hotspot_overview',
    icon: '🔥',
    title: '高活力片区',
    subtitle: '识别人流与业态聚集中心',
    available: topHotspots.value.length > 0,
    lines: topHotspots.value.slice(0, 3).map((item, index) => {
      const poiCount = Number(item?.poiCount || item?.poi_count || 0)
      return `${index + 1}. ${formatHotspotLabel(item)} · ${poiCount} POI`
    }),
    actions: [
      { type: 'locate', label: '定位最高活力', payload: bestHotspot?.center },
      { type: 'followup', label: '追问热区成因', payload: buildHotspotFollowup(bestHotspot) }
    ]
  }

  const industryWidget = {
    key: 'industry_pattern',
    icon: '🧭',
    title: '主导业态片区',
    subtitle: '主导类别与空间连续性',
    available: topRegions.value.length > 0,
    lines: topRegions.value.slice(0, 3).map((item, index) => {
      return `${index + 1}. ${formatRegionLabel(item)} · 隶属度 ${formatPercent(item?.membership?.score)}`
    }),
    actions: [
      { type: 'locate', label: '定位主导业态', payload: bestRegion?.center },
      { type: 'followup', label: '生成经营策略', payload: buildStrategyFollowup(bestRegion) }
    ]
  }

  const fuzzyWidget = {
    key: 'fuzzy_risk',
    icon: '🫧',
    title: '渐变边界风险',
    subtitle: '核心/过渡/边缘层级诊断',
    available: topFuzzyRegions.value.length > 0,
    lines: [
      `核心 ${fuzzyLevelSummary.value.core} · 过渡 ${fuzzyLevelSummary.value.transition} · 边缘 ${fuzzyLevelSummary.value.periphery}`,
      firstFuzzy ? `首要风险片区：${formatFuzzyLabel(firstFuzzy)}` : '暂无模糊片区风险',
      firstFuzzy ? `歧义得分：${formatPercent(firstFuzzy?.ambiguity?.score)}` : '歧义得分：--'
    ],
    actions: [
      { type: 'locate', label: '定位风险片区', payload: firstFuzzy?.center },
      { type: 'followup', label: '追问边界不确定性', payload: buildFuzzyFollowup(firstFuzzy) }
    ]
  }

  const confidenceWidget = {
    key: 'confidence_watch',
    icon: '📈',
    title: '可信度看板',
    subtitle: '边界质量与模型稳定性',
    available: derivedBoundaryConfidence.value !== null,
    lines: [
      `边界平均可信度：${formatPercent(derivedBoundaryConfidence.value)}`,
      `模型：${props.analysisStats?.boundary_confidence_model || 'composite_v5'}`,
      `聚合片区数：${Number(props.analysisStats?.cluster_count || topRegions.value.length || 0)}`
    ],
    actions: []
  }

  const opportunityWidget = {
    key: 'opportunity_window',
    icon: '💡',
    title: '机会窗口',
    subtitle: '组合热区与业态给出落点建议',
    available: Boolean(bestHotspot || bestRegion),
    lines: [
      bestHotspot ? `优先观察：${formatHotspotLabel(bestHotspot)}` : '缺少活力热区数据',
      bestRegion ? `业态切入：${formatRegionLabel(bestRegion)}` : '缺少主导业态数据',
      `建议动作：${intentType.value === 'micro' ? '先做单点验证，再扩张覆盖' : '先做分层选址，再做业态组合'}`
    ],
    actions: [
      { type: 'followup', label: '输出机会清单', payload: buildOpportunityFollowup(bestHotspot, bestRegion) }
    ]
  }

  const comparisonWidget = {
    key: 'comparison_digest',
    icon: '⚖️',
    title: '结构对比摘要',
    subtitle: '快速比较两个候选片区差异',
    available: Boolean((bestRegion && secondRegion) || (bestHotspot && secondHotspot)),
    lines: buildComparisonLines(bestRegion, secondRegion, bestHotspot, secondHotspot),
    actions: [
      { type: 'followup', label: '展开差异解读', payload: buildComparisonFollowup(bestRegion, secondRegion, bestHotspot, secondHotspot) }
    ]
  }

  return [hotspotWidget, industryWidget, fuzzyWidget, confidenceWidget, opportunityWidget, comparisonWidget]
}

function runAction(action) {
  if (!action || !action.type) return
  if (action.type === 'locate') {
    handleLocate(action.payload)
    return
  }
  if (action.type === 'followup' && action.payload) {
    emit('ask-followup', action.payload)
  }
}

function handleLocate(center) {
  if (!center) return
  emit('locate', center)
}

function formatHotspotLabel(item) {
  const category = item?.dominantCategories?.[0]?.category || item?.dominant_categories?.[0]?.category || '综合业态'
  return `${category}活力区`
}

function formatRegionLabel(item) {
  const raw = String(item?.name || item?.dominant_category || item?.theme || '片区')
  return raw.replace(/片区$/u, '') + '片区'
}

function formatFuzzyLabel(item) {
  return String(item?.hierarchy?.micro_name || item?.name || item?.theme || '模糊片区')
}

function formatPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  return `${Math.round(clamp01(numeric) * 100)}%`
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function resolveBoundaryConfidence(entity) {
  const candidates = [
    entity?.boundary_confidence,
    entity?.boundaryConfidence,
    entity?.layers?.core?.confidence,
    entity?.layers?.transition?.confidence,
    entity?.layers?.outer?.confidence
  ]
  for (const candidate of candidates) {
    const score = Number(candidate)
    if (Number.isFinite(score)) return clamp01(score)
  }
  return null
}

function buildHotspotFollowup(item) {
  if (!item) return '请解释当前片区形成高活力的关键原因，并给出可验证指标。'
  return `请解释「${formatHotspotLabel(item)}」形成高活力的原因，并给出3个可验证指标。`
}

function buildStrategyFollowup(item) {
  if (!item) return '请给出当前片区的经营策略：目标客群、业态组合与投入优先级。'
  return `请围绕「${formatRegionLabel(item)}」输出经营策略：目标客群、业态组合、投入优先级。`
}

function buildFuzzyFollowup(item) {
  if (!item) return '请解释当前模糊边界风险的来源，并给出降低不确定性的办法。'
  return `请解释「${formatFuzzyLabel(item)}」边界不确定性的来源，并给出降低风险的办法。`
}

function buildOpportunityFollowup(hotspot, region) {
  const hotspotText = hotspot ? formatHotspotLabel(hotspot) : '高活力片区'
  const regionText = region ? formatRegionLabel(region) : '主导业态片区'
  return `请基于「${hotspotText}」与「${regionText}」输出3个可执行机会点，并说明适配业态。`
}

function buildComparisonLines(regionA, regionB, hotspotA, hotspotB) {
  if (regionA && regionB) {
    return [
      `业态对比：${formatRegionLabel(regionA)} vs ${formatRegionLabel(regionB)}`,
      `隶属度：${formatPercent(regionA?.membership?.score)} vs ${formatPercent(regionB?.membership?.score)}`,
      '建议：对比客群结构、坪效与竞争密度'
    ]
  }

  return [
    `活力对比：${formatHotspotLabel(hotspotA)} vs ${formatHotspotLabel(hotspotB)}`,
    `${Number(hotspotA?.poiCount || hotspotA?.poi_count || 0)} POI vs ${Number(hotspotB?.poiCount || hotspotB?.poi_count || 0)} POI`,
    '建议：核验时间分布、客流峰谷与业态互补'
  ]
}

function buildComparisonFollowup(regionA, regionB, hotspotA, hotspotB) {
  if (regionA && regionB) {
    return `请对比「${formatRegionLabel(regionA)}」与「${formatRegionLabel(regionB)}」的结构差异、风险和策略。`
  }
  if (hotspotA && hotspotB) {
    return `请对比「${formatHotspotLabel(hotspotA)}」与「${formatHotspotLabel(hotspotB)}」的活力结构与商业机会。`
  }
<<<<<<< HEAD
  return '请给出两个片区的差异化运营策略。'
=======
}

function emitFollowup(prompt) {
  if (!prompt) return
  emit('ask-followup', prompt)
}

function askHotspotCause() {
  const top = topHotspots.value[0]
  const label = top ? formatHotspotLabel(top) : '߻Ƭ'
  emitFollowup(`请解释「${label}」为什么会成为活力热点，并给出 3 个可验证指标。`)
}

function askHotspotOpportunity() {
  const top = topHotspots.value[0]
  const label = top ? formatHotspotLabel(top) : '߻Ƭ'
  emitFollowup(`Χơ${label} 3 ͹Ļ㣬˵ԭʺҵ̬`)
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
>>>>>>> 2152efd (优化前端性能，checkpoint v5)
}
</script>

<style scoped>
.evidence-board {
  margin: 12px 0;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.88), rgba(7, 18, 40, 0.92));
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.board-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(120deg, rgba(15, 23, 42, 0.52), rgba(2, 132, 199, 0.08));
}

.board-kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(125, 211, 252, 0.86);
}

.board-title {
  margin: 4px 0 0;
  font-size: 16px;
  color: #f8fafc;
}

.board-intent {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(2, 132, 199, 0.18);
  color: #dbeafe;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.template-grid {
  padding: 14px;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.template-card {
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.76), rgba(15, 23, 42, 0.5));
  padding: 12px;
  display: grid;
  gap: 10px;
}

.template-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.template-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(14, 116, 144, 0.25);
  border: 1px solid rgba(34, 211, 238, 0.3);
}

.template-title-wrap {
  min-width: 0;
}

.template-title {
  margin: 0;
  font-size: 14px;
  color: #f8fafc;
}

.template-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: rgba(203, 213, 225, 0.72);
  line-height: 1.4;
}

.template-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}

.template-line {
  font-size: 12px;
  color: rgba(226, 232, 240, 0.9);
  line-height: 1.45;
}

.template-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.template-action {
  border: 1px solid rgba(125, 211, 252, 0.32);
  border-radius: 999px;
  background: rgba(14, 116, 144, 0.16);
  color: #e0f2fe;
  font-size: 11px;
  padding: 5px 10px;
  cursor: pointer;
}

.template-action:hover {
  background: rgba(14, 116, 144, 0.3);
  border-color: rgba(56, 189, 248, 0.5);
}

.detail-panel {
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  padding: 10px 14px 14px;
}

.detail-panel > summary {
  cursor: pointer;
  color: rgba(186, 230, 253, 0.92);
  font-size: 12px;
  font-weight: 600;
}

.detail-list {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.detail-row {
  width: 100%;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.5);
  color: rgba(226, 232, 240, 0.94);
  font-size: 12px;
  padding: 8px 10px;
  cursor: pointer;
}

.detail-row:hover {
  border-color: rgba(56, 189, 248, 0.42);
}

.detail-rank {
  color: rgba(125, 211, 252, 0.92);
  font-weight: 700;
}

.detail-name {
  text-align: left;
}

.detail-metric {
  color: rgba(203, 213, 225, 0.72);
}
</style>
