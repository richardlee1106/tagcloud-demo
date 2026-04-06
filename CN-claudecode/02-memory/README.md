# 项目配置

## 项目概述
- **名称**：电商平台
- **技术栈**：Node.js、PostgreSQL、React 18、Docker
- **团队规模**：5 名开发人员
- **截止日期**：2025 年第四季度

## 架构文档
@docs/architecture.md
@docs/api-standards.md
@docs/database-schema.md

## 开发规范

### 代码风格
- 使用 Prettier 进行代码格式化
- 使用 ESLint 配合 Airbnb 配置
- 最大行长度：100 个字符
- 使用 2 空格缩进

### 命名规范
- **文件**：kebab-case（user-controller.js）
- **类**：PascalCase（UserService）
- **函数/变量**：camelCase（getUserById）
- **常量**：UPPER_SNAKE_CASE（API_BASE_URL）
- **数据库表**：snake_case（user_accounts）

### Git 工作流程
- 分支命名：`feature/描述` 或 `fix/描述`
- 提交信息：遵循 Conventional Commits 规范
- 必须通过 PR 才能合并
- 所有 CI/CD 检查必须通过
- 至少需要 1 人审批

### 测试要求
- 最低代码覆盖率：80%
- 所有关键路径必须编写测试
- 使用 Jest 进行单元测试
- 使用 Cypress 进行端到端测试
- 测试文件名：`*.test.ts` 或 `*.spec.ts`

### API 规范
- 仅使用 RESTful 端点
- 使用 JSON 格式的请求/响应
- 正确使用 HTTP 状态码
- API 端点版本控制：`/api/v1/`
- 所有端点必须附带示例文档

### 数据库
- 使用迁移工具管理 schema 变更
- 禁止硬编码凭据
- 使用连接池
- 开发环境启用查询日志
- 必须定期备份

### 部署
- 基于 Docker 部署
- 使用 Kubernetes 进行编排
- 蓝绿部署策略
- 失败时自动回滚
- 数据库迁移在部署前运行

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm test` | 运行测试套件 |
| `npm run lint` | 检查代码风格 |
| `npm run build` | 构建生产版本 |
| `npm run migrate` | 运行数据库迁移 |

## 团队联系方式
- 技术负责人：Sarah Chen（@sarah.chen）
- 产品经理：Mike Johnson（@mike.j）
- 运维工程师：Alex Kim（@alex.k）

## 已知问题及解决方案
- 峰值时段 PostgreSQL 连接池限制为 20
  - 解决方案：实现查询队列
- Safari 14 与异步生成器兼容性问题
  - 解决方案：使用 Babel 转译器

## 相关项目
- 数据分析面板：`/projects/analytics`
- 移动端应用：`/projects/mobile`
- 管理后台：`/projects/admin`
