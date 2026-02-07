# Node 回退演练报告

- 检查时间: 2026-02-07T17:06:53.975Z
- 服务地址: http://127.0.0.1:3200
- 总体结论: 通过

## 运行明细

### python_primary
- 通过: 是
- compute_mode: python_primary
- executor_engine: python_grpc
- POI 数量: 500
- 用时: 13446ms
- 告警: 无

### node_fallback
- 通过: 是
- compute_mode: node_primary
- executor_engine: node_fallback
- POI 数量: 50
- 用时: 16954ms
- 告警: 无

