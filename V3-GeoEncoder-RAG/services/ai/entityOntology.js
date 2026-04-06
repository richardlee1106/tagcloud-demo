const ENTITY_CONCEPTS = Object.freeze({
  '咖啡': {
    dbCategory: '餐饮美食',
    aliases: ['咖啡', '咖啡店', '咖啡馆', '咖啡厅', 'coffee', 'cafe'],
    brands: ['星巴克', '瑞幸', 'luckin', 'costa', 'manner', 'm stand', 'mstand', '库迪', '幸运咖'],
    parents: ['餐饮美食']
  },
  '火锅': {
    dbCategory: '餐饮美食',
    aliases: ['火锅', '毛肚火锅', '牛油火锅', '串串香', '串串', '涮锅'],
    brands: ['海底捞', '巴奴', '小龙坎', '呷哺呷哺', '蜀大侠', '楠火锅', '谭鸭血', '朱光玉火锅馆'],
    parents: ['中餐', '餐饮美食']
  },
  '面馆': {
    dbCategory: '餐饮美食',
    aliases: ['面馆', '面食', '面条', '拉面', '牛肉面', '热干面', '刀削面', '拌面', '汤面', '面店'],
    brands: ['蔡林记', '和府捞面', '味千拉面', '遇见小面', '陈香贵'],
    parents: ['中餐', '餐饮美食']
  },
  '小吃': {
    dbCategory: '餐饮美食',
    aliases: ['小吃', '小吃店', '小吃城', '烧烤', '炸串', '麻辣烫', '包子', '饺子', '锅贴', '卤味', '煎饼'],
    brands: ['绝味鸭脖', '周黑鸭', '紫燕百味鸡'],
    parents: ['中餐', '餐饮美食']
  },
  '中餐': {
    dbCategory: '餐饮美食',
    aliases: ['中餐', '中国菜', '川菜', '湘菜', '粤菜', '本帮菜', '家常菜', '私房菜', '徽菜', '鲁菜', '东北菜'],
    brands: ['外婆家', '绿茶餐厅', '老乡鸡', '真功夫', '小菜园', '乡村基'],
    parents: ['餐饮美食']
  },
  '西餐': {
    dbCategory: '餐饮美食',
    aliases: ['西餐', '西式', '牛排', '披萨', '意面', '汉堡', 'brunch', 'western'],
    brands: ['麦当劳', '肯德基', 'kfc', '必胜客', '汉堡王', '萨莉亚', '棒约翰', '赛百味'],
    parents: ['餐饮美食']
  },
  '商超': {
    dbCategory: '购物服务',
    aliases: ['商超', '超市', '便利店', '商场', '购物中心', '百货', '生鲜超市', '仓储会员店', '卖场'],
    brands: ['中百仓储', '中百罗森', '武商', '沃尔玛', '山姆', '盒马', '永辉', 'today', 'today便利店', '罗森', '7-eleven', '7eleven', '全家'],
    parents: ['购物服务']
  },
  '地铁站': {
    dbCategory: '交通设施服务',
    aliases: ['地铁站', '地铁口', '地铁', '轨道交通', '轻轨', '地铁出入口'],
    brands: [],
    parents: ['交通设施服务']
  },
  '公交车站': {
    dbCategory: '交通设施服务',
    aliases: ['公交车站', '公交站', '巴士站', '公交', 'brt'],
    brands: [],
    parents: ['交通设施服务']
  },
  '医院': {
    dbCategory: '医疗保健服务',
    aliases: ['医院', '门诊', '卫生院', '诊所', '医疗中心', '妇幼', '急救中心', '中医院'],
    brands: ['协和医院', '同济医院', '人民医院', '中南医院', '省妇幼', '儿童医院', '口腔医院'],
    parents: ['医疗保健服务']
  }
})

const CONCEPT_ORDER = Object.keys(ENTITY_CONCEPTS)

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[()（）[\]【】·\-—_.,，。:：;；'"“”‘’\s]/g, '')
}

function buildHierarchy(concept, bucket = new Set()) {
  if (!concept || bucket.has(concept)) return bucket
  bucket.add(concept)
  const def = ENTITY_CONCEPTS[concept]
  for (const parent of def?.parents || []) {
    buildHierarchy(parent, bucket)
  }
  return bucket
}

function scoreSingleMatch(normalizedText, rawText, term, weight = 1) {
  const normalizedTerm = normalizeText(term)
  if (!normalizedText || !normalizedTerm) return 0
  if (normalizedText === normalizedTerm) return 1.2 * weight
  if (normalizedText.includes(normalizedTerm)) {
    const ratio = Math.min(1, normalizedTerm.length / Math.max(normalizedText.length, normalizedTerm.length))
    return (0.72 + ratio * 0.28) * weight
  }
  if (String(rawText || '').toLowerCase().includes(String(term || '').toLowerCase())) {
    return 0.68 * weight
  }
  return 0
}

function collectConceptMatchesFromText(text = '', source = 'name') {
  const normalizedText = normalizeText(text)
  const rawText = String(text || '')
  if (!normalizedText) return []

  const matches = []
  for (const concept of CONCEPT_ORDER) {
    const def = ENTITY_CONCEPTS[concept]
    let bestScore = 0
    let matchSource = null

    for (const brand of def.brands || []) {
      const score = scoreSingleMatch(normalizedText, rawText, brand, 1.0)
      if (score > bestScore) {
        bestScore = score
        matchSource = `${source}:brand`
      }
    }

    for (const alias of def.aliases || []) {
      const score = scoreSingleMatch(normalizedText, rawText, alias, 0.9)
      if (score > bestScore) {
        bestScore = score
        matchSource = `${source}:alias`
      }
    }

    if (bestScore > 0) {
      matches.push({
        concept,
        score: Number(bestScore.toFixed(4)),
        source: matchSource || source
      })
    }
  }

  matches.sort((left, right) => right.score - left.score)
  return matches
}

function dedupeMatches(matches = []) {
  const bestByConcept = new Map()
  for (const match of matches) {
    const current = bestByConcept.get(match.concept)
    if (!current || match.score > current.score) {
      bestByConcept.set(match.concept, match)
    }
  }
  return [...bestByConcept.values()].sort((left, right) => right.score - left.score)
}

export function inferSemanticConceptMatches(text = '', { includeParents = true, source = 'name' } = {}) {
  const directMatches = collectConceptMatchesFromText(text, source)
  if (!includeParents || directMatches.length === 0) {
    return dedupeMatches(directMatches)
  }

  const expandedMatches = [...directMatches]
  for (const match of directMatches) {
    const hierarchy = [...buildHierarchy(match.concept)]
    for (const parentConcept of hierarchy) {
      if (parentConcept === match.concept) continue
      expandedMatches.push({
        concept: parentConcept,
        score: Number((match.score * 0.72).toFixed(4)),
        source: `${match.source}:parent`
      })
    }
  }

  return dedupeMatches(expandedMatches)
}

export function resolveEntityIntentFromText(text = '') {
  const matches = inferSemanticConceptMatches(text, { includeParents: true, source: 'query' })
  const primary = matches[0]?.concept || null
  return {
    primaryConcept: primary,
    dbCategory: primary ? ENTITY_CONCEPTS[primary]?.dbCategory || null : null,
    poiSubType: primary,
    concepts: matches.map((item) => item.concept),
    matches
  }
}

export function inferCandidateEntitySemantics(candidate = {}) {
  const nameMatches = inferSemanticConceptMatches(candidate?.name || '', {
    includeParents: true,
    source: 'candidate_name'
  })
  const categoryText = [
    candidate?.category,
    candidate?.categoryMain,
    candidate?.categorySub,
    candidate?.category_big,
    candidate?.category_mid,
    candidate?.category_small,
    candidate?.type
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')

  const categoryMatches = nameMatches.length > 0
    ? []
    : inferSemanticConceptMatches(categoryText, {
        includeParents: true,
        source: 'category_fallback'
      })

  const matches = dedupeMatches([...nameMatches, ...categoryMatches])

  return {
    primaryConcept: matches[0]?.concept || null,
    concepts: matches.map((item) => item.concept),
    matches
  }
}

export function candidateMatchesSemanticSubtype(candidate = {}, subcategory = null) {
  const requested = String(subcategory || '').trim()
  if (!requested) {
    return {
      matched: true,
      score: 0,
      source: null,
      concepts: []
    }
  }

  const requestedIntent = resolveEntityIntentFromText(requested)
  const candidateIntent = inferCandidateEntitySemantics(candidate)
  const candidateConcepts = new Set(candidateIntent.concepts)

  if (candidateConcepts.has(requested) || candidateConcepts.has(requestedIntent.primaryConcept)) {
    const bestMatch = candidateIntent.matches.find((item) => (
      item.concept === requested || item.concept === requestedIntent.primaryConcept
    ))
    return {
      matched: true,
      score: bestMatch?.score || 0.8,
      source: bestMatch?.source || 'semantic_concept',
      concepts: candidateIntent.concepts
    }
  }

  return {
    matched: false,
    score: 0,
    source: null,
    concepts: candidateIntent.concepts
  }
}

export function getEntityConceptDefinition(concept = '') {
  return ENTITY_CONCEPTS[concept] || null
}

export default {
  ENTITY_CONCEPTS,
  candidateMatchesSemanticSubtype,
  getEntityConceptDefinition,
  inferCandidateEntitySemantics,
  inferSemanticConceptMatches,
  resolveEntityIntentFromText
}
