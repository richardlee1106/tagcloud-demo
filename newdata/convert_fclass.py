"""将 OSM_AOI.geojson 中的 fclass 英文字段映射为中文 type 字段，删除 fclass，导出为 OSM_AOI_merge.geojson。"""

import json

# fclass -> 中文映射表
FCLASS_TO_CHINESE = {
    "water": "水域",
    "residential": "居住区",
    "pitch": "运动场",
    "park": "公园",
    "forest": "森林",
    "industrial": "工业区",
    "school": "学校",
    "grass": "草地",
    "parking": "停车场",
    "commercial": "商业区",
    "riverbank": "河岸",
    "farmland": "农田",
    "pier": "码头",
    "reservoir": "水库",
    "retail": "零售区",
    "track": "跑道",
    "meadow": "草甸",
    "hospital": "医院",
    "kindergarten": "幼儿园",
    "restaurant": "餐厅",
    "public_building": "公共建筑",
    "hamlet": "村庄",
    "mall": "购物中心",
    "fuel": "加油站",
    "scrub": "灌木丛",
    "recreation_ground": "休闲场地",
    "college": "学院",
    "market_place": "集市",
    "hotel": "酒店",
    "university": "大学",
    "military": "军事区",
    "museum": "博物馆",
    "wetland": "湿地",
    "sports_centre": "体育中心",
    "cemetery": "公墓",
    "graveyard": "墓地",
    "dam": "大坝",
    "railway_station": "火车站",
    "orchard": "果园",
    "police": "公安局",
    "bus_station": "公交站",
    "buddhist": "佛教寺庙",
    "swimming_pool": "游泳池",
    "stadium": "体育场",
    "library": "图书馆",
    "supermarket": "超市",
    "farmyard": "农场",
    "service": "服务区",
    "fountain": "喷泉",
    "quarry": "采石场",
    "shelter": "避难所",
    "village": "村镇",
    "playground": "游乐场",
    "toilet": "公厕",
    "wastewater_plant": "污水处理厂",
    "car_dealership": "汽车经销商",
    "attraction": "旅游景点",
    "apron": "停机坪",
    "town_hall": "市政厅",
    "tower": "塔",
    "courthouse": "法院",
    "theatre": "剧院",
    "fire_station": "消防站",
    "parking_bicycle": "自行车停车场",
    "helipad": "直升机场",
    "golf_course": "高尔夫球场",
    "bank": "银行",
    "nature_reserve": "自然保护区",
    "island": "岛屿",
    "post_office": "邮局",
    "community_centre": "社区中心",
    "cafe": "咖啡馆",
    "artwork": "艺术品",
    "theme_park": "主题公园",
    "castle": "城堡",
    "weir": "堰",
    "taoist": "道教寺庙",
    "prison": "监狱",
    "food_court": "美食广场",
    "garden_centre": "园艺中心",
    "zoo": "动物园",
    "clothes": "服装店",
    "water_works": "水厂",
    "memorial": "纪念碑",
    "airport": "机场",
    "ferry_terminal": "渡轮码头",
    "beach": "海滩",
    "christian_catholic": "天主教堂",
    "muslim": "清真寺",
    "ruins": "遗址",
    "arts_centre": "文化艺术中心",
    "pharmacy": "药店",
    "camp_site": "露营地",
    "parking_multistorey": "多层停车场",
    "christian": "基督教堂",
    "christian_protestant": "新教教堂",
    "archaeological": "考古遗址",
    "monument": "纪念建筑",
    "comms_tower": "通讯塔",
    "convenience": "便利店",
    "fast_food": "快餐店",
    "furniture_shop": "家具店",
    "mobile_phone_shop": "手机店",
    "clinic": "诊所",
    "water_tower": "水塔",
    "airfield": "简易机场",
    "heath": "荒地",
    "christian_methodist": "卫理公会教堂",
    "veterinary": "兽医",
    "hairdresser": "理发店",
    "greengrocer": "果蔬店",
    "tourist_info": "旅游信息中心",
    "bookshop": "书店",
    "bicycle_rental": "自行车租赁",
    "embassy": "大使馆",
    "viewpoint": "观景点",
    "department_store": "百货商店",
    "marina": "游艇码头",
}

INPUT_PATH = r"d:\AAA_Edu\TagCloud\vite-project\newdata\OSM_AOI.geojson"
OUTPUT_PATH = r"d:\AAA_Edu\TagCloud\vite-project\newdata\OSM_AOI_merge.geojson"

# 读取源文件
with open(INPUT_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

unmapped = set()
for feat in data["features"]:
    props = feat.get("properties", {})
    fclass_val = props.get("fclass", "")
    chinese = FCLASS_TO_CHINESE.get(fclass_val)
    if chinese is None:
        unmapped.add(fclass_val)
        chinese = fclass_val  # 未映射的保留原值
    props["type"] = chinese
    props.pop("fclass", None)

if unmapped:
    print(f"[WARN] 以下 fclass 值未找到中文映射，已保留英文原值: {unmapped}")

# 写出结果（UTF-8，不转义中文）
with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"[OK] 已导出 {len(data['features'])} 个要素到 {OUTPUT_PATH}")
