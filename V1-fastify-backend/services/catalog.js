import db from './database.js'

function toSafeLabel(value) {
  const text = String(value || '').trim()
  return text || '未分类'
}

function sortNodes(nodes = []) {
  nodes.sort((a, b) => {
    if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0)
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hans-CN')
  })

  nodes.forEach((node) => {
    if (Array.isArray(node.children)) {
      sortNodes(node.children)
    }
  })

  return nodes
}

export function buildCategoryTree(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const bigMap = new Map()

  rows.forEach((row) => {
    const big = toSafeLabel(row.big)
    const mid = toSafeLabel(row.mid)
    const small = toSafeLabel(row.small)
    const count = Math.max(0, Number(row.count) || 0)

    let bigNode = bigMap.get(big)
    if (!bigNode) {
      bigNode = {
        value: big,
        label: big,
        count: 0,
        children: [],
        _midMap: new Map()
      }
      bigMap.set(big, bigNode)
    }
    bigNode.count += count

    let midNode = bigNode._midMap.get(mid)
    if (!midNode) {
      midNode = {
        value: mid,
        label: mid,
        count: 0,
        children: [],
        _smallSet: new Set()
      }
      bigNode._midMap.set(mid, midNode)
      bigNode.children.push(midNode)
    }
    midNode.count += count

    if (!midNode._smallSet.has(small)) {
      midNode._smallSet.add(small)
      midNode.children.push({
        value: small,
        label: small,
        count
      })
      return
    }

    const existingSmall = midNode.children.find((item) => item.value === small)
    if (existingSmall) {
      existingSmall.count += count
    }
  })

  const tree = Array.from(bigMap.values()).map((bigNode) => {
    const nextBig = {
      value: bigNode.value,
      label: bigNode.label,
      count: bigNode.count,
      children: bigNode.children.map((midNode) => ({
        value: midNode.value,
        label: midNode.label,
        count: midNode.count,
        children: midNode.children.map((smallNode) => ({
          value: smallNode.value,
          label: smallNode.label,
          count: smallNode.count
        }))
      }))
    }

    return nextBig
  })

  return sortNodes(tree)
}

/**
 * 从数据库动态生成分类树
 * 以 public.pois 为唯一事实来源，不再回退旧静态 split_data catalog。
 * @returns {Promise<Array>}
 */
export async function getCategoryTreeFromDB() {
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(category_main), ''), '未分类') AS big,
      COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类')) AS mid,
      COALESCE(NULLIF(TRIM(brand_category), ''), COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类'))) AS small,
      COUNT(*)::int AS count
    FROM public.pois
    GROUP BY 1, 2, 3
    ORDER BY big, mid, small
  `

  try {
    const result = await db.query(sql)
    return buildCategoryTree(result.rows)
  } catch (err) {
    console.error('Failed to generate category tree from DB:', err)
    throw err
  }
}

export default {
  buildCategoryTree,
  getCategoryTreeFromDB
}
