/**
 * 快速搜索路由模块
 * 
 * 专为简单名词搜索设计，绕过 LLM Pipeline，直接走数据库检索
 * 目标响应时间: < 200ms
 */

import db from '../services/database.js';

/**
 * 类别同义词表 - 用于扩展搜索范围
 * 格式: { 标准词: [同义词列表] }
 */
const CATEGORY_SYNONYMS = {
  // 餐饮类
  '': ['̹', 'ͭ', 'Ĵ', '', 'ǻ', '', 'ţ', ''],
  '̲': ['', 'Ʒ', '̲', 'ϲ', 'ѩ', 'һ', 'ѩ', 'ٵ', '', 'Ʒ'],
  '咖啡': ['咖啡馆', '咖啡厅', '咖啡店', 'cafe', '星巴克', 'Starbucks', '瑞幸咖啡', 'Luckin'],
  '烧烤': ['撸串', '烤肉', '烤串', '炭火烧烤', 'BBQ', '韩式烤肉', '日式烧肉'],
  '': ['', '', '', '', '', '͵'],
  '': ['㵱', 'з', '', '', 'ϵ»', 'KFC', '', 'ը'],
  'ʳ': ['', '', '', '', 'С', '', 'ȸ'],
  '小吃': ['零食', '小吃店', '街边小吃', '特色小吃'],
  '甜点': ['蛋糕', '甜品', '面包', '烘焙', '糕点', '西点'],
  
  // 生活服务类
  '超市': ['便利店', '商店', '小卖部', '杂货店', '711', '全家', '罗森', '美宜佳', '百货'],
  '药店': ['药房', '大药房', '药品', '医药', '益丰', '老百姓', '一心堂'],
  '': ['ATM', '', '', '', '', 'ũҵ', 'й', ''],
  '美容': ['美发', '理发', '美甲', '美容美发', '发廊', '造型'],
  'Ƶ': ['', 'ù', '', 'ס', 'ݾƵ', 'Ƶ'],
  
  // 交通类
  '': ['վ', 'ͨ', 'й', ''],
  '公交': ['公交站', '公共汽车', '公交车站', 'BRT'],
  '停车': ['停车场', '停车位', '车库', '泊车'],
  '加油': ['加油站', '油站', '中石油', '中石化', '壳牌'],
  
  // 教育类
  '学校': ['小学', '中学', '高中', '初中', '学院', '大学', '校园'],
  '幼儿园': ['托儿所', '早教', '幼教', '托育'],
  '培训': ['教育培训', '辅导班', '补习班', '兴趣班', '培训机构'],
  
  // 医疗类
  'ҽԺ': ['', 'Ժ', 'ҽ', '', '', 'סԺ'],
  '牙科': ['口腔', '牙医', '口腔诊所', '口腔医院', '牙科诊所'],
  
  // 休闲娱乐类
  '健身': ['健身房', '运动', '瑜伽', '游泳', '篮球', '足球', '体育馆'],
  '电影': ['电影院', '影城', '影院', '万达影城', 'IMAX'],
  'KTV': ['卡拉OK', 'K歌', '歌厅', '量贩式KTV'],
  '网吧': ['网咖', '电竞', '游戏厅'],
  '公园': ['广场', '游园', '绿地', '景区', '风景区']
};

/**
 * 构建反向索引：同义词 -> 标准词
 */
const REVERSE_SYNONYMS = {};
Object.entries(CATEGORY_SYNONYMS).forEach(([standard, synonyms]) => {
  REVERSE_SYNONYMS[standard.toLowerCase()] = standard;
  synonyms.forEach(syn => {
    REVERSE_SYNONYMS[syn.toLowerCase()] = standard;
  });
});

/**
 * 扩展搜索词（添加同义词）
 * @param {string} term - 原始搜索词
 * @returns {string[]} 扩展后的搜索词列表
 */
function expandSearchTerms(term) {
  const normalized = term.toLowerCase().trim();
  const terms = new Set([normalized]);
  
  // 查找是否命中同义词表
  const standardTerm = REVERSE_SYNONYMS[normalized];
  if (standardTerm) {
    terms.add(standardTerm.toLowerCase());
    // 添加该标准词的所有同义词
    const synonyms = CATEGORY_SYNONYMS[standardTerm] || [];
    synonyms.forEach(syn => terms.add(syn.toLowerCase()));
  }
  
  return Array.from(terms);
}

/**
 * 判断是否为简单名词查询
 * @param {string} query - 用户查询
 * @returns {boolean}
 */
function isSimpleQuery(query) {
  const q = query.trim();
  
  // 规则1: 长度过长，视为复杂查询
  if (q.length > 15) return false;
  
  // 规则2: 包含"附近"、"周边"、"推荐"、"有什么"等词，视为复杂查询（需要 LLM 理解意图）
  const complexPatterns = [
    /附近/, /周边/, /周围/, /旁边/,
    /有什么/, /有没有/, /哪里有/, /哪有/,
    /推荐/, /建议/, /适合/, /好吃/, /好玩/,
    /最近的/, /最好的/, /便宜/,
    /怎么/, /如何/, /为什么/,
    /帮我/, /请问/, /想要/, /我要/,
    /分析/, /比较/, /选择/
  ];
  
  for (const pattern of complexPatterns) {
    if (pattern.test(q)) return false;
  }
  
  // 规则3: 多个词 (超过3个汉字词组)，可能是复杂查询
  // "С"ҲǿԵģȨصͣ
  if (q.split(/\s+/).length > 2) return false;
  
  // 默认: 视为简单名词搜索
  return true;
}

/**
 * 注册快速搜索路由
 * @param {import('fastify').FastifyInstance} fastify 
 */
export default async function searchRoutes(fastify) {
  
  /**
   * GET /api/search/quick
   * 快速名词搜索（绕过 LLM）
   * 
   * Query Params:
   *   q: 搜索关键词 (必填)
   *   lat: 中心纬度 (可选，用于距离排序)
   *   lon: 中心经度 (可选，用于距离排序)
   *   radius: 搜索半径（米，默认 5000）
   *   limit: ƣĬ 100
   *   geometry: WKT 格式的空间边界（可选，优先于 lat/lon/radius）
   */
  fastify.get('/quick', async (request, reply) => {
    const startTime = Date.now();
    const { q, lat, lon, radius = 5000, limit = 100, geometry } = request.query;
    
    if (!q || !q.trim()) {
      return reply.status(400).send({ error: '缺少搜索关键词 q' });
    }
    
    const query = q.trim();
    console.log(`[QuickSearch] 收到查询: "${query}"`);
    
    // 1. 判断是否适合走快速路径
    if (!isSimpleQuery(query)) {
      console.log(`[QuickSearch] 检测到复杂查询，建议走 RAG Pipeline`);
      return reply.send({
        success: true,
        isComplex: true,
        message: '该查询需要 AI 辅助理解，请使用 AI 助手',
        pois: []
      });
    }
    
    // 2. 扩展搜索词
    const expandedTerms = expandSearchTerms(query);
    console.log(`[QuickSearch] 扩展搜索词: [${expandedTerms.join(', ')}]`);
    
    // 3. 调用数据库快速搜索
    try {
      const pois = await db.quickSearch({
        terms: expandedTerms,
        center: lat && lon ? { lat: parseFloat(lat), lon: parseFloat(lon) } : null,
        radius: parseInt(radius),
        geometryWKT: geometry || null,
        limit: parseInt(limit)
      });
      
      const duration = Date.now() - startTime;
      console.log(`[QuickSearch] 完成: ${pois.length} 条结果, 耗时 ${duration}ms`);
      
      // 4. 转换为 GeoJSON Feature 格式
      const features = pois.map(poi => ({
        type: 'Feature',
        properties: {
          id: poi.id,
          '名称': poi.name,
          '大类': poi.category_big,
          '中类': poi.category_mid,
          '小类': poi.category_small,
          '地址': poi.address,
          rating: poi.rating,
          distance_m: poi.distance_m,
          _groupIndex: 0 // 红色标记（常规搜索结果）
        },
        geometry: {
          type: 'Point',
          coordinates: [poi.lon, poi.lat]
        }
      }));
      
      return reply.send({
        success: true,
        isComplex: false,
        query: query,
        expandedTerms: expandedTerms,
        count: features.length,
        duration_ms: duration,
        pois: features
      });
      
    } catch (err) {
      console.error('[QuickSearch] 数据库查询失败:', err);
      return reply.status(500).send({
        success: false,
        error: err.message
      });
    }
  });
  
  /**
   * GET /api/search/synonyms
   * 获取同义词表（用于前端预览）
   */
  fastify.get('/synonyms', async (request, reply) => {
    return reply.send({
      synonyms: CATEGORY_SYNONYMS,
      count: Object.keys(CATEGORY_SYNONYMS).length
    });
  });
  
  /**
   * GET /api/search/classify
   * 判断查询类型（简单 or 复杂）
   */
  fastify.get('/classify', async (request, reply) => {
    const { q } = request.query;
    if (!q) {
      return reply.status(400).send({ error: '缺少参数 q' });
    }
    
    const isSimple = isSimpleQuery(q.trim());
    return reply.send({
      query: q.trim(),
      isSimple,
      recommendation: isSimple ? 'quick_search' : 'ai_assistant'
    });
  });
}
