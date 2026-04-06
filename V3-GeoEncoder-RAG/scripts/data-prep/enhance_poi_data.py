# -*- coding: utf-8 -*-
"""
POI 数据增强脚本

功能：
1. 从 OSM 数据补充餐饮美食类别
2. 处理充电宝 POI 污染（提取真实店名）
3. 添加连锁品牌标识

数据来源：
- 高德 POI: 565,672 条（无餐饮大类）
- OSM POI: 288,281 条（有餐饮美食 49,731 条）

Author: Sisyphus
Date: 2026-03-20
"""

import geopandas as gpd
import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
import re
import os
from typing import Optional, Tuple

# ============================================================
# 连锁餐饮品牌库
# ============================================================

FOOD_BRANDS = {
    # 快餐
    '快餐': ['肯德基', 'KFC', '麦当劳', 'McDonald', '必胜客', 'Pizza Hut',
            '德克士', '华莱士', '真功夫', '老乡鸡', '杨国福', '张亮麻辣烫',
            '味千拉面', '李先生', '永和大王', '真功夫', '面点王'],

    # 火锅
    '火锅': ['海底捞', '呷哺呷哺', '小龙坎', '大龙燚', '蜀大侠', '谭鸭血',
            '锅圈食汇', '海底捞火锅', '小龙坎火锅'],

    # 茶饮咖啡
    '茶饮咖啡': ['星巴克', 'Starbucks', '瑞幸', 'Luckin', '喜茶', '奈雪', '蜜雪冰城',
                '茶百道', '古茗', '书亦烧仙草', '沪上阿姨', '益禾堂', 'CoCo',
                '一点点', '1点点', 'Nowwa', '挪瓦咖啡', 'Manner', 'M Stand',
                'Seesaw', '太平洋咖啡', 'Costa', '咖世家'],

    # 甜品烘焙
    '甜品烘焙': ['好利来', '味多美', '面包新语', '巴黎贝甜', '多乐之日',
                '元祖', '克莉丝汀', '仟吉', '皇冠蛋糕', '罗莎蛋糕'],

    # 中式正餐
    '中式正餐': ['西贝莜面村', '外婆家', '绿茶餐厅', '南京大牌档', '眉州东坡',
                '陶陶居', '点都德', '九毛九', '太二酸菜鱼', '渝是乎'],

    # 国际餐饮
    '国际餐饮': ['汉堡王', 'Burger King', '赛百味', 'Subway', '达美乐',
                'Domino', '棒约翰', 'Papa John', '吉野家', '食其家'],
}

# 品牌快速查找表
BRAND_LOOKUP = {}
for category, brands in FOOD_BRANDS.items():
    for brand in brands:
        BRAND_LOOKUP[brand.lower()] = category


def get_db_connection():
    """获取数据库连接"""
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "15432")),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "123456"),
        database=os.getenv("POSTGRES_DATABASE", "geoloom"),
    )


def extract_charging_info(name: str) -> Tuple[Optional[str], Optional[str]]:
    """
    从充电宝POI名称中提取信息

    输入: "怪兽充电(谭鸭血老火锅光谷广场店)"
    输出: ("怪兽充电", "谭鸭血老火锅光谷广场店")

    输入: "星巴克咖啡"
    输出: (None, None)  # 不是充电宝POI
    """
    if not name:
        return None, None

    # 充电宝品牌模式
    patterns = [
        r'^(怪兽充电)[（(](.+)[)）]$',
        r'^(街电)[（(](.+)[)）]$',
        r'^(来电)[（(](.+)[)）]$',
        r'^(小电)[（(](.+)[)）]$',
    ]

    for pattern in patterns:
        match = re.match(pattern, name)
        if match:
            return match.group(1), match.group(2)

    return None, None


def identify_brand(name: str) -> Optional[str]:
    """识别连锁品牌"""
    if not name:
        return None

    name_lower = name.lower()
    for brand_key, category in BRAND_LOOKUP.items():
        if brand_key in name_lower:
            return category

    return None


def step1_analyze_osm_data():
    """分析 OSM 数据"""
    print("\n" + "="*60)
    print("Step 1: 分析 OSM POI 数据")
    print("="*60)

    osm_path = 'D:/AAA_Edu/TagCloud/三镇原始矢量数据/OSM三镇POI.shp'
    gdf = gpd.read_file(osm_path)

    # 餐饮美食统计
    food = gdf[gdf.iloc[:, 1] == '餐饮美食']
    print(f"\n餐饮美食 POI 总数: {len(food):,}")

    # 中类分布
    print("\n中类分布:")
    print(food.iloc[:, 2].value_counts())

    return gdf, food


def step2_analyze_pollution():
    """分析充电宝污染"""
    print("\n" + "="*60)
    print("Step 2: 分析充电宝污染")
    print("="*60)

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 充电宝污染统计
    cur.execute("""
        SELECT
            CASE
                WHEN name LIKE '怪兽充电%' THEN '怪兽充电'
                WHEN name LIKE '街电%' THEN '街电'
                WHEN name LIKE '来电%' THEN '来电'
                WHEN name LIKE '小电%' THEN '小电'
                ELSE '其他'
            END as brand,
            COUNT(*) as cnt
        FROM pois
        WHERE name ~ '^(怪兽充电|街电|来电|小电)[（(]'
        GROUP BY brand
        ORDER BY cnt DESC
    """)

    print("\n充电宝污染统计:")
    for row in cur.fetchall():
        print(f"  {row['brand']}: {row['cnt']:,} 条")

    # 样例分析
    cur.execute("""
        SELECT name FROM pois
        WHERE name ~ '^(怪兽充电|街电|来电|小电)[（(]'
        LIMIT 10
    """)

    print("\n样例 (提取真实店名):")
    for row in cur.fetchall():
        name = row['name']
        brand, location = extract_charging_info(name)
        if brand and location:
            print(f"  '{name}' → 品牌: {brand}, 位置: {location}")

    cur.close()
    conn.close()


def step3_merge_osm_food():
    """合并 OSM 餐饮数据"""
    print("\n" + "="*60)
    print("Step 3: 合并 OSM 餐饮美食数据")
    print("="*60)

    # 读取 OSM 数据
    osm_path = 'D:/AAA_Edu/TagCloud/三镇原始矢量数据/OSM三镇POI.shp'
    gdf = gpd.read_file(osm_path)

    # 筛选餐饮美食
    food = gdf[gdf.iloc[:, 1] == '餐饮美食'].copy()

    # 重命名字段
    food = food.rename(columns={
        food.columns[0]: 'name',
        food.columns[1]: 'category_main',
        food.columns[2]: 'category_sub',
        food.columns[3]: 'longitude',
        food.columns[4]: 'latitude',
        food.columns[5]: 'city',
    })

    print(f"\n准备导入 {len(food):,} 条餐饮POI")

    conn = get_db_connection()
    cur = conn.cursor()

    # 检查是否已有OSM数据
    cur.execute("SELECT COUNT(*) FROM pois WHERE category_main = '餐饮美食'")
    existing = cur.fetchone()[0]

    if existing > 0:
        print(f"数据库已有 {existing:,} 条餐饮美食POI，跳过导入")
    else:
        print("开始导入...")

        # 批量插入
        rows = []
        for _, row in food.iterrows():
            rows.append((
                row['name'],
                row['category_main'],
                row['category_sub'],
                float(row['longitude']),
                float(row['latitude']),
                str(row.get('city', '武汉')),
                f"SRID=4326;POINT({row['longitude']} {row['latitude']})"
            ))

        execute_values(cur, """
            INSERT INTO pois (name, category_main, category_sub, longitude, latitude, city, geom)
            VALUES %s
        """, rows)

        conn.commit()
        print(f"导入完成: {len(rows):,} 条")

    cur.close()
    conn.close()


def step4_add_location_hint_column():
    """添加位置提示字段"""
    print("\n" + "="*60)
    print("Step 4: 添加 location_hint 字段")
    print("="*60)

    conn = get_db_connection()
    cur = conn.cursor()

    # 添加字段
    try:
        cur.execute("ALTER TABLE pois ADD COLUMN IF NOT EXISTS location_hint TEXT")
        conn.commit()
        print("已添加 location_hint 字段")
    except Exception as e:
        conn.rollback()
        print(f"字段已存在或添加失败: {e}")

    # 更新充电宝POI
    cur.execute("""
        SELECT id, name FROM pois
        WHERE name ~ '^(怪兽充电|街电|来电|小电)[（(]'
    """)

    updates = []
    for row in cur.fetchall():
        name = row[1]
        brand, location = extract_charging_info(name)
        if brand and location:
            updates.append((location, row[0]))

    if updates:
        cur.executemany(
            "UPDATE pois SET location_hint = %s WHERE id = %s",
            updates
        )
        conn.commit()
        print(f"已更新 {len(updates):,} 条充电宝POI的 location_hint")

    cur.close()
    conn.close()


def step5_add_brand_column():
    """添加品牌标识字段"""
    print("\n" + "="*60)
    print("Step 5: 添加 brand_category 字段")
    print("="*60)

    conn = get_db_connection()
    cur = conn.cursor()

    # 添加字段
    try:
        cur.execute("ALTER TABLE pois ADD COLUMN IF NOT EXISTS brand_category TEXT")
        conn.commit()
        print("已添加 brand_category 字段")
    except Exception as e:
        conn.rollback()

    # 更新品牌POI
    cur.execute("SELECT id, name FROM pois WHERE name IS NOT NULL")
    rows = cur.fetchall()

    updates = []
    for row in rows:
        brand_cat = identify_brand(row[1])
        if brand_cat:
            updates.append((brand_cat, row[0]))

    if updates:
        cur.executemany(
            "UPDATE pois SET brand_category = %s WHERE id = %s",
            updates
        )
        conn.commit()
        print(f"已标记 {len(updates):,} 条连锁品牌POI")

    # 统计
    cur.execute("""
        SELECT brand_category, COUNT(*) as cnt
        FROM pois
        WHERE brand_category IS NOT NULL
        GROUP BY brand_category
        ORDER BY cnt DESC
    """)

    print("\n品牌类别分布:")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]:,} 条")

    cur.close()
    conn.close()


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description="POI 数据增强")
    parser.add_argument('--step', type=int, default=0,
                       help="执行指定步骤 (0=全部)")
    parser.add_argument('--analyze', action='store_true',
                       help="仅分析，不修改数据")

    args = parser.parse_args()

    if args.analyze:
        step1_analyze_osm_data()
        step2_analyze_pollution()
        return

    steps = [
        step1_analyze_osm_data,
        step2_analyze_pollution,
        step3_merge_osm_food,
        step4_add_location_hint_column,
        step5_add_brand_column,
    ]

    if args.step > 0:
        steps[args.step - 1]()
    else:
        for step in steps:
            step()

    print("\n" + "="*60)
    print("数据增强完成!")
    print("="*60)


if __name__ == "__main__":
    main()
