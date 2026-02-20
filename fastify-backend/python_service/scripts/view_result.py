import json
f = open(r"d:\AAA_Edu\TagCloud\vite-project\newdata\v5_test_districts.geojson", "r", encoding="utf-8")
data = json.load(f)
f.close()
print(f"片区总数: {len(data['features'])}")
print()
for i, feat in enumerate(data["features"]):
    p = feat["properties"]
    print(f"[{i+1}] {p['name']}  |  来源={p['name_source']}  置信度={p['name_confidence']}  方法={p['boundary_method']}  POI={p['poi_count']}  地块={p['block_count']}")
# 统计
methods = [f["properties"]["boundary_method"] for f in data["features"]]
sources = [f["properties"]["name_source"] for f in data["features"]]
none_names = [f for f in data["features"] if "None" in f["properties"]["name"] or "未命名" in f["properties"]["name"]]
print(f"\n--- 统计 ---")
print(f"边界方法分布: { {m: methods.count(m) for m in set(methods)} }")
print(f"命名来源分布: { {s: sources.count(s) for s in set(sources)} }")
print(f"无效命名数量: {len(none_names)}")
