# Hotspot Operators 报表目录

用于存放路线B准入前的热点算子识别结果。

## 生成命令
```bash
node scripts/select_hotspot_operators.js --window=7d
```

脚本会从 `GET /api/ops/operator-hotspots` 获取数据，并按照门禁规则筛选 Top2。
