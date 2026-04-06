# Windows Sandbox 执行异常摘要

## 摘要
在本次会话中，命令执行环境无法启动，返回统一错误：

```
windows sandbox: spawn setup refresh
```

该错误发生在命令启动阶段，导致命令未实际执行，属于工具/环境层问题，非代码逻辑错误。

## 发生时间
- 2026-03-15（Asia/Shanghai 时区）

## 影响范围
所有尝试运行的命令均未启动成功，包括但不限于 `pytest` 与读取文件的命令。

## 失败命令样例
```
pytest .\spatial_encoder\tests\test_v26_data_sources.py -v
pytest .\spatial_encoder\tests\test_v26_run_manifest.py -v
pytest .\spatial_encoder\tests\test_v26_evaluation_schema.py -v
pytest .\spatial_encoder\tests\test_v26_preprocess.py -v
```

## 结论
当前错误是“执行环境启动失败”，不是测试失败，也不是代码错误。
建议重新打开会话或稍后重试。
