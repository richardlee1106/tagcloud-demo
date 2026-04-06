<picture>
  <source media="(prefers-color-scheme: dark)" srcset="resources/logos/claude-howto-logo-dark.svg">
  <img alt="Claude How To" src="resources/logos/claude-howto-logo.svg">
</picture>

# 为 Claude How To 做贡献

感谢你对本项目感兴趣做贡献！本指南将帮助你了解如何有效地做出贡献。

## 关于本项目

Claude How To 是一份可视化、以示例驱动的 Claude Code 指南。我们提供：
- **Mermaid 图表** 解释功能如何工作
- **可直接用于生产的模板** 你可以立即使用
- **带上下文和最佳实践的真实示例**
- **从入门到高级的渐进式学习路径**

## 贡献类型

### 1. 新示例或模板
为现有功能添加示例（slash commands、skills、hooks 等）：
- 可直接复制的代码
- 清晰的功能说明
- 使用场景和好处
- 故障排除提示

### 2. 文档改进
- 澄清令人困惑的部分
- 修复拼写和语法
- 添加遗漏的信息
- 改进代码示例

### 3. 功能指南
为新的 Claude Code 功能创建指南：
- 分步教程
- 架构图
- 常见模式和反模式
- 真实工作流

### 4. Bug 报告
报告你遇到的问题：
- 描述你期望什么
- 描述实际发生了什么
- 包含复现步骤
- 添加相关的 Claude Code 版本和操作系统

### 5. 反馈和建议
帮助改进指南：
- 建议更好的解释
- 指出覆盖空白
- 建议新部分或重新组织

## 开始之前

### 1. Fork 并克隆
```bash
git clone https://github.com/luongnv89/claude-howto.git
cd claude-howto
```

### 2. 创建分支
使用描述性的分支名称：
```bash
git checkout -b add/feature-name
git checkout -b fix/issue-description
git checkout -b docs/improvement-area
```

### 3. 设置你的环境
```bash
# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装 pre-commit hooks（可选但推荐）
pip install pre-commit
pre-commit install

# 手动运行 pre-commit 检查
pre-commit run --all-files
```

## 目录结构

```
├── 01-slash-commands/      # 用户触发的快捷命令
├── 02-memory/              # 持久化上下文示例
├── 03-skills/              # 可复用能力
├── 04-subagents/           # 专业 AI 助手
├── 05-mcp/                 # Model Context Protocol 示例
├── 06-hooks/               # 事件驱动自动化
├── 07-plugins/             # 打包的功能
├── 08-checkpoints/          # 会话快照
├── 09-advanced-features/    # Planning、thinking、后台任务
├── 10-cli/                 # CLI 参考
├── scripts/                # 构建和实用脚本
└── README.md               # 主指南
```

## 如何贡献示例

### 添加 Slash Command
1. 在 `01-slash-commands/` 中创建 `.md` 文件
2. 包含：
   - 清晰的功能描述
   - 使用场景
   - 安装说明
   - 用法示例
   - 自定义提示
3. 更新 `01-slash-commands/README.md`

### 添加 Skill
1. 在 `03-skills/` 中创建目录
2. 包含：
   - `SKILL.md` - 主文档
   - `scripts/` - 需要的辅助脚本
   - `templates/` - Prompt 模板
   - 示例用法 README
3. 更新 `03-skills/README.md`

### 添加 Subagent
1. 在 `04-subagents/` 中创建 `.md` 文件
2. 包含：
   - Agent 目的和能力
   - 系统提示结构
   - 示例使用场景
   - 集成示例
3. 更新 `04-subagents/README.md`

### 添加 MCP 配置
1. 在 `05-mcp/` 中创建 `.json` 文件
2. 包含：
   - 配置说明
   - 所需的环境变量
   - 设置说明
   - 用法示例
3. 更新 `05-mcp/README.md`

### 添加 Hook
1. 在 `06-hooks/` 中创建 `.sh` 文件
2. 包含：
   - Shebang 和描述
   - 清晰注释解释逻辑
   - 错误处理
   - 安全考虑
3. 更新 `06-hooks/README.md`

## 编写指南

### Markdown 风格
- 使用清晰的标题（H2 用于章节，H3 用于子章节）
- 保持段落简短聚焦
- 使用项目符号列表
- 包含带语言规范的代码块
- 在章节之间添加空行

### 代码示例
- 使示例可直接复制使用
- 为非显而易见的逻辑添加注释
- 同时包含简单和高级版本
- 展示真实使用场景
- 突出潜在问题

### 文档
- 解释"为什么"而不仅仅是"是什么"
- 包含前提条件
- 添加故障排除部分
- 链接到相关主题
- 保持对初学者友好

### JSON/YAML
- 使用一致的适当缩进（2 或 4 空格）
- 添加解释配置的注释
- 包含验证示例

### 图表
- 尽可能使用 Mermaid
- 保持图表简单可读
- 在图表下方包含描述
- 链接到相关章节

## 提交指南

遵循 conventional commit 格式：
```
type(scope): description

[optional body]
```

类型：
- `feat`：新功能或示例
- `fix`：Bug 修复或更正
- `docs`：文档更改
- `refactor`：代码重构
- `style`：格式化更改
- `test`：测试添加或更改
- `chore`：构建、依赖等

示例：
```
feat(slash-commands): Add API documentation generator
docs(memory): Improve personal preferences example
fix(README): Correct table of contents link
docs(skills): Add comprehensive code review skill
```

## 提交前检查

### 清单
- [ ] 代码遵循项目风格和约定
- [ ] 新示例包含清晰文档
- [ ] README 文件已更新（本地和根目录）
- [ ] 无敏感信息（API 密钥、凭据）
- [ ] 示例已测试且可用
- [ ] 链接已验证且正确
- [ ] 文件有适当的权限（脚本可执行）
- [ ] 提交信息清晰且描述性

### 本地测试
```bash
# 检查文件格式化
pre-commit run --all-files

# 验证链接（如果适用）
# 使用 Claude Code 手动测试示例

# 审查你的更改
git diff

# 测试 EPUB 生成（如果更改了文档）
uv run scripts/build_epub.py
```

## Pull Request 流程

1. **创建带清晰描述的 PR**：
   - 这是添加/修复什么？
   - 为什么需要它？
   - 相关 issues（如果有）

2. **包含相关细节**：
   - 新功能？包含使用场景
   - 文档？解释改进
   - 示例？展示前后对比

3. **链接到 issues**：
   - 使用 `Closes #123` 自动关闭相关 issues

4. **对审查保持耐心**：
   - 维护者可能建议改进
   - 根据反馈迭代
   - 最终决定权在维护者

## 代码审查流程

审查者将检查：
- **准确性**：它是否按描述工作？
- **质量**：可以用于生产吗？
- **一致性**：是否遵循项目模式？
- **文档**：是否清晰完整？
- **安全**：是否有漏洞？

## 报告 Issues

### Bug 报告
包含：
- Claude Code 版本
- 操作系统
- 复现步骤
- 期望行为
- 实际行为
- 适用的截图

### 功能请求
包含：
- 正在解决的使用场景或问题
- 拟议的解决方案
- 你考虑过的替代方案
- 其他上下文

### 文档问题
包含：
- 什么令人困惑或遗漏
- 建议的改进
- 示例或参考

## 项目政策

### 敏感信息
- 永不提交 API 密钥、tokens 或凭据
- 在示例中使用占位符值
- 为配置文件包含 `.env.example`
- 记录所需的环境变量

### 代码质量
- 保持示例聚焦和可读
- 避免过度工程化解决方案
- 为非显而易见的逻辑添加注释
- 提交前彻底测试

### 知识产权
- 原创内容归作者所有
- 项目使用教育许可证
- 尊重现有版权
- 需要时提供归属

## 获取帮助

- **问题**：在 GitHub Issues 中打开 discussion
- **一般帮助**：查看现有文档
- **开发帮助**：审查类似示例
- **代码审查**：在 PR 中标记维护者

## 认可

贡献者在以下地方获得认可：
- README.md 贡献者部分
- GitHub 贡献者页面
- 提交历史

## 安全

贡献示例和文档时，请遵循安全编码实践：

- **永不硬编码密钥或 API 密钥** - 使用环境变量
- **警告安全影响** - 突出潜在风险
- **使用安全默认值** - 默认启用安全功能
- **验证输入** - 展示适当的输入验证和清理
- **包含安全说明** - 记录安全考虑

关于安全问题，请参阅 [SECURITY.md](SECURITY.md) 了解我们的漏洞报告流程。

## 行为准则

我们致力于提供一个欢迎和包容的社区。请阅读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 了解我们的完整社区规范。

简而言之：
- 尊重和包容
- 优雅地欢迎反馈
- 帮助他人学习和成长
- 避免骚扰或歧视
- 向维护者报告问题

所有贡献者都应该维护本准则并以善意和尊重对待彼此。

## 许可证

通过向本项目贡献，你同意你的贡献将根据 MIT 许可证获得许可。详见 [LICENSE](LICENSE) 文件。

## 问题？

- 查看 [README](README.md)
- 审查 [LEARNING-ROADMAP.md](LEARNING-ROADMAP.md)
- 查看现有示例
- 打开 issue 进行讨论

感谢你的贡献！
