/**
 * 增强意图解析器
 *
 * 解决L3级空间解码器无法理解复杂语义的问题。
 * 空间编码器负责"空间相似性"，意图解析器负责"语义理解"。
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

/**
 * 语义意图标签库
 *
 * 结构: { intent_key: { categories: [], namePatterns: [], excludePatterns: [] } }
 */
const SEMANTIC_INTENTS = {
  // ========== 餐饮场景 ==========
  '约会': {
    label: '浪漫约会',
    categories: ['餐饮美食', '咖啡'],
    namePatterns: ['西餐', '日料', '法餐', '意餐', '铁板烧', '火锅', '烤肉',
                   '牛排', '寿司', '精致', '私房菜', '音乐餐厅', '景观餐厅'],
    excludePatterns: ['快餐', '大排档', '食堂', '小吃', '麻辣烫'],
    description: '适合约会的浪漫餐厅',
  },
  '聚餐': {
    label: '朋友聚餐',
    categories: ['餐饮美食'],
    namePatterns: ['火锅', '烧烤', '烤鱼', '串串', '私房菜', '农家菜',
                   '家常菜', '酒楼', '饭店', '大排档'],
    excludePatterns: [],
    description: '适合多人聚餐的热闹场所',
  },
  '商务': {
    label: '商务宴请',
    categories: ['餐饮美食'],
    namePatterns: ['酒楼', '酒店', '会所', '茶楼', '私房菜', '精致', '轩', '阁'],
    excludePatterns: ['快餐', '小吃', '大排档'],
    description: '适合商务宴请的高档场所',
  },
  '一人食': {
    label: '一人食',
    categories: ['餐饮美食'],
    namePatterns: ['面馆', '便当', '快餐', '小吃', '盖浇饭', '粥店', '米粉'],
    excludePatterns: ['火锅', '烧烤', '烤鱼'],
    description: '适合独自用餐的便捷场所',
  },

  // ========== 咖啡茶饮场景 ==========
  '休息': {
    label: '安静休息',
    categories: ['餐饮美食'],
    namePatterns: ['咖啡', '茶', '书吧', '图书馆', '甜品', '蛋糕'],
    excludePatterns: ['火锅', '烧烤', '大排档'],
    description: '适合安静休息的场所',
  },
  '办公': {
    label: '移动办公',
    categories: ['餐饮美食'],
    namePatterns: ['星巴克', '瑞幸', '咖啡', '茶', '书吧'],
    excludePatterns: [],
    description: '适合带电脑办公的场所',
  },
  '聊天': {
    label: '聊天聚会',
    categories: ['餐饮美食'],
    namePatterns: ['咖啡', '茶', '甜品', '酒吧', '清吧', '居酒屋'],
    excludePatterns: [],
    description: '适合聊天的轻松场所',
  },

  // ========== 娱乐场景 ==========
  '亲子': {
    label: '亲子活动',
    categories: ['风景名胜', '体育休闲服务', '科教文化服务'],
    namePatterns: ['乐园', '游乐园', '动物园', '水族馆', '科技馆', '博物馆',
                   '公园', '游乐场', '儿童', '亲子', '海洋', '植物园'],
    excludePatterns: ['酒吧', 'KTV', '网吧'],
    description: '适合带孩子的亲子场所',
  },
  '情侣': {
    label: '情侣约会',
    categories: ['风景名胜', '体育休闲服务', '餐饮美食'],
    namePatterns: ['电影院', '情侣', '浪漫', '观景', '摩天轮', '公园', '湖', '江滩'],
    excludePatterns: [],
    description: '适合情侣约会的浪漫场所',
  },
  '拍照': {
    label: '打卡拍照',
    categories: ['风景名胜', '餐饮美食'],
    namePatterns: ['网红', '拍照', '打卡', '景观', '江滩', '湖', '花海', '古镇'],
    excludePatterns: [],
    description: '适合拍照打卡的网红地',
  },

  // ========== 运动场景 ==========
  '健身': {
    label: '健身运动',
    categories: ['体育休闲服务'],
    namePatterns: ['健身房', '游泳', '羽毛球', '篮球', '网球', '瑜伽', '跑步'],
    excludePatterns: [],
    description: '适合运动的健身场所',
  },
  '散步': {
    label: '休闲散步',
    categories: ['风景名胜', '体育休闲服务'],
    namePatterns: ['公园', '江滩', '湖', '绿道', '步道', '广场', '滨江'],
    excludePatterns: [],
    description: '适合散步的休闲场所',
  },

  // ========== 旅游场景 ==========
  '一日游': {
    label: '一日游',
    categories: ['风景名胜', '科教文化服务'],
    namePatterns: ['景区', '公园', '博物馆', '古镇', '江滩', '湖', '名胜'],
    excludePatterns: [],
    description: '适合一日游的景点',
  },
  '周边游': {
    label: '周边游',
    categories: ['风景名胜'],
    namePatterns: ['景区', '度假村', '农家乐', '古镇', '山林', '湖'],
    excludePatterns: [],
    description: '适合周边短途游的景点',
  },

  // ========== 宠物场景 ==========
  '宠物': {
    label: '宠物友好',
    categories: ['风景名胜', '体育休闲服务', '餐饮美食'],
    namePatterns: ['宠物', '猫咖', '狗咖', '萌宠', '宠物友好', '可带宠物'],
    excludePatterns: [],
    description: '适合带宠物的场所',
  },
};

/**
 * 从用户查询中提取语义意图
 *
 * @param {string} userQuery - 用户查询
 * @returns {{ category: string|null, semanticTags: string[], intentContext: Object }}
 */
export function extractSemanticIntent(userQuery) {
  if (!userQuery || typeof userQuery !== 'string') {
    return { category: null, semanticTags: [], intentContext: {} };
  }

  const query = userQuery.toLowerCase();
  const semanticTags = [];
  const intentContext = {
    categories: new Set(),
    namePatterns: [],
    excludePatterns: [],
    descriptions: [],
  };

  // 遍历语义意图库
  for (const [key, intent] of Object.entries(SEMANTIC_INTENTS)) {
    // 检查是否包含意图关键词
    const patterns = [key, intent.label];
    let matched = false;

    for (const pattern of patterns) {
      if (query.includes(pattern.toLowerCase())) {
        matched = true;
        break;
      }
    }

    if (matched) {
      semanticTags.push(key);

      // 合并类别
      for (const cat of intent.categories) {
        intentContext.categories.add(cat);
      }

      // 合并名称模式
      intentContext.namePatterns.push(...intent.namePatterns);
      intentContext.excludePatterns.push(...intent.excludePatterns);
      intentContext.descriptions.push(intent.description);
    }
  }

  // 提取核心类别（通过名称关键词推断）
  const categoryKeywords = {
    '餐厅': '餐饮美食',
    '饭店': '餐饮美食',
    '美食': '餐饮美食',
    '吃的': '餐饮美食',
    '咖啡': '餐饮美食',
    '奶茶': '餐饮美食',
    '酒店': '住宿服务',
    '住宿': '住宿服务',
    '景点': '风景名胜',
    '公园': '风景名胜',
    '好玩': '风景名胜',
    '医院': '医疗保健服务',
    '学校': '科教文化服务',
    '银行': '金融保险服务',
    '超市': '购物服务',
    '商场': '购物服务',
  };

  let coreCategory = null;
  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    if (query.includes(keyword)) {
      coreCategory = category;
      break;
    }
  }

  // 如果有语义标签但没有核心类别，使用语义标签的第一个类别
  if (!coreCategory && intentContext.categories.size > 0) {
    coreCategory = [...intentContext.categories][0];
  }

  // 扩展语义标签匹配：检查常见场景词
  const sceneKeywords = {
    '遛娃': '亲子',
    '带娃': '亲子',
    '溜娃': '亲子',
    '遛狗': '宠物',
    '撸猫': '宠物',
    '打卡': '拍照',
    '网红': '拍照',
    '拍照': '拍照',
    '约会': '约会',
    '相亲': '约会',
    '情侣': '约会',
    '聚餐': '聚餐',
    '团建': '聚餐',
    '商务': '商务',
    '宴请': '商务',
    '休息': '休息',
    '办公': '办公',
    '学习': '办公',
  };

  for (const [keyword, tag] of Object.entries(sceneKeywords)) {
    if (query.includes(keyword) && !semanticTags.includes(tag)) {
      semanticTags.push(tag);

      // 如果有对应的意图定义，合并其属性
      if (SEMANTIC_INTENTS[tag]) {
        const intent = SEMANTIC_INTENTS[tag];
        for (const cat of intent.categories) {
          intentContext.categories.add(cat);
        }
        intentContext.namePatterns.push(...intent.namePatterns);
        intentContext.excludePatterns.push(...intent.excludePatterns);
        intentContext.descriptions.push(intent.description);
      }
    }
  }

  return {
    category: coreCategory,
    semanticTags,
    intentContext: {
      categories: [...intentContext.categories],
      namePatterns: intentContext.namePatterns,
      excludePatterns: intentContext.excludePatterns,
      descriptions: intentContext.descriptions,
    },
  };
}

/**
 * 根据语义意图过滤POI
 *
 * @param {Array} pois - POI列表
 * @param {Object} intentContext - 意图上下文
 * @returns {Array} - 过滤后的POI
 */
export function filterBySemanticIntent(pois, intentContext) {
  if (!intentContext || !pois || pois.length === 0) {
    return pois;
  }

  const { namePatterns, excludePatterns } = intentContext;

  // 如果没有模式，直接返回
  if (namePatterns.length === 0 && excludePatterns.length === 0) {
    return pois;
  }

  return pois.filter(poi => {
    const name = poi.name || '';

    // 检查排除模式
    for (const ex of excludePatterns) {
      if (name.includes(ex)) {
        return false;
      }
    }

    // 检查包含模式（加分项，但不强制）
    let hasMatch = false;
    for (const pattern of namePatterns) {
      if (name.includes(pattern)) {
        hasMatch = true;
        break;
      }
    }

    return true; // 包含模式作为加分，不强制过滤
  });
}

/**
 * 为POI添加语义匹配分
 *
 * @param {Array} pois - POI列表
 * @param {Object} intentContext - 意图上下文
 * @returns {Array} - 带语义分POI
 */
export function scoreBySemanticIntent(pois, intentContext) {
  if (!intentContext || !pois || pois.length === 0) {
    return pois;
  }

  const { namePatterns, excludePatterns } = intentContext;

  return pois.map(poi => {
    const name = poi.name || '';
    let semanticBoost = 0;

    // 排除模式惩罚
    for (const ex of excludePatterns) {
      if (name.includes(ex)) {
        semanticBoost -= 0.3;
        break;
      }
    }

    // 包含模式加分
    for (const pattern of namePatterns) {
      if (name.includes(pattern)) {
        semanticBoost += 0.2;
      }
    }

    // 限制加分范围
    semanticBoost = Math.max(-0.5, Math.min(0.5, semanticBoost));

    return {
      ...poi,
      semanticBoost,
      fused_score: (poi.fused_score || 0.5) + semanticBoost,
    };
  });
}

/**
 * 生成意图描述（用于LLM提示）
 *
 * @param {Object} intentContext - 意图上下文
 * @returns {string} - 意图描述
 */
export function generateIntentDescription(intentContext) {
  if (!intentContext || intentContext.descriptions.length === 0) {
    return '';
  }

  return `用户意图：${intentContext.descriptions.join('、')}`;
}

export default {
  SEMANTIC_INTENTS,
  extractSemanticIntent,
  filterBySemanticIntent,
  scoreBySemanticIntent,
  generateIntentDescription,
};
