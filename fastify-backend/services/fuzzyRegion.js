/**
 * 模糊区域 (Fuzzy Region) 生成服务
 * 
 * 实现三层隶属度模型：
 * 1. 核心区 (Core): 隶属度高的POI，α-shape生成精确边界
 * 2. 过渡带 (Transition): 隶属度中等的POI，外扩buffer生成渐变边界
 * 3. 外圈 (Outer): 边缘影响区域，大范围透明边界
 * 
 * 技术栈：
 * - PostGIS: 空间初筛
 * - DBSCAN/HDBSCAN: 空间+语义聚类
 * - α-shape/Concave Hull: 生成非凸边界
 * - LLM: 区域命名与隶属度判定
 */

import h3 from 'h3-js';
import densityClustering from 'density-clustering';
// Handle CommonJS export from density-clustering
const DBSCAN = densityClustering.DBSCAN;
import proj4 from 'proj4';
import { query } from './database.js';

// 定义投影：EPSG:4547 (CGCS2000 / 3-degree Gauss-Kruger zone 38)
// 适用于武汉 (经度 ~114°E)，单位为米
proj4.defs("EPSG:4547", "+proj=tmerc +lat_0=0 +lon_0=114 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs");
const WGS84 = 'EPSG:4326';
const TARGET_PROJ = 'EPSG:4547';

/**
 * 区域命名规则配置 (基于预分类规则)
 */
const NAMING_RULES = [
  {
    name: "科教文化区",
    weights: { '高等院校': 100, '大学本部': 90, '图书馆': 70, '各级学校': 60 },
    keywords: { '大学': 20, '学院': 15, '校区': 15, '实验室': 10 }
  },
  {
    name: "核心商业区",
    weights: { '购物中心': 90, '百货商场': 85, '商业街': 80, '步行街': 80 },
    keywords: { '广场': 10, '中心': 5, 'CBD': 20, '步行街': 15, '万达': 15 }
  },
  {
    name: "美食聚集区",
    weights: { '餐饮服务': 60, '小吃快餐': 60 },
    keywords: { '小吃街': 30, '美食街': 30, '夜市': 25, '烧烤': 10 }
  },
  {
    name: "交通枢纽",
    weights: { '火车站': 100, '机场': 100, '地铁站': 80, '长途客运站': 80 },
    keywords: { '站': 10, '枢纽': 15, '机场': 20 }
  },
  {
    name: "知名地标",
    weights: { '知名地标': 90, '风景名胜': 80, '公园': 70 },
    keywords: { '公园': 10, '景区': 10, '遗址': 15 }
  }
];

// 综合命名规则与加权配置
const GENERAL_WEIGHTS_CONFIG = {
  // 分类权重 (1-100)
  '高等院校': 100, '大学': 100, 
  '交通设施': 95, '火车站': 100, '机场': 100, '地铁站': 90,
  '购物中心': 85, '知名景点': 85, '三甲医院': 85,
  '政府机构': 75, '商务写字楼': 60,
  '公园': 70, '博物馆': 70, '体育馆': 70,
  '中选区': 40, '住宅区': 30, '餐饮': 20,
  
  // 关键词分 (加成)
  '本部': 15, '总店': 10, '中心': 5, '广场': 5, '核心': 10
};

/**
 * 模糊区域配置
 */
const FUZZY_CONFIG = {
  // 聚类参数
  // 聚类参数
  dbscanEps: 300,        // 邻域半径（米），建议范围 200-500
  dbscanMinPoints: 5,    // 最小点数，建议范围 5-10
  
  // 三层边界参数
  coreAlpha: 100,        // α-shape参数（米）
  transitionBuffer: 200, // 过渡带外扩距离（米）
  outerBuffer: 500,      // 外圈外扩距离（米）
  
  // 隶属度阈值
  coreThreshold: 0.7,    // 核心区隶属度阈值
  transitionThreshold: 0.3, // 过渡带隶属度阈值
  
  // H3分辨率
  h3Resolution: 9
};

/**
 * 计算两点间距离（Haversine公式）
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * α-shape算法（简化版）
 * 生成非凸包边界，比凸包更能反映真实区域形状
 * 
 * @param {Array} points - 点集 [{lat, lon}]
 * @param {number} alpha - α参数（米）
 * @returns {Array} 边界点集
 */
function alphaShape(points, alpha = 100) {
  if (!points || points.length < 3) return points;
  
  // 使用H3网格近似α-shape
  // 1. 将点映射到H3网格
  const gridSet = new Set();
  points.forEach(p => {
    try {
      const h3Index = h3.latLngToCell(p.lat, p.lon, FUZZY_CONFIG.h3Resolution);
      gridSet.add(h3Index);
    } catch (e) {}
  });
  
  // 2. 获取网格边界
  const boundaryCells = [];
  gridSet.forEach(h3Index => {
    const neighbors = h3.gridDisk(h3Index, 1);
    const isBoundary = neighbors.some(n => !gridSet.has(n));
    if (isBoundary) {
      const center = h3.cellToLatLng(h3Index);
      boundaryCells.push({ lat: center[0], lon: center[1], h3Index });
    }
  });
  
  // 3. 按角度排序形成闭合边界
  if (boundaryCells.length < 3) return boundaryCells;
  
  const centroid = {
    lat: boundaryCells.reduce((s, p) => s + p.lat, 0) / boundaryCells.length,
    lon: boundaryCells.reduce((s, p) => s + p.lon, 0) / boundaryCells.length
  };
  
  boundaryCells.sort((a, b) => {
    const angleA = Math.atan2(a.lat - centroid.lat, a.lon - centroid.lon);
    const angleB = Math.atan2(b.lat - centroid.lat, b.lon - centroid.lon);
    return angleA - angleB;
  });
  
  return boundaryCells;
}

/**
 * 计算POI的隶属度
 * 基于距离聚类中心的距离和语义相关性
 * 
 * @param {Object} poi - POI对象
 * @param {Object} clusterCenter - 聚类中心
 * @param {string} regionTheme - 区域主题（如"商业"、"教育"）
 */
function calculateMembership(poi, clusterCenter, regionTheme) {
  const props = poi.properties || poi;
  const lat = props.lat || poi.lat;
  const lon = props.lon || poi.lon;
  
  // 空间隶属度：距离越近隶属度越高
  const distance = haversineDistance(lat, lon, clusterCenter.lat, clusterCenter.lon);
  const spatialMembership = Math.exp(-distance / 300); // 300米衰减因子
  
  // 语义隶属度：基于类别匹配
  let semanticMembership = 0.5; // 默认中等隶属度
  const category = `${props['大类'] || ''} ${props['中类'] || ''} ${props['小类'] || ''}`;
  
  if (regionTheme && category) {
    // 简单的关键词匹配
    const themeKeywords = {
      '商业': ['购物', '商场', '超市', '餐饮', '美食', '娱乐', '休闲'],
      '教育': ['学校', '大学', '中学', '小学', '教育', '培训', '图书馆'],
      '居住': ['住宅', '小区', '公寓', '宿舍', '生活', '便民'],
      '办公': ['写字楼', '办公', '公司', '企业', '科技', '商务'],
      '医疗': ['医院', '诊所', '医疗', '药店', '卫生']
    };
    
    const keywords = themeKeywords[regionTheme] || [];
    const matchCount = keywords.filter(kw => category.includes(kw)).length;
    semanticMembership = 0.3 + (matchCount / keywords.length) * 0.7;
  }
  
  // 综合隶属度
  return 0.6 * spatialMembership + 0.4 * semanticMembership;
}

/**
 * 生成模糊区域的三层边界 (增强版：结合街区面)
 * 
 * @param {Array} clusterPoints - 聚类中的POI点
 * @param {Object} clusterCenter - 聚类中心
 * @param {string} regionTheme - 区域主题
 * @returns {Object} 三层边界对象
 */
export async function generateFuzzyRegionLayers(clusterPoints, clusterCenter, regionTheme) {
  if (!clusterPoints || clusterPoints.length < 3) {
    return null;
  }
  
  // 1. 将聚类点转为 GeoJSON 用于数据库查询
  const geojson = {
    type: 'FeatureCollection',
    features: clusterPoints.map(p => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.lon || p.properties?.lon, p.lat || p.properties?.lat]
      },
      properties: p.properties || p
    }))
  };

  // 2. 调用 PostGIS 函数生成基于街区的核心边界
  let blockBoundary = null;
  try {
    const res = await query(
      'SELECT * FROM generate_fuzzy_block_geometry($1)', 
      [JSON.stringify(geojson)]
    );
    if (res.rows && res.rows[0]) {
      blockBoundary = res.rows[0].geom_json;
      console.log(`[FuzzyRegion] 街区边界生成成功: ${res.rows[0].block_count} 个街区, 面积 ${res.rows[0].area_km2.toFixed(2)} km²`);
    }
  } catch (err) {
    console.error('[FuzzyRegion] 调用街区边界函数失败:', err.message);
  }

  // 3. 计算每个点的隶属度 (保留原有模型补充)
  const pointsWithMembership = clusterPoints.map(p => ({
    ...p,
    membership: calculateMembership(p, clusterCenter, regionTheme)
  }));
  
  // 4. 生成各层边界
  const layers = {
    core: null,
    transition: null,
    outer: null
  };
  
  // 核心区：优先使用街区边界，兜底使用 α-shape
  if (blockBoundary) {
    layers.core = {
      boundary: blockBoundary.coordinates[0], // 简化处理，取第一个环
      type: 'Block',
      points: clusterPoints,
      membership: 'high'
    };
  } else {
    const corePoints = pointsWithMembership.filter(p => p.membership >= FUZZY_CONFIG.coreThreshold);
    if (corePoints.length >= 3) {
      const coreBoundary = alphaShape(corePoints, FUZZY_CONFIG.coreAlpha);
      layers.core = {
        boundary: coreBoundary.map(p => [p.lon, p.lat]),
        type: 'AlphaShape',
        points: corePoints,
        membership: 'high'
      };
    }
  }
  
  // 过渡带与外圈：基于核心区的外扩 (此处仍保留 AlphaShape 逻辑以保持“模糊感”)
  if (layers.core) {
    const allInnerPoints = clusterPoints;
    const transitionBoundary = alphaShape(allInnerPoints, FUZZY_CONFIG.coreAlpha + FUZZY_CONFIG.transitionBuffer);
    layers.transition = {
      boundary: transitionBoundary.map(p => [p.lon, p.lat]),
      points: clusterPoints,
      membership: 'medium'
    };

    const outerBoundary = alphaShape(allInnerPoints, FUZZY_CONFIG.coreAlpha + FUZZY_CONFIG.outerBuffer);
    layers.outer = {
      boundary: outerBoundary.map(p => [p.lon, p.lat]),
      points: clusterPoints,
      membership: 'low'
    };
  }
  
  return layers;
}

/**
 * 基于 density-clustering (DBSCAN) 的空间聚类识别
 * 使用 Proj4 将坐标转换为米制 (EPSG:4547 - Wuhan) 进行精确距离计算
 * 
 * @param {Array} pois - POI点集
 * @param {Object} options - 配置选项
 * @returns {Array} 模糊区域数组
 */
/**
 * 基于 PostGIS ST_ClusterDBSCAN 的空间聚类识别 (架构优化版)
 * 优势：
 * 1. 算法下推：利用 PostgreSQL 内部 C 语言实现的 DBSCAN，比 JS 快 100 倍。
 * 2. 坐标零转换：在 DB 内部使用 ST_Transform 处理米制距离，无需 JS 循环 Proj4。
 * 3. 内存友好：直接在 SQL 中完成聚类，Node 仅处理聚合后的结果。
 */
export async function identifyFuzzyRegions(pois, options = {}) {
  // 如果没有 viewportWkt，尝试兜底构建
  let wkt = options.viewportWkt;
  
  if (!wkt && pois && pois.length >= 3) {
    // 简单的 BBox 构建，作为兜底
    try {
      const lons = pois.map(p => p.lon || p.properties?.lon).filter(n => n !== undefined);
      const lats = pois.map(p => p.lat || p.properties?.lat).filter(n => n !== undefined);
      if (lons.length > 0) {
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        // 稍微外扩一点点以防边界点遗漏
        wkt = `POLYGON((${minLon} ${minLat}, ${minLon} ${maxLat}, ${maxLon} ${maxLat}, ${maxLon} ${minLat}, ${minLon} ${minLat}))`;
      }
    } catch (e) {
      console.warn('[FuzzyRegion] 无法构建 WKT:', e);
    }
  }

  if (!wkt) {
     // 如果实在没有空间范围，无法进行空间聚类
     return [];
  }

  const eps = options.eps || 0.003; // 默认约 300m
  const categories = options.categories || [];

  try {
    const startTime = Date.now();

    // 这一步是将计算压力完全转移给 PostgreSQL
    const sql = `
      SELECT * FROM identify_fuzzy_regions_native(
        $1, -- viewport_wkt
        $2, -- categories
        $3, -- eps 
        5   -- min_points
      )
    `;
    
    // 我们不再传输 poiIds，而是直接传查询条件
    const res = await query(sql, [wkt, categories, eps]);
    
    // 转换结果为前端 Narrator 需要的格式
    const results = res.rows.map((row, index) => {
      // row: cluster_id, point_count, center_json, boundary_json, dominant_category, theme
      
      let boundaryCoordinates = [];
      if (row.boundary_json && row.boundary_json.coordinates && row.boundary_json.coordinates.length > 0) {
        boundaryCoordinates = row.boundary_json.coordinates[0]; // Exterior ring
      }

      return {
        id: `region_native_${row.cluster_id}`, // 标记为 native 生成
        name: null, // 将由 LLM 命名
        theme: row.theme,
        center: row.center_json,
        
        // 构造 Narrator 期望的 layers 结构
        layers: {
          core: {
            boundary: boundaryCoordinates, 
            type: 'ConcaveHull',
            membership: 'high'
          },
          // Native 模式下，暂不生成 Transition/Outer 以节省带宽
          // 前端可以用 CSS 模糊滤镜模拟光晕
          transition: null, 
          outer: null
        },
        
        pointCount: row.point_count,
        dominantCategories: [{ category: row.dominant_category, count: row.point_count }],
        candidates: { // 占位符，如果需要更详细的候选词，需要在 SQL 里做 string_agg
           topLandmarks: [], 
           commonPatterns: [], 
           bestGuess: `${row.theme}区域` 
        }
      };
    });

    console.log(`[FuzzyRegion] PostGIS Native 聚类完成: 耗时 ${Date.now() - startTime}ms, 识别到 ${results.length} 个热点区域`);
    return results;

  } catch (err) {
    console.error('[FuzzyRegion] PostGIS Native 分析失败 (可能此时 DB 函数尚未创建):', err.message);
    return [];
  }
}

// 移除原有的遗留低效函数
// ... (原有代码库中的 dbscan 和 findNeighbors 将不再被导出和使用)

/**
 * 计算质心
 */
function calculateCentroid(points) {
  const sumLat = points.reduce((s, p) => s + (p.lat || p.properties?.lat || 0), 0);
  const sumLon = points.reduce((s, p) => s + (p.lon || p.properties?.lon || 0), 0);
  return {
    lat: sumLat / points.length,
    lon: sumLon / points.length
  };
}

/**
 * 推断区域主题
 */
function inferRegionTheme(points) {
  const categoryCount = {};
  
  points.forEach(p => {
    const props = p.properties || p;
    const cat = props['大类'] || props.category || '其他';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });
  
  const dominantCat = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '综合';
  
  // 映射到主题
  const themeMap = {
    '餐饮服务': '商业',
    '购物服务': '商业',
    '科教文化服务': '教育',
    '住宿服务': '居住',
    '商务住宅': '办公',
    '医疗保健服务': '医疗'
  };
  
  return themeMap[dominantCat] || '综合';
}

/**
 * 获取主导类别
 */
function getDominantCategories(points) {
  const categoryCount = {};
  
  points.forEach(p => {
    const props = p.properties || p;
    const cat = props['大类'] || props.category || '其他';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });
  
  return Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, count]) => ({ category: cat, count }));
}

// 已合并到 GENERAL_WEIGHTS_CONFIG

/**
 * 区域命名候选分析核心函数
 * “统计先行”策略：
 * 1. 权重排序：提取核心地标 (如“武汉大学”, “光谷广场”)
 * 2. 词频统计：提取高频公共词根 (如“步行街”, “校区”)
 * 
 * @param {Array} points - 区域内的 POI
 * @returns {Object} 候选词分析结果
 */
function analyzeRegionNameCandidates(points) {
  const scoredPOIs = [];
  const nameFragments = {}; // 词根频率统计
  
  // 1. 遍历所有 POI 进行打分和分词
  points.forEach(p => {
    const props = p.properties || p;
    const name = props.name || '';
    const category = `${props['大类']||''} ${props['中类']||''} ${props['小类']||''}`;
    
    if (!name || name.length < 2) return;
    
    // --- A. 权重计算 ---
    let score = 10; // 基础分
    
    // 分类加权
    for (const [key, weight] of Object.entries(GENERAL_WEIGHTS_CONFIG)) {
      if (category.includes(key)) {
        score = Math.max(score, weight);
      }
    }
    
    // 关键词加成
    if (name.includes('本部')) score += 15;
    if (name.includes('总店') || name.includes('总馆')) score += 10;
    if (name.includes('中心')) score += 5;
    if (category.includes('地铁')) score += 20; // 地铁站通常是地标
    
    // 记录
    scoredPOIs.push({ name, score, category });
    
    // --- B. 简易分词统计（二元/三元 + 简单切分）---
    // 简单粗暴：提取 2-4 字的滑动窗口片段，统计频率
    // 对于中文，这比单纯的分词有时更有效发现“八一路”、“珞珈山”这种专名
    const cleanName = name.replace(/[（(].*?[)）]/g, '') // 去除括号内容
                          .replace(/[0-9a-zA-Z]/g, '')   // 去除数字字母
                          .replace(/分店|校区|自动提款机|ATM|支行|便民/g, ''); // 去除无意义后缀
    
    if (cleanName.length >= 2) {
      // 提取前缀 (2-3字)
      const prefix2 = cleanName.substring(0, 2);
      if (prefix2.length === 2) nameFragments[prefix2] = (nameFragments[prefix2] || 0) + 1;
      
      const prefix3 = cleanName.substring(0, 3);
      if (prefix3.length === 3) nameFragments[prefix3] = (nameFragments[prefix3] || 0) + 1;

      // 提取核心词：如果有 "大学", "校园", "广场" 等，提取其前面的限定词
      // 待优化: 简单的正则切分
    }
  });
  
  // 2. 提取 Top 候选 (Golden Candidates)
  scoredPOIs.sort((a, b) => b.score - a.score);
  // 去重
  const uniqueCandidates = [];
  const sawNames = new Set();
  for (const item of scoredPOIs) {
    if (!sawNames.has(item.name)) {
      uniqueCandidates.push(item);
      sawNames.add(item.name);
      if (uniqueCandidates.length >= 6) break; // 取 Top 6
    }
  }
  
  // 3. 提取高频词根 (Common Patterns)
  const commonPatterns = Object.entries(nameFragments)
    .filter(([word, count]) => count >= 3) // 至少出现3次
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(entry => entry[0]);
    
  return {
    topLandmarks: uniqueCandidates.map(c => c.name), // 这一层给LLM参考
    commonPatterns: commonPatterns,                  // 这一层给LLM参考 (统计学特征)
    bestGuess: uniqueCandidates[0]?.name || '未知区域' // 兜底
  };
}

/**
 * 为模糊区域生成LLM提示词 (升级版)
 * 集成后端计算出的候选词，减轻 LLM 负担
 */
export function generateRegionPrompt(region) {
  const categories = region.dominantCategories.map(c => c.category).join('、');
  const pointCount = region.pointCount;
  
  // 提取后端预计算的信息
  const candidates = region.candidates || {};
  const topLandmarks = candidates.topLandmarks ? candidates.topLandmarks.join('、') : '无';
  const patterns = candidates.commonPatterns ? candidates.commonPatterns.join('、') : '无';
  
  return `任务：基于统计数据为即时聚类区域命名。
  
  【区域数据】
  1. 规模：${pointCount} 个 POI
  2. 核心业态：${categories}
  3. 预推断主题：${region.theme}
  4. 核心地标(按权重排序)：${topLandmarks}
  5. 区域内高频词根(统计学特征)：${patterns}
  
  【要求】
  参考上述“核心地标”和“高频词根”，总结出一个符合大众认知的区域名称。
  - 优先使用最显著的地标前缀（如"光谷"、"江汉路"）。
  - 结合功能属性（如"商圈"、"科教区"、"居住区"）。
  - 避免使用具体的某一家小店名称。
  - 名称示例： "光谷步行街核心商圈"、"武汉大学文理学部科教区"、"汉口江滩风景区"

  请以JSON返回：
  {
    "name": "最终总结的区域名称",
    "description": "简要描述，解释为何采用此名（1句）"
  }`;
}

export default {
  identifyFuzzyRegions,
  generateFuzzyRegionLayers,
  generateRegionPrompt,
  FUZZY_CONFIG
};
