/**
 * 类别本体模块 (Category Ontology)
 * 
 * 功能：
 * 1. 提供标准化的 POI 类别层级结构
 * 2. 支持同义词扩展（用户表达 → 标准类别）
 * 3. ֧ųʣƥ䣩
 * 4. 提供精确的类别匹配，减少 ILIKE 模糊搜索的噪音
 * 
 * Phase 1 优化项之一
 */

/**
 * 类别本体定义
 * 
 * 结构说明：
 * - key: 标准类别名称（用于数据库查询）
 * - children: 子类别列表
 * - synonyms: 用户可能使用的同义词/口语表达
 * - exclude: Ӧųƥʣ"ɫҾ"Ӧƥ""
 * - keywords: 用于意图检测的关键词
 */
export const CATEGORY_ONTOLOGY = {
  // ========== ʳ ==========
  '餐饮': {
    children: ['в', '', '', '', '', 'տ', '', 'С', 'Ʒ', '', '̲', 'ư'],
    synonyms: ['Ե', 'ʳ', '', '', 'Է', 'óԵ', 'ζ', 'ʳ', '', '¹'],
    exclude: ['ʳƷӹ', ';', '', 'ʳƷ', 'ʳƷе'],
    keywords: ['', '', '', 'ʳ', 'ó']
  },
  '中餐': {
    children: ['川菜', '湘菜', '粤菜', '鲁菜', '东北菜', '江浙菜', '本帮菜', '清真'],
    synonyms: ['中餐厅', '中式餐厅', '中国菜', '炒菜'],
    exclude: [],
    keywords: ['中餐', '炒菜']
  },
  '咖啡': {
    children: ['咖啡厅', '咖啡馆', '咖啡店'],
    synonyms: ['咖啡', 'coffee', '星巴克', '瑞幸', '喝咖啡'],
    exclude: ['咖啡色', '咖啡机', '咖啡豆批发', '咖啡设备'],
    keywords: ['咖啡', 'coffee']
  },
  '奶茶': {
    children: ['奶茶店', '茶饮', '饮品店'],
    synonyms: ['̲', 'ϲ', 'ѩ', 'ٵ', 'ѩ', 'һ', 'ɫ', ''],
    exclude: ['奶茶粉', '奶茶原料'],
    keywords: ['奶茶', '茶饮', '饮品']
  },
  '火锅': {
    children: ['ζ', '', 'ţ', 'ͭ', ''],
    synonyms: ['火锅', '涮锅', '涮肉', '海底捞'],
    exclude: ['火锅底料', '火锅设备'],
    keywords: ['火锅', '涮']
  },

  // ========== 购物商业 ==========
  '购物': {
    children: ['商场', '超市', '便利店', '百货', '专卖店', '市场'],
    synonyms: ['买东西', '购物', '逛街', '商业', '商店', '店'],
    exclude: ['购物车', '购物袋'],
    keywords: ['买', '购物', '逛', '商场']
  },
  '商场': {
    children: ['购物中心', '大型商场', 'Shopping Mall'],
    synonyms: ['购物中心', '商业中心', '广场', '万达', 'SKP', '大悦城', '万象城'],
    exclude: ['商场管理', '商场物业'],
    keywords: ['商场', '购物中心']
  },
  '超市': {
    children: ['大型超市', '社区超市', '生鲜超市'],
    synonyms: ['超市', '卖场', '沃尔玛', '家乐福', '永辉', '盒马', '山姆'],
    exclude: ['超市货架', '超市设备'],
    keywords: ['超市']
  },
  '便利店': {
    children: ['24小时便利店', '社区便利店'],
    synonyms: ['便利店', '小卖部', '杂货店', '全家', '711', '罗森', '便利蜂'],
    exclude: [],
    keywords: ['便利店', '小卖部']
  },

  // ========== 交通出行 ==========
  '交通': {
    children: ['地铁站', '公交站', '火车站', '机场', '汽车站', '停车场', '加油站', '充电站'],
    synonyms: ['交通', '出行', '通勤', '坐车', '去哪'],
    exclude: ['ͨ', 'ͨѧ', 'ְͨҵ'],
    keywords: ['交通', '出行', '坐', '怎么去']
  },
  '地铁站': {
    children: ['', 'ͨ', ''],
    synonyms: ['地铁', '地铁站', '轨交', '城轨'],
    exclude: ['', ''],
    keywords: ['地铁']
  },
  '停车场': {
    children: ['地下停车场', '地面停车场', '立体停车场'],
    synonyms: ['停车', '停车场', '泊车', '车位'],
    exclude: ['停车系统', '停车设备'],
    keywords: ['停车', '泊车', '车位']
  },

  // ========== 教育培训 ==========
  '教育': {
    children: ['学校', '幼儿园', '小学', '中学', '高中', '大学', '培训机构', '图书馆'],
    synonyms: ['教育', '上学', '学习', '培训', '读书'],
    exclude: ['教育局', '教育出版'],
    keywords: ['学', '教育', '培训', '上学']
  },
  '学校': {
    children: ['小学', '中学', '高中', '职业学校'],
    synonyms: ['ѧУ', 'ѧԺ', '', 'С', 'ʵѧУ'],
    exclude: ['学校路', '学校街'],
    keywords: ['学校', '学院']
  },
  '培训机构': {
    children: ['语言培训', '艺术培训', 'IT培训', '职业培训', '早教'],
    synonyms: ['培训', '辅导班', '补习', '课外班', '兴趣班', '新东方', '学而思'],
    exclude: [],
    keywords: ['培训', '辅导', '补习']
  },

  // ========== 医疗健康 ==========
  '医疗': {
    children: ['医院', '诊所', '药店', '卫生院', '社区卫生服务中心', '体检中心'],
    synonyms: ['医疗', '看病', '就医', '看医生', '医'],
    exclude: ['医疗器械', '医疗美容'],
    keywords: ['医', '看病', '就医', '药']
  },
  '医院': {
    children: ['ۺҽԺ', 'רҽԺ', 'ҽԺ', '˽ҽԺ'],
    synonyms: ['ҽԺ', 'ҽ', 'ҽԺ', 'ҽԺ', 'ҽԺ'],
    exclude: ['医院路', '医院街'],
    keywords: ['医院']
  },
  '药店': {
    children: ['连锁药店', '大药房'],
    synonyms: ['药店', '药房', '买药', '大药房', '老百姓大药房', '益丰'],
    exclude: ['药店管理'],
    keywords: ['药店', '药房', '买药']
  },

  // ========== 休闲娱乐 ==========
  '休闲娱乐': {
    children: ['电影院', 'KTV', '游乐场', '网吧', '健身房', '足浴', '棋牌'],
    synonyms: ['', '', '', '', '', 'ǲ', ''],
    exclude: [],
    keywords: ['玩', '娱乐', '休闲', '放松']
  },
  '电影院': {
    children: ['影城', 'IMAX'],
    synonyms: ['电影院', '影院', '看电影', '电影', '万达影城', 'CGV'],
    exclude: ['电影制作', '电影公司'],
    keywords: ['电影', '看电影']
  },
  '健身': {
    children: ['健身房', '游泳馆', '瑜伽馆', '运动场'],
    synonyms: ['健身', '锻炼', '运动', '游泳', '瑜伽', '健身房'],
    exclude: ['健身器材'],
    keywords: ['健身', '锻炼', '运动', '游泳']
  },

  // ========== 住宿酒店 ==========
  '住宿': {
    children: ['Ƶ', '', '', 'Ԣ', ''],
    synonyms: ['住宿', '住', '酒店', '宾馆', '住哪', '过夜'],
    exclude: ['住宿登记', '住宿管理'],
    keywords: ['住', '酒店', '宾馆', '过夜']
  },
  '酒店': {
    children: ['ǼƵ', 'Ƶ', 'ݾƵ', 'ȼپƵ'],
    synonyms: ['Ƶ', '', 'ù', '', 'ͥ', 'ϣ', '', '޼'],
    exclude: ['酒店用品', '酒店管理'],
    keywords: ['酒店', '宾馆']
  },

  // ========== 金融服务 ==========
  '金融': {
    children: ['银行', 'ATM', '证券', '保险', '信贷'],
    synonyms: ['', '', 'ȡǮ', 'ATM', '쿨'],
    exclude: ['金融街', '金融大厦'],
    keywords: ['银行', '取钱', 'ATM']
  },
  '银行': {
    children: ['', 'ҵ', ''],
    synonyms: ['', '', '', 'ũҵ', 'й', '', 'ȡ'],
    exclude: ['银行路', '银行街'],
    keywords: ['银行', '取款', '存款']
  },

  // ========== 生活服务 ==========
  '生活服务': {
    children: ['美容美发', '洗衣店', '快递', '维修', '家政'],
    synonyms: ['生活服务', '服务', '便民'],
    exclude: [],
    keywords: []
  },
  '美容美发': {
    children: ['美容院', '理发店', 'SPA', '美甲'],
    synonyms: ['美容', '美发', '理发', '剪头发', 'Tony老师', '发廊', 'SPA'],
    exclude: ['美容仪', '美容设备'],
    keywords: ['美容', '理发', '剪发', 'SPA']
  }
}

/**
 * 将用户输入规范化到标准类别
 * 
 * @param {string} userInput - 用户输入的类别表达
 * @returns {Object} { standardCategory: string, matchType: 'exact'|'synonym'|'child'|'none' }
 */
export function normalizeCategoryInput(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    return { standardCategory: null, matchType: 'none' }
  }

  const input = userInput.trim().toLowerCase()

  // 1. 精确匹配标准类别
  for (const [stdCat, def] of Object.entries(CATEGORY_ONTOLOGY)) {
    if (stdCat.toLowerCase() === input) {
      return { standardCategory: stdCat, matchType: 'exact' }
    }
  }

  // 2. 匹配同义词
  for (const [stdCat, def] of Object.entries(CATEGORY_ONTOLOGY)) {
    if (def.synonyms?.some(syn => syn.toLowerCase() === input)) {
      return { standardCategory: stdCat, matchType: 'synonym' }
    }
  }

  // 3. 匹配子类别
  for (const [stdCat, def] of Object.entries(CATEGORY_ONTOLOGY)) {
    if (def.children?.some(child => child.toLowerCase() === input)) {
      return { standardCategory: input, matchType: 'child', parentCategory: stdCat }
    }
  }

  // 4. 包含匹配（容错）
  for (const [stdCat, def] of Object.entries(CATEGORY_ONTOLOGY)) {
    if (def.synonyms?.some(syn => input.includes(syn.toLowerCase()) || syn.toLowerCase().includes(input))) {
      return { standardCategory: stdCat, matchType: 'synonym' }
    }
  }

  return { standardCategory: null, matchType: 'none' }
}

/**
 * 从自然语言问题中提取可能的类别
 * 
 * @param {string} question - 用户问题
 * @returns {Array<{category: string, confidence: number}>} 检测到的类别列表
 */
export function extractCategoriesFromQuestion(question) {
  if (!question) return []

  const q = question.toLowerCase()
  const detected = []

  for (const [stdCat, def] of Object.entries(CATEGORY_ONTOLOGY)) {
    let confidence = 0

    // 检查关键词
    if (def.keywords?.some(kw => q.includes(kw.toLowerCase()))) {
      confidence += 0.6
    }

    // 检查同义词
    if (def.synonyms?.some(syn => q.includes(syn.toLowerCase()))) {
      confidence += 0.4
    }

    // 检查排除词（降低置信度）
    if (def.exclude?.some(ex => q.includes(ex.toLowerCase()))) {
      confidence -= 0.5
    }

    if (confidence > 0.3) {
      detected.push({ category: stdCat, confidence: Math.min(confidence, 1) })
    }
  }

  // 按置信度排序
  detected.sort((a, b) => b.confidence - a.confidence)

  return detected
}

/**
 * 获取类别的所有子类别（用于扩展搜索）
 * 
 * @param {string} category - 标准类别
 * @returns {string[]} 该类别及其所有子类别
 */
export function expandCategory(category) {
  const def = CATEGORY_ONTOLOGY[category]
  if (!def) return [category]

  return [category, ...(def.children || [])]
}

/**
 * 检查查询词是否应该被排除
 * 
 * @param {string} category - 类别
 * @param {string} poiName - POI 名称
 * @returns {boolean} 是否应该排除该 POI
 */
export function shouldExcludePOI(category, poiName) {
  const def = CATEGORY_ONTOLOGY[category]
  if (!def || !def.exclude) return false

  const name = poiName.toLowerCase()
  return def.exclude.some(ex => name.includes(ex.toLowerCase()))
}

/**
 * 获取类别的同义词列表（用于扩展搜索）
 * 
 * @param {string} category - 标准类别
 * @returns {string[]} 同义词列表
 */
export function getCategorySynonyms(category) {
  const def = CATEGORY_ONTOLOGY[category]
  return def?.synonyms || []
}

/**
 * Phase 3 优化：类别泛化（向上查找父类别）
 * 
 * ;"Ʒֳ忧"ҲʱԶΪ""""
 * 
 * @param {string} category - 原始类别
 * @returns {Object} { parent: string|null, grandparent: string|null, generalized: string[] }
 */
export function generalizeCategory(category) {
  if (!category) return { parent: null, grandparent: null, generalized: [] }
  
  const catLower = category.toLowerCase()
  const result = {
    original: category,
    parent: null,
    grandparent: null,
    generalized: []
  }
  
  // 1. 查找直接父类别
  for (const [stdCat, def] of Object.entries(CATEGORY_ONTOLOGY)) {
    if (def.children?.some(child => child.toLowerCase() === catLower || child.toLowerCase().includes(catLower))) {
      result.parent = stdCat
      result.generalized.push(stdCat)
      
      // 2. 继续查找祖父类别
      for (const [grandCat, grandDef] of Object.entries(CATEGORY_ONTOLOGY)) {
        if (grandDef.children?.some(child => child.toLowerCase() === stdCat.toLowerCase())) {
          result.grandparent = grandCat
          result.generalized.push(grandCat)
          break
        }
      }
      break
    }
    
    // 也检查同义词匹配
    if (def.synonyms?.some(syn => syn.toLowerCase() === catLower)) {
      // 如果匹配的是子类别的同义词，找到父类别
      for (const [parentCat, parentDef] of Object.entries(CATEGORY_ONTOLOGY)) {
        if (parentDef.children?.includes(stdCat)) {
          result.parent = parentCat
          result.generalized.push(parentCat)
          break
        }
      }
    }
  }
  
  // 3. 如果原始类别就是一级类别，尝试获取更宽泛的替代
  if (!result.parent && CATEGORY_ONTOLOGY[category]) {
    // 已经是一级类别，没有可泛化的父级
    result.generalized = []
  }
  
  // 4. 常见泛化规则（兜底）
  const FALLBACK_GENERALIZATIONS = {
    '': ['в', ''],
    '': ['в', ''],
    '': ['в', ''],
    '咖啡厅': ['咖啡', '餐饮'],
    'ȹ': ['', ''],
    '精品咖啡': ['咖啡', '餐饮'],
    '手冲咖啡': ['咖啡', '餐饮'],
    '奶茶店': ['奶茶', '餐饮'],
    '': ['̲', ''],
    '': ['', ''],
    '商场': ['购物'],
    '超市': ['购物'],
    '便利店': ['购物'],
    '地铁站': ['交通'],
    '公交站': ['交通'],
    '医院': ['医疗'],
    '药店': ['医疗'],
    '酒店': ['住宿'],
    '宾馆': ['住宿'],
    '电影院': ['休闲娱乐'],
    '健身房': ['健身', '休闲娱乐'],
    '银行': ['金融'],
  }
  
  if (result.generalized.length === 0 && FALLBACK_GENERALIZATIONS[category]) {
    result.generalized = FALLBACK_GENERALIZATIONS[category]
    result.parent = result.generalized[0]
    result.grandparent = result.generalized[1] || null
  }
  
  return result
}

/**
 * 批量泛化类别列表
 * 
 * @param {string[]} categories - 类别列表
 * @returns {string[]} 泛化后的类别列表（去重）
 */
export function generalizeCategories(categories) {
  if (!categories || categories.length === 0) return []
  
  const generalized = new Set()
  
  categories.forEach(cat => {
    const result = generalizeCategory(cat)
    if (result.parent) generalized.add(result.parent)
    if (result.grandparent) generalized.add(result.grandparent)
  })
  
  return [...generalized]
}

export default {
  CATEGORY_ONTOLOGY,
  normalizeCategoryInput,
  extractCategoriesFromQuestion,
  expandCategory,
  shouldExcludePOI,
  getCategorySynonyms,
  generalizeCategory,
  generalizeCategories
}
