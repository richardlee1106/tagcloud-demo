# 代码审查发现问题模板

在代码审查过程中记录每个问题时使用此模板。

---

## 问题：[标题]

### 严重性
- [ ] Critical（阻塞部署）
- [ ] High（合并前应修复）
- [ ] Medium（应尽快修复）
- [ ] Low（锦上添花）

### 类别
- [ ] Security（安全）
- [ ] Performance（性能）
- [ ] Code Quality（代码质量）
- [ ] Maintainability（可维护性）
- [ ] Testing（测试）
- [ ] Design Pattern（设计模式）
- [ ] Documentation（文档）

### 位置
**文件：** `src/components/UserCard.tsx`

**行号：** 45-52

**函数/方法：** `renderUserDetails()`

### 问题描述

**是什么：** 描述问题是什么。

**为何重要：** 解释影响以及为何需要修复。

**当前行为：** 展示有问题的代码或行为。

**预期行为：** 描述应该怎样。

### 代码示例

#### 当前（有问题的）

```typescript
// 展示了 N+1 查询问题
const users = fetchUsers();
users.forEach(user => {
  const posts = fetchUserPosts(user.id); // 每个用户一次查询！
  renderUserPosts(posts);
});
```

#### 建议的修复

```typescript
// 使用 JOIN 查询优化
const usersWithPosts = fetchUsersWithPosts();
usersWithPosts.forEach(({ user, posts }) => {
  renderUserPosts(posts);
});
```

### 影响分析

| 方面 | 影响 | 严重性 |
|--------|--------|----------|
| 性能 | 20 个用户产生 100+ 次查询 | High |
| 用户体验 | 页面加载缓慢 | High |
| 可扩展性 | 无法规模化 | Critical |
| 可维护性 | 难以调试 | Medium |

### 相关问题

- `AdminUserList.tsx` 第 120 行有类似问题
- 相关 PR: #456
- 相关 issue: #789

### 额外资源

- [N+1 查询问题](https://en.wikipedia.org/wiki/N%2B1_problem)
- [数据库 JOIN 文档](https://docs.example.com/joins)
- [性能优化指南](./docs/performance.md)

### 审查者备注

- 这是此代码库中的常见模式
- 考虑添加到代码风格指南中
- 也许值得创建一个辅助函数

### 作者反馈（供反馈用）

*由代码作者填写：*

- [ ] 在提交 `abc123` 中实现修复
- [ ] 修复状态：已完成 / 进行中 / 需要讨论
- [ ] 问题或顾虑：（描述）

---

## 发现统计（供审查者用）

在审查多个发现时，追踪：

- **发现的问题总数：** X
- **Critical：** X
- **High：** X
- **Medium：** X
- **Low：** X

**建议：** ✅ 批准 / ⚠️ 请求修改 / 🔄 需要讨论

**整体代码质量：** 1-5 星
