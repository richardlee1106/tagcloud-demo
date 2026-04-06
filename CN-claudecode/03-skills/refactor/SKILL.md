---
name: code-refactor
description: Systematic code refactoring based on Martin Fowler's methodology. Use when users ask to refactor code, improve code structure, reduce technical debt, clean up legacy code, eliminate code smells, or improve code maintainability. This skill guides through a phased approach with research, planning, and safe incremental implementation.
---

# Code Refactoring Skill（代码重构技能）

A systematic approach to refactoring code based on Martin Fowler's *Refactoring: Improving the Design of Existing Code* (2nd Edition). This skill emphasizes safe, incremental changes backed by tests.
（一种基于 Martin Fowler 所著《重构：改善既有代码的设计》（第 2 版）的系统化代码重构方法。此技能强调以测试为保障的安全、增量变更。）

> "Refactoring is the process of changing a software system in such a way that it does not alter the external behavior of the code yet improves its internal structure." — Martin Fowler
> （"重构是在不改变代码外部行为的情况下改善其内部结构的过程。"——Martin Fowler）

## Core Principles（核心原则）

1. **Behavior Preservation（行为保持）**: External behavior must remain unchanged（外部行为必须保持不变）
2. **Small Steps（小步前进）**: Make tiny, testable changes（做出微小、可测试的变更）
3. **Test-Driven（测试驱动）**: Tests are the safety net（测试是安全网）
4. **Continuous（持续进行）**: Refactoring is ongoing, not a one-time event（重构是持续性的，不是一次性事件）
5. **Collaborative（协作）**: User approval required at each phase（每个阶段都需要用户批准）

## Workflow Overview（工作流程概览）

```
Phase 1: Research & Analysis（阶段 1：研究与分析）
    ↓
Phase 2: Test Coverage Assessment（阶段 2：测试覆盖率评估）
    ↓
Phase 3: Code Smell Identification（阶段 3：代码异味识别）
    ↓
Phase 4: Refactoring Plan Creation（阶段 4：重构计划制定）
    ↓
Phase 5: Incremental Implementation（阶段 5：增量实施）
    ↓
Phase 6: Review & Iteration（阶段 6：审查与迭代）
```

---

## Phase 1: Research & Analysis（阶段 1：研究与分析）

### Objectives（目标）
- Understand the codebase structure and purpose（理解代码库结构和目的）
- Identify the scope of refactoring（确定重构范围）
- Gather context about business requirements（收集业务需求背景）

### Questions to Ask User（需向用户确认的问题）
Before starting, clarify:（开始前需澄清：）

1. **Scope（范围）**: Which files/modules/functions need refactoring?（哪些文件/模块/函数需要重构？）
2. **Goals（目标）**: What problems are you trying to solve? (readability, performance, maintainability)（你试图解决什么问题？可读性、性能、可维护性）
3. **Constraints（约束）**: Are there any areas that should NOT be changed?（有哪些领域不应被更改？）
4. **Timeline pressure（时间压力）**: Is this blocking other work?（这是否阻塞其他工作？）
5. **Test status（测试状态）**: Do tests exist? Are they passing?（测试存在吗？通过了吗？）

### Actions（行动）
- [ ] Read and understand the target code（阅读并理解目标代码）
- [ ] Identify dependencies and integrations（识别依赖和集成）
- [ ] Document current architecture（记录当前架构）
- [ ] Note any existing technical debt markers (TODOs, FIXMEs)（记录现有技术债务标记）

### Output（输出）
Present findings to user:（向用户呈现发现：）
- Code structure summary（代码结构概要）
- Identified problem areas（已识别的问题领域）
- Initial recommendations（初步建议）
- **Request approval to proceed（请求批准继续）**

---

## Phase 2: Test Coverage Assessment（阶段 2：测试覆盖率评估）

### Why Tests Matter（为何测试重要）
> "Refactoring without tests is like driving without a seatbelt." — Martin Fowler
> （"没有测试的重构就像开车不系安全带。"——Martin Fowler）

Tests are the **key enabler** of safe refactoring. Without them, you risk introducing bugs.
（测试是安全重构的**关键保障**。没有测试，你可能会引入 bug。）

### Assessment Steps（评估步骤）

1. **Check for existing tests（检查现有测试）**
   ```bash
   # 查找测试文件
   find . -name "*test*" -o -name "*spec*" | head -20
   ```

2. **Run existing tests（运行现有测试）**
   ```bash
   # JavaScript/TypeScript
   npm test

   # Python
   pytest -v

   # Java
   mvn test
   ```

3. **Check coverage (if available)（检查覆盖率，如有）**
   ```bash
   # JavaScript
   npm run test:coverage

   # Python
   pytest --cov=.
   ```

### Decision Point: Ask User（决策点：询问用户）

**If tests exist and pass（如测试存在且通过）：**
- Proceed to Phase 3（继续阶段 3）

**If tests are missing or incomplete（如测试缺失或不完整）：**
Present options:（呈现选项：）
1. Write tests first (recommended)（先写测试（推荐））
2. Add tests incrementally during refactoring（在重构期间增量添加测试）
3. Proceed without tests (risky - requires user acknowledgment)（无测试继续（有风险——需要用户确认））

**If tests are failing（如测试失败）：**
- STOP. Fix failing tests before refactoring（停止。重构前先修复失败的测试）
- Ask user: Should we fix tests first?（问用户：是否应先修复测试？）

### Test Writing Guidelines (if needed)（测试编写指南（如需要））

For each function being refactored, ensure tests cover:（对每个被重构的函数，确保测试覆盖：）
- Happy path (normal operation)（正常路径（正常操作））
- Edge cases (empty inputs, null, boundaries)（边界情况（空输入、null、边界））
- Error scenarios (invalid inputs, exceptions)（错误场景（无效输入、异常））

Use the "red-green-refactor" cycle:（使用"红-绿-重构"循环：）
1. Write failing test (red)（编写失败的测试（红））
2. Make it pass (green)（让它通过（绿））
3. Refactor（重构）

---

## Phase 3: Code Smell Identification（阶段 3：代码异味识别）

### What Are Code Smells?（什么是代码异味？）
Symptoms of deeper problems in code. They're not bugs, but indicators that the code could be improved.
（代码深层问题的症状。它们不是 bug，而是代码可以改进的信号。）

### Common Code Smells to Check（需检查的常见代码异味）

See [references/code-smells.md](references/code-smells.md) for the complete catalog.
（完整目录请参见 [references/code-smells.md](references/code-smells.md)。）

#### Quick Reference（快速参考）

| Smell（异味） | Signs（迹象） | Impact（影响） |
|-------|-------|--------|
| **Long Method（长方法）** | Methods > 30-50 lines（方法超过 30-50 行） | Hard to understand, test, maintain（难以理解、测试、维护） |
| **Duplicated Code（重复代码）** | Same logic in multiple places（多处相同逻辑） | Bug fixes needed in multiple places（多处需要修复 bug） |
| **Large Class（大类）** | Class with too many responsibilities（承担过多职责的类） | Violates Single Responsibility（违反单一职责） |
| **Feature Envy（特性依恋）** | Method uses another class's data more（方法更多使用另一个类的数据） | Poor encapsulation（封装性差） |
| **Primitive Obsession（原始类型痴迷）** | Overuse of primitives instead of objects（过度使用原始类型而非对象） | Missing domain concepts（缺少领域概念） |
| **Long Parameter List（长参数列表）** | Methods with 4+ parameters（4 个以上参数的方法） | Hard to call correctly（难以正确调用） |
| **Data Clumps（数据泥团）** | Same data items appearing together（相同数据项一起出现） | Missing abstraction（缺少抽象） |
| **Switch Statements（Switch 语句）** | Complex switch/if-else chains（复杂的 switch/if-else 链） | Hard to extend（难以扩展） |
| **Speculative Generality（夸夸其谈的未来化）** | Code "just in case"（"以防万一"的代码） | Unnecessary complexity（不必要的复杂性） |
| **Dead Code（死代码）** | Unused code（未使用的代码） | Confusion, maintenance burden（混淆、维护负担） |

### Analysis Steps（分析步骤）

1. **Automated Analysis (if scripts available)（自动化分析，如有脚本）**
   ```bash
   python scripts/detect-smells.py <file>
   ```

2. **Manual Review（手动审查）**
   - Walk through code systematically（系统地遍历代码）
   - Note each smell with location and severity（记录每个异味的地点和严重性）
   - Categorize by impact (Critical/High/Medium/Low)（按影响分类）

3. **Prioritization（优先级排序）**
   Focus on smells that:（专注于以下异味：）
   - Block current development（阻塞当前开发）
   - Cause bugs or confusion（导致 bug 或混淆）
   - Affect most-changed code paths（影响最频繁变更的代码路径）

### Output: Smell Report（输出：异味报告）

Present to user:（向用户呈现：）
- List of identified smells with locations（已识别异味的列表及位置）
- Severity assessment for each（每个异味的严重性评估）
- Recommended priority order（推荐的优先级顺序）
- **Request approval on priorities（请求批准优先级）**

---

## Phase 4: Refactoring Plan Creation（阶段 4：重构计划制定）

### Selecting Refactorings（选择重构方法）

For each smell, select an appropriate refactoring from the catalog.
（对于每个异味，从目录中选择合适的重构方法。）

See [references/refactoring-catalog.md](references/refactoring-catalog.md) for the complete list.
（完整列表请参见 [references/refactoring-catalog.md](references/refactoring-catalog.md)。）

#### Smell-to-Refactoring Mapping（异味到重构方法的映射）

| Code Smell（代码异味） | Recommended Refactoring(s)（推荐的重构方法） |
|------------|---------------------------|
| Long Method（长方法） | Extract Method, Replace Temp with Query（提取方法，用查询替代临时变量） |
| Duplicated Code（重复代码） | Extract Method, Pull Up Method, Form Template Method（提取方法，提升方法，形成模板方法） |
| Large Class（大类） | Extract Class, Extract Subclass（提取类，提取子类） |
| Feature Envy（特性依恋） | Move Method, Move Field（移动方法，移动字段） |
| Primitive Obsession（原始类型痴迷） | Replace Primitive with Object, Replace Type Code with Class（用对象替代原始类型，用类替代类型代码） |
| Long Parameter List（长参数列表） | Introduce Parameter Object, Preserve Whole Object（引入参数对象，保留整个对象） |
| Data Clumps（数据泥团） | Extract Class, Introduce Parameter Object（提取类，引入参数对象） |
| Switch Statements（Switch 语句） | Replace Conditional with Polymorphism（用多态替代条件） |
| Speculative Generality（夸夸其谈的未来化） | Collapse Hierarchy, Inline Class, Remove Dead Code（折叠层次，内联类，删除死代码） |
| Dead Code（死代码） | Remove Dead Code（删除死代码） |

### Plan Structure（计划结构）

Use the template at [templates/refactoring-plan.md](templates/refactoring-plan.md).
（使用 [templates/refactoring-plan.md](templates/refactoring-plan.md) 中的模板。）

For each refactoring:（对于每个重构：）
1. **Target（目标）**: What code will change（哪些代码将变更）
2. **Smell（异味）**: What problem it addresses（它解决什么问题）
3. **Refactoring（重构方法）**: Which technique to apply（应用哪种技术）
4. **Steps（步骤）**: Detailed micro-steps（详细的微步骤）
5. **Risks（风险）**: What could go wrong（可能出什么问题）
6. **Rollback（回滚）**: How to undo if needed（如需要如何回滚）

### Phased Approach（分阶段方法）

**CRITICAL（关键）**: Introduce refactoring gradually in phases.
（**关键**：分阶段逐步引入重构。）

**Phase A: Quick Wins（阶段 A：快速见效）**（低风险、高价值）
- Rename variables for clarity（重命名变量以提高清晰度）
- Extract obvious duplicate code（提取明显的重复代码）
- Remove dead code（删除死代码）

**Phase B: Structural Improvements（阶段 B：结构改进）**（中等风险）
- Extract methods from long functions（从长方法中提取方法）
- Introduce parameter objects（引入参数对象）
- Move methods to appropriate classes（将方法移动到合适的类）

**Phase C: Architectural Changes（阶段 C：架构变更）**（较高风险）
- Replace conditionals with polymorphism（用多态替代条件）
- Extract classes（提取类）
- Introduce design patterns（引入设计模式）

### Decision Point: Present Plan to User（决策点：向用户呈现计划）

Before implementation:（实施前：）
- Show complete refactoring plan（展示完整的重构计划）
- Explain each phase and its risks（解释每个阶段及其风险）
- Get explicit approval for each phase（获得每个阶段的明确批准）
- **Ask**: "Should I proceed with Phase A?"（问）："是否继续阶段 A？"

---

## Phase 5: Incremental Implementation（阶段 5：增量实施）

### The Golden Rule（黄金法则）
> "Change → Test → Green? → Commit → Next step"
> （"变更 → 测试 → 绿灯？→ 提交 → 下一步"）

### Implementation Rhythm（实施节奏）

For each refactoring step:（对于每个重构步骤：）

1. **Pre-check（预检查）**
   - Tests are passing (green)（测试通过（绿灯））
   - Code compiles（代码编译通过）

2. **Make ONE small change（做出一个小变更）**
   - Follow the mechanics from the catalog（遵循目录中的步骤）
   - Keep changes minimal（保持变更最小化）

3. **Verify（验证）**
   - Run tests immediately（立即运行测试）
   - Check for compilation errors（检查编译错误）

4. **If tests pass (green)（如测试通过（绿灯））**
   - Commit with descriptive message（用描述性消息提交）
   - Move to next step（进入下一步）

5. **If tests fail (red)（如测试失败（红灯））**
   - STOP immediately（立即停止）
   - Undo the change（撤销变更）
   - Analyze what went wrong（分析哪里出了问题）
   - Ask user if unclear（如不清楚则询问用户）

### Commit Strategy（提交策略）

Each commit should be:（每次提交应：）
- **Atomic（原子性）**: One logical change（一个逻辑变更）
- **Reversible（可逆性）**: Easy to revert（易于回滚）
- **Descriptive（描述性）**: Clear commit message（清晰的提交信息）

Example commit messages:（示例提交信息：）
```
refactor: Extract calculateTotal() from processOrder()
refactor: Rename 'x' to 'customerCount' for clarity
refactor: Remove unused validateOldFormat() method
```

### Progress Reporting（进度报告）

After each sub-phase, report to user:（每个子阶段后向用户报告：）
- Changes made（做出的变更）
- Tests still passing?（测试仍然通过吗？）
- Any issues encountered（遇到的问题）
- **Ask**: "Continue with next batch?"（问）："继续下一批？"

---

## Phase 6: Review & Iteration（阶段 6：审查与迭代）

### Post-Refactoring Checklist（重构后清单）

- [ ] All tests passing（所有测试通过）
- [ ] No new warnings/errors（无新的警告/错误）
- [ ] Code compiles successfully（代码编译成功）
- [ ] Behavior unchanged (manual verification)（行为未变（手动验证））
- [ ] Documentation updated if needed（如需要则更新文档）
- [ ] Commit history is clean（提交历史整洁）

### Metrics Comparison（度量对比）

Run complexity analysis before and after:（运行变更前后的复杂度分析：）
```bash
python scripts/analyze-complexity.py <file>
```

Present improvements:（呈现改进：）
- Lines of code change（代码行数变化）
- Cyclomatic complexity change（圈复杂度变化）
- Maintainability index change（可维护性指数变化）

### User Review（用户审查）

Present final results:（呈现最终结果：）
- Summary of all changes（所有变更的概要）
- Before/after code comparison（变更前后代码对比）
- Metrics improvements（度量改进）
- Remaining technical debt（剩余技术债务）
- **Ask**: "Are you satisfied with these changes?"（问）："你对这些变更满意吗？"

### Next Steps（后续步骤）

Discuss with user:（与用户讨论：）
- Additional smells to address?（还有需要处理的异味吗？）
- Schedule follow-up refactoring?（安排后续重构？）
- Apply similar changes elsewhere?（在其他地方应用类似变更？）

---

## Important Guidelines（重要指南）

### When to STOP and Ask（何时停止并询问）

Always pause and consult user when:（以下情况务必暂停并咨询用户：）
- Unsure about business logic（对业务逻辑不确定）
- Change might affect external APIs（变更可能影响外部 API）
- Test coverage is inadequate（测试覆盖率不足）
- Significant architectural decision needed（需要重大架构决策）
- Risk level increases（风险等级增加）
- You encounter unexpected complexity（遇到意外复杂性）

### Safety Rules（安全规则）

1. **Never refactor without tests（绝不无测试重构）** (unless user explicitly acknowledges risk)（除非用户明确承认风险）
2. **Never make big changes（绝不做大变更）** - break into tiny steps（拆分为小步骤）
3. **Never skip the test run（绝不跳过测试运行）** after each change（每次变更后）
4. **Never continue if tests fail（绝不在测试失败时继续）** - fix or rollback first（先修复或回滚）
5. **Never assume（绝不假设）** - when in doubt, ask（有疑问时询问）

### What NOT to Do（不要做的事）

- Don't combine refactoring with feature additions（不要将重构与功能添加结合）
- Don't refactor during production emergencies（不要在生产紧急情况下重构）
- Don't refactor code you don't understand（不要重构你不理解的代码）
- Don't over-engineer - keep it simple（不要过度设计——保持简单）
- Don't refactor everything at once（不要一次性重构所有内容）

---

## Quick Start Example（快速入门示例）

### Scenario: Long Method with Duplication（场景：带有重复的长方法）

**Before（之前）：**
```javascript
function processOrder(order) {
  // 150 lines of code with:
  // - Duplicated validation logic
  // - Inline calculations
  // - Mixed responsibilities
}
```

**Refactoring Steps（重构步骤）：**

1. **Ensure tests exist（确保测试存在）** for processOrder()
2. **Extract（提取）** validation into validateOrder()
3. **Test（测试）** - should pass（应通过）
4. **Extract（提取）** calculation into calculateOrderTotal()
5. **Test（测试）** - should pass（应通过）
6. **Extract（提取）** notification into notifyCustomer()
7. **Test（测试）** - should pass（应通过）
8. **Review（审查）** - processOrder() now orchestrates 3 clear functions（现在协调 3 个清晰的函数）

**After（之后）：**
```javascript
function processOrder(order) {
  validateOrder(order);
  const total = calculateOrderTotal(order);
  notifyCustomer(order, total);
  return { order, total };
}
```

---

## References（参考资料）

- [Code Smells Catalog](references/code-smells.md)（代码异味目录） - Complete list of code smells（完整的代码异味列表）
- [Refactoring Catalog](references/refactoring-catalog.md)（重构目录） - Refactoring techniques（重构技术）
- [Refactoring Plan Template](templates/refactoring-plan.md)（重构计划模板） - Planning template（计划模板）

## Scripts（脚本）

- `scripts/analyze-complexity.py` - Analyze code complexity metrics（分析代码复杂度度量）
- `scripts/detect-smells.py` - Automated smell detection（自动化异味检测）

## Version History（版本历史）

- v1.0.0 (2025-01-15): Initial release with Fowler methodology, phased approach, user consultation points（初始版本，包含 Fowler 方法论、分阶段方法和用户协商点）
