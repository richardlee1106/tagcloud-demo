# KPI 报表目录

该目录用于存放路线 A 门禁评估的导出报表。

## 文件说明
- `kpi-*.json`：由 `node scripts/kpi_report.js` 生成的原始 JSON 报表。
- `kpi-*.md`：脚本生成的可读摘要（包含 M1 与稳定期判定）。

## 生成命令
```bash
node scripts/kpi_report.js --window=7d
```

默认读取 `OPS_BASE_URL`（未设置时为 `http://127.0.0.1:3200/api/ops`）。
