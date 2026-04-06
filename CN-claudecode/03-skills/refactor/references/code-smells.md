# 代码异味目录

基于 Martin Fowler 所著《重构：改善既有代码的设计》（第 2 版）的综合代码异味参考。代码异味是更深层问题的症状——它们表明代码设计可能存在问题。

> "代码异味是通常对应系统更深层问题的表面征兆。" — Martin Fowler

---

## 臃肿代码（Bloaters）

表示某些东西已经膨胀到无法有效处理的代码异味。

### Long Method（长方法）

**Signs（迹象）：**
- Method exceeds 30-50 lines（方法超过 30-50 行）
- Need to scroll to see the whole method（需要滚动才能看到整个方法）
- Multiple levels of nesting（多层嵌套）
- Comments explaining what sections do（注释解释各部分做什么）

**Why it's bad（为何不好）：**
- Hard to understand（难以理解）
- Difficult to test in isolation（难以独立测试）
- Changes have unintended consequences（变更有意外后果）
- Duplicate logic hides inside（重复逻辑隐藏在内部）

**Refactorings（重构方法）：**
- Extract Method（提取方法）
- Replace Temp with Query（用查询替代临时变量）
- Introduce Parameter Object（引入参数对象）
- Replace Method with Method Object（用方法对象替代方法）
- Decompose Conditional（分解条件）

**Example (Before)（示例（之前）：**
```javascript
function processOrder(order) {
  // 验证订单（20 行）
  if (!order.items) throw new Error('No items');
  if (order.items.length === 0) throw new Error('Empty order');
  // ... 更多验证

  // 计算总计（30 行）
  let subtotal = 0;
  for (const item of order.items) {
    subtotal += item.price * item.quantity;
  }
  // ... 税费、运费、折扣

  // 发送通知（20 行）
  // ... 邮件逻辑
}
```

**Example (After)（示例（之后）：**
```javascript
function processOrder(order) {
  validateOrder(order);
  const totals = calculateOrderTotals(order);
  sendOrderNotifications(order, totals);
  return { order, totals };
}
```

---

### Large Class（大类）

**Signs（迹象）：**
- Class has many instance variables (>7-10)（类有很多实例变量，>7-10）
- Class has many methods (>15-20)（类有很多方法，>15-20）
- Class name is vague (Manager, Handler, Processor)（类名模糊，如 Manager、Handler、Processor）
- Methods don't use all instance variables（方法未使用所有实例变量）

**Why it's bad（为何不好）：**
- Violates Single Responsibility Principle（违反单一职责原则）
- Hard to test（难以测试）
- Changes ripple through unrelated features（变更影响不相关功能）
- Difficult to reuse parts（难以复用部分）

**Refactorings（重构方法）：**
- Extract Class（提取类）
- Extract Subclass（提取子类）
- Extract Interface（提取接口）

**Detection（检测）：**
```
Lines of code > 300
Number of methods > 15
Number of fields > 10
```

---

### Primitive Obsession（原始类型痴迷）

**Signs（迹象）：**
- Using primitives for domain concepts (string for email, int for money)（对领域概念使用原始类型，如用字符串表示邮箱、用整数表示金额）
- Arrays of primitives instead of objects（用原始类型数组而非对象）
- String constants for type codes（用字符串常量表示类型代码）
- Magic numbers/strings（魔法数字/字符串）

**Why it's bad（为何不好）：**
- No validation at type level（类型级别无验证）
- Logic scattered across codebase（逻辑分散在整个代码库）
- Easy to pass wrong values（容易传递错误值）
- Missing domain concepts（缺少领域概念）

**Refactorings（重构方法）：**
- Replace Primitive with Object（用对象替代原始类型）
- Replace Type Code with Class（用类替代类型代码）
- Replace Type Code with Subclasses（用子类替代类型代码）
- Replace Type Code with State/Strategy（用状态/策略替代类型代码）

**Example (Before)（示例（之前）：**
```javascript
const user = {
  email: 'john@example.com',     // 只是个字符串
  phone: '1234567890',           // 只是个字符串
  status: 'active',              // 魔法字符串
  balance: 10050                 // 用整数表示美分
};
```

**Example (After)（示例（之后）：**
```javascript
const user = {
  email: new Email('john@example.com'),
  phone: new PhoneNumber('1234567890'),
  status: UserStatus.ACTIVE,
  balance: Money.cents(10050)
};
```

---

### Long Parameter List（长参数列表）

**Signs（迹象）：**
- Methods with 4+ parameters（4 个以上参数的方法）
- Parameters that always appear together（总是同时出现的参数）
- Boolean flags changing method behavior（改变方法行为的布尔标志）
- Null/undefined passed frequently（频繁传递 null/undefined）

**Why it's bad（为何不好）：**
- Hard to call correctly（难以正确调用）
- Parameter order confusion（参数顺序混淆）
- Indicates method doing too much（表明方法做了太多）
- Hard to add new parameters（难以添加新参数）

**Refactorings（重构方法）：**
- Introduce Parameter Object（引入参数对象）
- Preserve Whole Object（保留整个对象）
- Replace Parameter with Method Call（用方法调用替代参数）
- Remove Flag Argument（移除标志参数）

**Example (Before)（示例（之前）：**
```javascript
function createUser(firstName, lastName, email, phone,
                    street, city, state, zip,
                    isAdmin, isActive, createdBy) {
  // ...
}
```

**Example (After)（示例（之后）：**
```javascript
function createUser(personalInfo, address, options) {
  // personalInfo: { firstName, lastName, email, phone }
  // address: { street, city, state, zip }
  // options: { isAdmin, isActive, createdBy }
}
```

---

### Data Clumps（数据泥团）

**Signs（迹象）：**
- Same 3+ fields appear together repeatedly（相同的 3 个以上字段反复一起出现）
- Parameters that always travel together（总是一起传递的参数）
- Classes with field subsets belonging together（类中属于一起的字段子集）

**Why it's bad（为何不好）：**
- Duplicate handling logic（重复处理逻辑）
- Missing abstraction（缺少抽象）
- Harder to extend（难以扩展）
- Indicates hidden class（表明存在隐藏的类）

**Refactorings（重构方法）：**
- Extract Class（提取类）
- Introduce Parameter Object（引入参数对象）
- Preserve Whole Object（保留整个对象）

**Example（示例）：**
```javascript
// 数据泥团：(x, y, z) 坐标
function movePoint(x, y, z, dx, dy, dz) { }
function scalePoint(x, y, z, factor) { }
function distanceBetween(x1, y1, z1, x2, y2, z2) { }

// 提取 Point3D 类
class Point3D {
  constructor(x, y, z) { }
  move(delta) { }
  scale(factor) { }
  distanceTo(other) { }
}
```

---

## 面向对象滥用者（Object-Orientation Abusers）

表明 OOP 原则使用不完整或不正确的异味。

### Switch Statements（Switch 语句）

**Signs（迹象）：**
- Long switch/case or if/else chains（长的 switch/case 或 if/else 链）
- Same switch in multiple places（多处相同的 switch）
- Switch on type codes（对类型代码做 switch）
- Adding new cases requires changes everywhere（添加新分支需要到处修改）

**Why it's bad（为何不好）：**
- Violates Open/Closed Principle（违反开闭原则）
- Changes ripple to all switch locations（变更影响到所有 switch 位置）
- Hard to extend（难以扩展）
- Often indicates missing polymorphism（通常表明缺少多态）

**Refactorings（重构方法）：**
- Replace Conditional with Polymorphism（用多态替代条件）
- Replace Type Code with Subclasses（用子类替代类型代码）
- Replace Type Code with State/Strategy（用状态/策略替代类型代码）

**Example (Before)（示例（之前）：**
```javascript
function calculatePay(employee) {
  switch (employee.type) {
    case 'hourly':
      return employee.hours * employee.rate;
    case 'salaried':
      return employee.salary / 12;
    case 'commissioned':
      return employee.sales * employee.commission;
  }
}
```

**Example (After)（示例（之后）：**
```javascript
class HourlyEmployee {
  calculatePay() {
    return this.hours * this.rate;
  }
}

class SalariedEmployee {
  calculatePay() {
    return this.salary / 12;
  }
}
```

---

### Temporary Field（临时字段）

**Signs（迹象）：**
- Instance variables only used in some methods（仅在某些方法中使用的实例变量）
- Fields set conditionally（有条件设置的字段）
- Complex initialization for certain cases（某些情况的复杂初始化）

**Why it's bad（为何不好）：**
- Confusing—field exists but might be null（令人困惑——字段存在但可能为 null）
- Hard to understand object state（难以理解对象状态）
- Indicates conditional logic hiding（表明存在隐藏的条件逻辑）

**Refactorings（重构方法）：**
- Extract Class（提取类）
- Introduce Null Object（引入 Null 对象）
- Replace Temp Field with Local（用局部变量替代临时字段）

---

### Refused Bequest（拒绝遗赠）

**Signs（迹象）：**
- Subclass doesn't use inherited methods/data（子类不使用继承的方法/数据）
- Subclass overrides to do nothing（子类覆盖但什么都不做）
- Inheritance used for code reuse, not IS-A relationship（继承用于代码复用而非 IS-A 关系）

**Why it's bad（为何不好）：**
- Wrong abstraction（错误的抽象）
- Violates Liskov Substitution Principle（违反里氏替换原则）
- Misleading hierarchy（误导性层次结构）

**Refactorings（重构方法）：**
- Push Down Method/Field（下推方法/字段）
- Replace Subclass with Delegate（用委托替代子类）
- Replace Inheritance with Delegation（用委托替代继承）

---

### Alternative Classes with Different Interfaces（不同接口的替代类）

**Signs（迹象）：**
- Two classes that do similar things（两个做相似事情的类）
- Different method names for same concept（同一概念有不同方法名）
- Could be used interchangeably（本可以互换使用）

**Why it's bad（为何不好）：**
- Duplicate implementations（重复实现）
- No common interface（无公共接口）
- Hard to switch between（难以切换）

**Refactorings（重构方法）：**
- Rename Method（重命名方法）
- Move Method（移动方法）
- Extract Superclass（提取超类）
- Extract Interface（提取接口）

---

## 变更阻碍者（Change Preventers）

使变更困难的异味——变更一处需要变更多处。

### Divergent Change（发散式变更）

**Signs（迹象）：**
- One class changed for multiple different reasons（一个类因多个不同原因被修改）
- Changes in different areas trigger same class edits（不同领域的变更触发同一类的编辑）
- Class is a "God class"（类是"上帝类"）

**Why it's bad（为何不好）：**
- Violates Single Responsibility（违反单一职责）
- High change frequency（变更频率高）
- Merge conflicts（合并冲突）

**Refactorings（重构方法）：**
- Extract Class（提取类）
- Extract Superclass（提取超类）
- Extract Subclass（提取子类）

**Example（示例）：**
A `User` class changes for:（`User` 类因以下原因变更：）
- Authentication changes（认证变更）
- Profile changes（资料变更）
- Billing changes（账单变更）
- Notification changes（通知变更）

→ Extract（提取）：`AuthService`、`ProfileService`、`BillingService`、`NotificationService`

---

### Shotgun Surgery（霰弹式修改）

**Signs（迹象）：**
- One change requires edits in many classes（一次变更需要在很多类中编辑）
- Small feature needs touching 10+ files（小功能需要修改 10+ 个文件）
- Changes are scattered, hard to find all（变更分散，难以找全）

**Why it's bad（为何不好）：**
- Easy to miss a spot（容易遗漏一处）
- High coupling（高耦合）
- Changes are error-prone（变更容易出错）

**Refactorings（重构方法）：**
- Move Method（移动方法）
- Move Field（移动字段）
- Inline Class（内联类）

**Detection（检测）：**
Look for: adding one field requires changes in >5 files.
（查找：添加一个字段需要在 >5 个文件中变更。）

---

### Parallel Inheritance Hierarchies（并行继承层次结构）

**Signs（迹象）：**
- Creating subclass in one hierarchy requires subclass in another（在一个层次结构中创建子类需要在另一个中创建子类）
- Class prefixes match (e.g., `DatabaseOrder`, `DatabaseProduct`)（类前缀匹配，如 `DatabaseOrder`、`DatabaseProduct`）

**Why it's bad（为何不好）：**
- Double the maintenance（维护工作量翻倍）
- Coupling between hierarchies（层次结构间耦合）
- Easy to forget one side（容易忘记一边）

**Refactorings（重构方法）：**
- Move Method（移动方法）
- Move Field（移动字段）
- Eliminate one hierarchy（消除一个层次结构）

---

## 可有可无者（Dispensables）

不必要且应被移除的东西。

### Comments (Excessive)（过度注释）

**Signs（迹象）：**
- Comments explaining what code does（解释代码做什么的注释）
- Commented-out code（被注释掉的代码）
- TODO/FIXME that linger forever（永久存在的 TODO/FIXME）
- Apologies in comments（注释中的道歉）

**Why it's bad（为何不好）：**
- Comments lie (get out of sync)（注释会撒谎（不同步））
- Code should be self-documenting（代码应该自文档化）
- Dead code causes confusion（死代码导致混淆）

**Refactorings（重构方法）：**
- Extract Method (name explains what)（提取方法（名称解释做什么））
- Rename (clarity without comments)（重命名（无需注释的清晰性））
- Remove commented code（删除被注释的代码）
- Introduce Assertion（引入断言）

**Good vs Bad Comments（好注释 vs 差注释）：**
```javascript
// 差：解释做什么
// Loop through users and check if active
for (const user of users) {
  if (user.status === 'active') { }
}

// 好：解释为什么
// Active users only - inactive are handled by cleanup job
const activeUsers = users.filter(u => u.isActive);
```

---

### Duplicate Code（重复代码）

**Signs（迹象）：**
- Same code in multiple places（多处相同的代码）
- Similar code with small variations（有微小变化的相似代码）
- Copy-paste patterns（复制粘贴模式）

**Why it's bad（为何不好）：**
- Bug fixes needed in multiple places（需要在多处修复 bug）
- Inconsistency risk（不一致风险）
- Bloated codebase（代码库膨胀）

**Refactorings（重构方法）：**
- Extract Method（提取方法）
- Extract Class（提取类）
- Pull Up Method（在层次结构中上提方法）
- Form Template Method（形成模板方法）

**Detection Rule（检测规则）：**
Any code duplicated 3+ times should be extracted.
（重复 3 次以上的代码应被提取。）

---

### Lazy Class（懒汉类）

**Signs（迹象）：**
- Class doesn't do enough to justify existence（类做的事情不足以证明其存在合理）
- Wrapper with no added value（没有增加值的包装器）
- Result of over-engineering（过度工程的结果）

**Why it's bad（为何不好）：**
- Maintenance overhead（维护开销）
- Unnecessary indirection（不必要的间接层）
- Complexity without benefit（有复杂性但无好处）

**Refactorings（重构方法）：**
- Inline Class（内联类）
- Collapse Hierarchy（折叠层次结构）

---

### Dead Code（死代码）

**Signs（迹象）：**
- Unreachable code（不可达代码）
- Unused variables/methods/classes（未使用的变量/方法/类）
- Commented-out code（被注释掉的代码）
- Code behind impossible conditions（不可能条件后的代码）

**Why it's bad（为何不好）：**
- Confusion（混淆）
- Maintenance burden（维护负担）
- Slows down understanding（拖慢理解速度）

**Refactorings（重构方法）：**
- Remove Dead Code（删除死代码）
- Safe Delete（安全删除）

**Detection（检测）：**
```bash
# 查找未使用的导出
# 查找未引用的函数
# IDE "unused" 警告
```

---

### Speculative Generality（夸夸其谈的未来化）

**Signs（迹象）：**
- Abstract classes with one subclass（只有一个子类的抽象类）
- Unused parameters "for future use"（为"未来使用"保留的未使用参数）
- Methods that only delegate（仅做委托的方法）
- "Framework" for one use case（为一个用例准备的"框架"）

**Why it's bad（为何不好）：**
- Complexity without benefit（有复杂性但无好处）
- YAGNI (You Ain't Gonna Need It)（你不会需要它）
- Harder to understand（更难理解）

**Refactorings（重构方法）：**
- Collapse Hierarchy（折叠层次结构）
- Inline Class（内联类）
- Remove Parameter（移除参数）
- Rename Method（重命名方法）

---

## 耦合者（Couplers）

表示类之间过度耦合的异味。

### Feature Envy（特性依恋）

**Signs（迹象）：**
- Method uses more data from another class than its own（方法使用另一个类的数据比自己的还多）
- Many getter calls to another object（对另一个对象的大量 getter 调用）
- Data and behavior are separated（数据和行为分离）

**Why it's bad（为何不好）：**
- Wrong location for behavior（行为位置错误）
- Poor encapsulation（封装性差）
- Hard to maintain（难以维护）

**Refactorings（重构方法）：**
- Move Method（移动方法）
- Move Field（移动字段）
- Extract Method (then move)（提取方法（然后移动））

**Example (Before)（示例（之前）：**
```javascript
class Order {
  getDiscountedPrice(customer) {
    // 大量使用 customer 的数据
    if (customer.loyaltyYears > 5) {
      return this.price * customer.discountRate;
    }
    return this.price;
  }
}
```

**Example (After)（示例（之后）：**
```javascript
class Customer {
  getDiscountedPriceFor(price) {
    if (this.loyaltyYears > 5) {
      return price * this.discountRate;
    }
    return price;
  }
}
```

---

### Inappropriate Intimacy（不适当的亲密）

**Signs（迹象）：**
- Classes access each other's private parts（类访问彼此的私有部分）
- Bidirectional references（双向引用）
- Subclasses know too much about parents（子类对父类了解太多）

**Why it's bad（为何不好）：**
- High coupling（高耦合）
- Changes cascade（变更级联）
- Hard to modify one without other（难以修改一个而不影响另一个）

**Refactorings（重构方法）：**
- Move Method（移动方法）
- Move Field（移动字段）
- Change Bidirectional to Unidirectional（将双向改为单向）
- Extract Class（提取类）
- Hide Delegate（隐藏委托）

---

### Message Chains（消息链）

**Signs（迹象）：**
- Long chains of method calls（长的方法调用链）：`a.getB().getC().getD().getValue()`
- Client depends on navigation structure（客户端依赖导航结构）
- "Train wreck" code（"火车残骸"代码）

**Why it's bad（为何不好）：**
- Fragile—any change breaks chain（脆弱——任何变更都会破坏链）
- Violates Law of Demeter（违反得墨忒耳定律）
- Coupling to structure（与结构耦合）

**Refactorings（重构方法）：**
- Hide Delegate（隐藏委托）
- Extract Method（提取方法）
- Move Method（移动方法）

**Example（示例）：**
```javascript
// 差：消息链
const managerName = employee.getDepartment().getManager().getName();

// 更好：隐藏委托
const managerName = employee.getManagerName();
```

---

### Middle Man（中间人）

**Signs（迹象）：**
- Class that only delegates to another（仅委托给另一个的类）
- Half the methods are delegations（一半方法是委托）
- No added value（没有增加价值）

**Why it's bad（为何不好）：**
- Unnecessary indirection（不必要的间接层）
- Maintenance overhead（维护开销）
- Confusing architecture（令人困惑的架构）

**Refactorings（重构方法）：**
- Remove Middle Man（移除中间人）
- Inline Method（内联方法）

---

## Smell Severity Guide（异味严重性指南）

| Severity（严重性） | Description（描述） | Action（行动） |
|----------|-------------|--------|
| **Critical（严重）** | Blocks development, causes bugs（阻塞开发，导致 bug） | Fix immediately（立即修复） |
| **High（高）** | Significant maintenance burden（重大维护负担） | Fix in current sprint（当前 sprint 中修复） |
| **Medium（中）** | Noticeable but manageable（明显但可管理） | Plan for near future（计划在近期修复） |
| **Low（低）** | Minor inconvenience（轻微不便） | Fix opportunistically（顺便修复） |

---

## Quick Detection Checklist（快速检测清单）

Use this checklist when scanning code:（扫描代码时使用此清单：）

- [ ] 是否有方法超过 30 行？
- [ ] 是否有类超过 300 行？
- [ ] 是否有方法超过 4 个参数？
- [ ] 是否有重复的代码块？
- [ ] 是否有基于类型代码的 switch/case？
- [ ] 是否有未使用的代码？
- [ ] 是否有方法大量使用另一个类的数据？
- [ ] 是否有长的方法调用链？
- [ ] 是否有解释"是什么"而非"为什么"的注释？
- [ ] 是否有应该是对象的原始类型？

---

## Further Reading（延伸阅读）

- Fowler, M. (2018). *Refactoring: Improving the Design of Existing Code* (2nd ed.)
- Kerievsky, J. (2004). *Refactoring to Patterns*
- Feathers, M. (2004). *Working Effectively with Legacy Code*
