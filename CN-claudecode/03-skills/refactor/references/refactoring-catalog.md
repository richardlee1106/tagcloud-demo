# 重构目录

精选自 Martin Fowler 所著《重构》（第 2 版）的重构技术集合。每个重构都包含动机、分步步骤和示例。

> "重构由其步骤定义——执行变更所要遵循的精确顺序。" — Martin Fowler

---

## 如何使用此目录

1. **识别异味** 使用代码异味参考
2. **在目录中找到匹配的重构方法**
3. **分步遵循步骤**
4. **每个步骤后测试** 确保行为保持不变

**黄金法则**：如果任何步骤超过 10 分钟，将其拆分为更小的步骤。

---

## 最常见的重构方法

### Extract Method（提取方法）

**When to use（何时使用）**: Long method, duplicate code, need to name a concept（长方法、重复代码、需要为一个概念命名）

**Motivation（动机）**: Turn a code fragment into a method whose name explains the purpose.（将代码片段转换为名称能解释其目的的方法。）

**Mechanics（步骤）：**
1. 创建一个以方法做什么命名的新方法（不是怎么做）
2. 将代码片段复制到新方法中
3. 扫描片段中使用的局部变量
4. 将局部变量作为参数传递（或在方法中声明）
5. 适当处理返回值
6. 用对新方法的调用替换原始片段
7. 测试

**Before（之前）：**
```javascript
function printOwing(invoice) {
  let outstanding = 0;

  console.log("***********************");
  console.log("**** Customer Owes ****");
  console.log("***********************");

  // Calculate outstanding
  for (const order of invoice.orders) {
    outstanding += order.amount;
  }

  // Print details
  console.log(`name: ${invoice.customer}`);
  console.log(`amount: ${outstanding}`);
}
```

**After（之后）：**
```javascript
function printOwing(invoice) {
  printBanner();
  const outstanding = calculateOutstanding(invoice);
  printDetails(invoice, outstanding);
}

function printBanner() {
  console.log("***********************");
  console.log("**** Customer Owes ****");
  console.log("***********************");
}

function calculateOutstanding(invoice) {
  return invoice.orders.reduce((sum, order) => sum + order.amount, 0);
}

function printDetails(invoice, outstanding) {
  console.log(`name: ${invoice.customer}`);
  console.log(`amount: ${outstanding}`);
}
```

---

### Inline Method（内联方法）

**When to use（何时使用）**: Method body is as clear as its name, excessive delegation（方法体和方法名一样清晰，过度委托）

**Motivation（动机）**: Remove needless indirection when the method doesn't add value.（当方法不增加价值时，移除不必要的间接层。）

**Mechanics（步骤）：**
1. 检查方法不是多态的
2. 找到对该方法的所有调用
3. 将每个调用替换为方法体
4. 每次替换后测试
5. 删除方法定义

**Before（之前）：**
```javascript
function getRating(driver) {
  return moreThanFiveLateDeliveries(driver) ? 2 : 1;
}

function moreThanFiveLateDeliveries(driver) {
  return driver.numberOfLateDeliveries > 5;
}
```

**After（之后）：**
```javascript
function getRating(driver) {
  return driver.numberOfLateDeliveries > 5 ? 2 : 1;
}
```

---

### Extract Variable（提取变量）

**When to use（何时使用）**: Complex expression that is hard to understand（难以理解的复杂表达式）

**Motivation（动机）**: Give a name to a piece of a complex expression.（为复杂表达式的一部分命名。）

**Mechanics（步骤）：**
1. 确保表达式无副作用
2. 声明一个不可变变量
3. 将其设置为表达式（或部分）的结果
4. 用变量替换原始表达式
5. 测试

**Before（之前）：**
```javascript
return order.quantity * order.itemPrice -
  Math.max(0, order.quantity - 500) * order.itemPrice * 0.05 +
  Math.min(order.quantity * order.itemPrice * 0.1, 100);
```

**After（之后）：**
```javascript
const basePrice = order.quantity * order.itemPrice;
const quantityDiscount = Math.max(0, order.quantity - 500) * order.itemPrice * 0.05;
const shipping = Math.min(basePrice * 0.1, 100);
return basePrice - quantityDiscount + shipping;
```

---

### Inline Variable（内联变量）

**When to use（何时使用）**: Variable name doesn't communicate more than the expression（变量名不比表达式传达更多信息）

**Motivation（动机）**: Remove unnecessary indirection.（移除不必要的间接层。）

**Mechanics（步骤）：**
1. 检查右侧无副作用
2. 如果变量不是不可变的，先使其不可变并测试
3. 找到第一个引用并用表达式替换
4. 测试
5. 对所有引用重复
6. 删除声明和赋值
7. 测试

---

### Rename Variable（重命名变量）

**When to use（何时使用）**: Name doesn't clearly communicate purpose（名称不能清晰传达目的）

**Motivation（动机）**: Good names are crucial for clean code.（好名称对干净代码至关重要。）

**Mechanics（步骤）：**
1. 如果变量广泛使用，考虑封装
2. 找到所有引用
3. 更改每个引用
4. 测试

**Tips（提示）：**
- Use intention-revealing names（使用揭示意图的名称）
- Avoid abbreviations（避免缩写）
- Use domain terminology（使用领域术语）

```javascript
// 差
const d = 30;
const x = users.filter(u => u.a);

// 好
const daysSinceLastLogin = 30;
const activeUsers = users.filter(user => user.isActive);
```

---

### Change Function Declaration（改变函数声明）

**When to use（何时使用）**: Function name doesn't explain purpose, parameters need change（函数名不解释目的，需要更改参数）

**Motivation（动机）**: Good function names make code self-documenting.（好函数名使代码自文档化。）

**Mechanics (Simple)（步骤（简单版））：**
1. 移除不需要的参数
2. 更改名称
3. 添加需要的参数
4. 测试

**Mechanics (Migration - for complex changes)（步骤（迁移版——用于复杂变更））：**
1. 如果移除参数，确保它未被使用
2. 用期望的声明创建新函数
3. 让旧函数调用新函数
4. 测试
5. 更改调用者使用新函数
6. 每次后测试
7. 删除旧函数

**Before（之前）：**
```javascript
function circum(radius) {
  return 2 * Math.PI * radius;
}
```

**After（之后）：**
```javascript
function circumference(radius) {
  return 2 * Math.PI * radius;
}
```

---

### Encapsulate Variable（封装变量）

**When to use（何时使用）**: Direct access to data from multiple places（从多处直接访问数据）

**Motivation（动机）**: Provide a clear access point for data manipulation.（为数据操作提供清晰的访问点。）

**Mechanics（步骤）：**
1. 创建 getter 和 setter 函数
2. 找到所有引用
3. 用 getter 替换读取
4. 用 setter 替换写入
5. 每次变更后测试
6. 限制变量的可见性

**Before（之前）：**
```javascript
let defaultOwner = { firstName: "Martin", lastName: "Fowler" };

// Used in many places
spaceship.owner = defaultOwner;
```

**After（之后）：**
```javascript
let defaultOwnerData = { firstName: "Martin", lastName: "Fowler" };

function defaultOwner() { return defaultOwnerData; }
function setDefaultOwner(arg) { defaultOwnerData = arg; }

spaceship.owner = defaultOwner();
```

---

### Introduce Parameter Object（引入参数对象）

**When to use（何时使用）**: Several parameters that frequently go together（几个经常一起出现的参数）

**Motivation（动机）**: Group data that naturally belongs together.（将自然属于一起的数据分组。）

**Mechanics（步骤）：**
1. 为分组的参数创建一个新类/结构
2. 测试
3. 用 Change Function Declaration 添加新对象
4. 测试
5. 对于组中的每个参数，从函数中移除它并使用新对象
6. 每次后测试

**Before（之前）：**
```javascript
function amountInvoiced(startDate, endDate) { ... }
function amountReceived(startDate, endDate) { ... }
function amountOverdue(startDate, endDate) { ... }
```

**After（之后）：**
```javascript
class DateRange {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

function amountInvoiced(dateRange) { ... }
function amountReceived(dateRange) { ... }
function amountOverdue(dateRange) { ... }
```

---

### Combine Functions into Class（将函数组合成类）

**When to use（何时使用）**: Several functions operate on the same data（几个函数操作相同数据）

**Motivation（动机）**: Group functions with the data they operate on.（将函数与它们操作的数据分组。）

**Mechanics（步骤）：**
1. 对公共数据应用 Encapsulate Record
2. 将每个函数移动到类中
3. 每次移动后测试
4. 用类字段的使用替换数据参数

**Before（之前）：**
```javascript
function base(reading) { ... }
function taxableCharge(reading) { ... }
function calculateBaseCharge(reading) { ... }
```

**After（之后）：**
```javascript
class Reading {
  constructor(data) { this._data = data; }

  get base() { ... }
  get taxableCharge() { ... }
  get calculateBaseCharge() { ... }
}
```

---

### Split Phase（拆分阶段）

**When to use（何时使用）**: Code deals with two different things（代码处理两件不同的事）

**Motivation（动机）**: Separate code into distinct phases with clear boundaries.（将代码分离为有明显边界的不同阶段。）

**Mechanics（步骤）：**
1. 为第二阶段创建第二个函数
2. 测试
3. 在阶段之间引入中间数据结构
4. 测试
5. 将第一阶段提取到自己的函数中
6. 测试

**Before（之前）：**
```javascript
function priceOrder(product, quantity, shippingMethod) {
  const basePrice = product.basePrice * quantity;
  const discount = Math.max(quantity - product.discountThreshold, 0)
    * product.basePrice * product.discountRate;
  const shippingPerCase = (basePrice > shippingMethod.discountThreshold)
    ? shippingMethod.discountedFee : shippingMethod.feePerCase;
  const shippingCost = quantity * shippingPerCase;
  return basePrice - discount + shippingCost;
}
```

**After（之后）：**
```javascript
function priceOrder(product, quantity, shippingMethod) {
  const priceData = calculatePricingData(product, quantity);
  return applyShipping(priceData, shippingMethod);
}

function calculatePricingData(product, quantity) {
  const basePrice = product.basePrice * quantity;
  const discount = Math.max(quantity - product.discountThreshold, 0)
    * product.basePrice * product.discountRate;
  return { basePrice, quantity, discount };
}

function applyShipping(priceData, shippingMethod) {
  const shippingPerCase = (priceData.basePrice > shippingMethod.discountThreshold)
    ? shippingMethod.discountedFee : shippingMethod.feePerCase;
  const shippingCost = priceData.quantity * shippingPerCase;
  return priceData.basePrice - priceData.discount + shippingCost;
}
```

---

## Moving Features（移动功能）

### Move Method（移动方法）

**When to use（何时使用）**: Method uses more features of another class than its own（方法使用另一个类的功能比自己的还多）

**Motivation（动机）**: Put functions with the data they use most.（将函数放到它们最常使用的数据处。）

**Mechanics（步骤）：**
1. 检查方法在其类中使用的所有程序元素
2. 检查方法是否是多态的
3. 将方法复制到目标类
4. 调整以适应新上下文
5. 让原始方法委托给目标
6. 测试
7. 考虑删除原始方法

---

### Move Field（移动字段）

**When to use（何时使用）**: Field is used more by another class（字段被另一个类更多地使用）

**Motivation（动机）**: Keep data with the functions that use it.（将数据与使用它的函数放在一起。）

**Mechanics（步骤）：**
1. 如果字段尚未封装，先封装它
2. 测试
3. 在目标中创建字段
4. 更新引用使用目标字段
5. 测试
6. 删除原始字段

---

### Move Statements into Function（将语句移入函数）

**When to use（何时使用）**: Same code always appears with a function call（相同代码总是随函数调用出现）

**Motivation（动机）**: Remove duplication by moving repeated code into the function.（通过将重复代码移入函数来消除重复。）

**Mechanics（步骤）：**
1. 如果尚未，将重复代码提取为函数
2. 将语句移入该函数
3. 测试
4. 如果调用者不再需要独立语句，删除它们

---

### Move Statements to Callers（将语句移至调用者）

**When to use（何时使用）**: Common behavior varies between callers（公共行为在调用者之间不同）

**Motivation（动机）**: When behavior needs to differ, move it out of the function.（当行为需要不同时，将其移出函数。）

**Mechanics（步骤）：**
1. 对要移动的代码使用 Extract Method
2. 对原始函数使用 Inline Method
3. 删除现在被内联的调用
4. 将提取的代码移动到每个调用者
5. 测试

---

## Organizing Data（组织数据）

### Replace Primitive with Object（用对象替代原始类型）

**When to use（何时使用）**: Data item needs more behavior than simple value（数据项需要比简单值更多的行为）

**Motivation（动机）**: Encapsulate data with its behavior.（将数据与其行为封装。）

**Mechanics（步骤）：**
1. 应用 Encapsulate Variable
2. 创建一个简单的值类
3. 更改 setter 创建新实例
4. 更改 getter 返回值
5. 测试
6. 向新类添加更丰富的行为

**Before（之前）：**
```javascript
class Order {
  constructor(data) {
    this.priority = data.priority; // string: "high", "rush", etc.
  }
}

// Usage
if (order.priority === "high" || order.priority === "rush") { ... }
```

**After（之后）：**
```javascript
class Priority {
  constructor(value) {
    if (!Priority.legalValues().includes(value))
      throw new Error(`Invalid priority: ${value}`);
    this._value = value;
  }

  static legalValues() { return ['low', 'normal', 'high', 'rush']; }
  get value() { return this._value; }

  higherThan(other) {
    return Priority.legalValues().indexOf(this._value) >
           Priority.legalValues().indexOf(other._value);
  }
}

// Usage
if (order.priority.higherThan(new Priority("normal"))) { ... }
```

---

### Replace Temp with Query（用查询替代临时变量）

**When to use（何时使用）**: Temporary variable holds result of an expression（临时变量保存表达式结果）

**Motivation（动机）**: Make the code clearer by extracting the expression into a function.（将表达式提取为函数使代码更清晰。）

**Mechanics（步骤）：**
1. 检查变量只被赋值一次
2. 将赋值的右侧提取为方法
3. 用方法调用替换对临时变量的引用
4. 测试
5. 删除临时变量声明和赋值

**Before（之前）：**
```javascript
const basePrice = this._quantity * this._itemPrice;
if (basePrice > 1000) {
  return basePrice * 0.95;
} else {
  return basePrice * 0.98;
}
```

**After（之后）：**
```javascript
get basePrice() {
  return this._quantity * this._itemPrice;
}

// In the method
if (this.basePrice > 1000) {
  return this.basePrice * 0.95;
} else {
  return this.basePrice * 0.98;
}
```

---

## Simplifying Conditional Logic（简化条件逻辑）

### Decompose Conditional（分解条件）

**When to use（何时使用）**: Complex conditional (if-then-else) statement（复杂条件（if-then-else）语句）

**Motivation（动机）**: Make the intention clear by extracting conditions and actions.（通过提取条件和动作使意图清晰。）

**Mechanics（步骤）：**
1. 对条件应用 Extract Method
2. 对 then 分支应用 Extract Method
3. 对 else 分支（如有）应用 Extract Method

**Before（之前）：**
```javascript
if (!aDate.isBefore(plan.summerStart) && !aDate.isAfter(plan.summerEnd)) {
  charge = quantity * plan.summerRate;
} else {
  charge = quantity * plan.regularRate + plan.regularServiceCharge;
}
```

**After（之后）：**
```javascript
if (isSummer(aDate, plan)) {
  charge = summerCharge(quantity, plan);
} else {
  charge = regularCharge(quantity, plan);
}

function isSummer(date, plan) {
  return !date.isBefore(plan.summerStart) && !date.isAfter(plan.summerEnd);
}

function summerCharge(quantity, plan) {
  return quantity * plan.summerRate;
}

function regularCharge(quantity, plan) {
  return quantity * plan.regularRate + plan.regularServiceCharge;
}
```

---

### Consolidate Conditional Expression（合并条件表达式）

**When to use（何时使用）**: Multiple conditions with the same result（多个条件有相同结果）

**Motivation（动机）**: Make it clear that conditions are a single check.（使条件明确为单一检查。）

**Mechanics（步骤）：**
1. 验证条件无副作用
2. 用 `and` 或 `or` 组合条件
3. 考虑对组合条件应用 Extract Method

**Before（之前）：**
```javascript
if (employee.seniority < 2) return 0;
if (employee.monthsDisabled > 12) return 0;
if (employee.isPartTime) return 0;
```

**After（之后）：**
```javascript
if (isNotEligibleForDisability(employee)) return 0;

function isNotEligibleForDisability(employee) {
  return employee.seniority < 2 ||
         employee.monthsDisabled > 12 ||
         employee.isPartTime;
}
```

---

### Replace Nested Conditional with Guard Clauses（用卫语句替代嵌套条件）

**When to use（何时使用）**: Deeply nested conditionals making flow hard to follow（深度嵌套的条件使流程难以跟踪）

**Motivation（动机）**: Use guard clauses for special cases, keeping normal flow clear.（对特殊情况使用卫语句，保持正常流程清晰。）

**Mechanics（步骤）：**
1. 找到特殊情况条件
2. 用提前返回的卫语句替换它们
3. 每次变更后测试

**Before（之前）：**
```javascript
function payAmount(employee) {
  let result;
  if (employee.isSeparated) {
    result = { amount: 0, reasonCode: "SEP" };
  } else {
    if (employee.isRetired) {
      result = { amount: 0, reasonCode: "RET" };
    } else {
      result = calculateNormalPay(employee);
    }
  }
  return result;
}
```

**After（之后）：**
```javascript
function payAmount(employee) {
  if (employee.isSeparated) return { amount: 0, reasonCode: "SEP" };
  if (employee.isRetired) return { amount: 0, reasonCode: "RET" };
  return calculateNormalPay(employee);
}
```

---

### Replace Conditional with Polymorphism（用多态替代条件）

**When to use（何时使用）**: Switch/case based on type, conditional logic varying by type（基于类型的 switch/case，按类型变化的 conditional 逻辑）

**Motivation（动机）**: Let objects handle their own behavior.（让对象处理它们自己的行为。）

**Mechanics（步骤）：**
1. 创建类层次结构（如不存在）
2. 使用 Factory Function 创建对象
3. 将条件逻辑移动到超类方法
4. 为每个 case 创建子类方法
5. 删除原始条件

**Before（之前）：**
```javascript
function plumages(birds) {
  return birds.map(b => plumage(b));
}

function plumage(bird) {
  switch (bird.type) {
    case 'EuropeanSwallow':
      return "average";
    case 'AfricanSwallow':
      return (bird.numberOfCoconuts > 2) ? "tired" : "average";
    case 'NorwegianBlueParrot':
      return (bird.voltage > 100) ? "scorched" : "beautiful";
    default:
      return "unknown";
  }
}
```

**After（之后）：**
```javascript
class Bird {
  get plumage() { return "unknown"; }
}

class EuropeanSwallow extends Bird {
  get plumage() { return "average"; }
}

class AfricanSwallow extends Bird {
  get plumage() {
    return (this.numberOfCoconuts > 2) ? "tired" : "average";
  }
}

class NorwegianBlueParrot extends Bird {
  get plumage() {
    return (this.voltage > 100) ? "scorched" : "beautiful";
  }
}

function createBird(data) {
  switch (data.type) {
    case 'EuropeanSwallow': return new EuropeanSwallow(data);
    case 'AfricanSwallow': return new AfricanSwallow(data);
    case 'NorwegianBlueParrot': return new NorwegianBlueParrot(data);
    default: return new Bird(data);
  }
}
```

---

### Introduce Special Case (Null Object)（引入特殊情况（Null 对象））

**When to use（何时使用）**: Repeated null checks for special cases（对特殊情况的重复 null 检查）

**Motivation（动机）**: Return a special object that handles the special case.（返回一个处理特殊情况特殊对象。）

**Mechanics（步骤）：**
1. 创建具有预期接口的特殊情况类
2. 添加 isSpecialCase 检查
3. 引入工厂方法
4. 用特殊情况对象使用替换 null 检查
5. 测试

**Before（之前）：**
```javascript
const customer = site.customer;
// ... many places checking
if (customer === "unknown") {
  customerName = "occupant";
} else {
  customerName = customer.name;
}
```

**After（之后）：**
```javascript
class UnknownCustomer {
  get name() { return "occupant"; }
  get billingPlan() { return registry.defaultPlan; }
}

// Factory method
function customer(site) {
  return site.customer === "unknown"
    ? new UnknownCustomer()
    : site.customer;
}

// Usage - no null checks needed
const customerName = customer.name;
```

---

## Refactoring APIs（重构 API）

### Separate Query from Modifier（将查询与修改器分离）

**When to use（何时使用）**: Function both returns a value and has side effects（函数既返回值又有副作用）

**Motivation（动机）**: Make it clear which operations have side effects.（明确哪些操作有副作用。）

**Mechanics（步骤）：**
1. 创建一个新的查询函数
2. 复制原始函数的返回逻辑
3. 修改原始函数返回 void
4. 替换使用返回值的调用
5. 测试

**Before（之前）：**
```javascript
function alertForMiscreant(people) {
  for (const p of people) {
    if (p === "Don") {
      setOffAlarms();
      return "Don";
    }
    if (p === "John") {
      setOffAlarms();
      return "John";
    }
  }
  return "";
}
```

**After（之后）：**
```javascript
function findMiscreant(people) {
  for (const p of people) {
    if (p === "Don") return "Don";
    if (p === "John") return "John";
  }
  return "";
}

function alertForMiscreant(people) {
  if (findMiscreant(people) !== "") setOffAlarms();
}
```

---

### Parameterize Function（参数化函数）

**When to use（何时使用）**: Several functions doing similar things with different values（几个函数用不同值做相似的事）

**Motivation（动机）**: Remove duplication by adding a parameter.（通过添加参数消除重复。）

**Mechanics（步骤）：**
1. 选择一个函数
2. 为变化的字面量添加参数
3. 更改体使用参数
4. 测试
5. 更改调用者使用参数化版本
6. 删除现在未使用的函数

**Before（之前）：**
```javascript
function tenPercentRaise(person) {
  person.salary = person.salary * 1.10;
}

function fivePercentRaise(person) {
  person.salary = person.salary * 1.05;
}
```

**After（之后）：**
```javascript
function raise(person, factor) {
  person.salary = person.salary * (1 + factor);
}

// Usage
raise(person, 0.10);
raise(person, 0.05);
```

---

### Remove Flag Argument（移除标志参数）

**When to use（何时使用）**: Boolean parameter that changes function behavior（改变函数行为的布尔参数）

**Motivation（动机）**: Make the behavior explicit through separate functions.（通过分离函数使行为明确。）

**Mechanics（步骤）：**
1. 为每个标志值创建显式函数
2. 将每个调用替换为相应的新函数
3. 每次变更后测试
4. 删除原始函数

**Before（之前）：**
```javascript
function bookConcert(customer, isPremium) {
  if (isPremium) {
    // premium booking logic
  } else {
    // regular booking logic
  }
}

bookConcert(customer, true);
bookConcert(customer, false);
```

**After（之后）：**
```javascript
function bookPremiumConcert(customer) {
  // premium booking logic
}

function bookRegularConcert(customer) {
  // regular booking logic
}

bookPremiumConcert(customer);
bookRegularConcert(customer);
```

---

## Dealing with Inheritance（处理继承）

### Pull Up Method（上提方法）

**When to use（何时使用）**: Same method in multiple subclasses（多个子类中相同的方法）

**Motivation（动机）**: Remove duplication in class hierarchy.（消除类层次结构中的重复。）

**Mechanics（步骤）：**
1. 检查方法确保它们相同
2. 检查签名相同
3. 在超类中创建新方法
4. 从一个子类复制体
5. 删除一个子类方法，测试
6. 删除其他子类方法，每次测试

---

### Push Down Method（下推方法）

**When to use（何时使用）**: Behavior relevant only to a subset of subclasses（行为仅与子类子集相关）

**Motivation（动机）**: Put method where it's used.（将方法放到使用它的地方。）

**Mechanics（步骤）：**
1. 将方法复制到需要它的每个子类
2. 从超类删除方法
3. 测试
4. 从不需要它的子类删除
5. 测试

---

### Replace Subclass with Delegate（用委托替代子类）

**When to use（何时使用）**: Inheritance is being used incorrectly, need more flexibility（继承使用不当，需要更多灵活性）

**Motivation（动机）**: Prefer composition over inheritance when appropriate.（适当情况下优先使用组合而非继承。）

**Mechanics（步骤）：**
1. 为委托创建空类
2. 在宿主类中添加持有委托的字段
3. 创建委托的构造函数，从宿主调用
4. 将功能移动到委托
5. 每次移动后测试
6. 用委托替换继承

---

## Extract Class（提取类）

**When to use（何时使用）**: Large class with multiple responsibilities（承担多个职责的大类）

**Motivation（动机）**: Split class to maintain single responsibility.（拆分类以保持单一职责。）

**Mechanics（步骤）：**
1. 决定如何拆分职责
2. 创建新类
3. 将字段从原始类移动到新类
4. 测试
5. 将方法从原始类移动到新类
6. 每次移动后测试
7. 审查并重命名两个类
8. 决定如何暴露新类

**Before（之前）：**
```javascript
class Person {
  get name() { return this._name; }
  set name(arg) { this._name = arg; }
  get officeAreaCode() { return this._officeAreaCode; }
  set officeAreaCode(arg) { this._officeAreaCode = arg; }
  get officeNumber() { return this._officeNumber; }
  set officeNumber(arg) { this._officeNumber = arg; }

  get telephoneNumber() {
    return `(${this._officeAreaCode}) ${this._officeNumber}`;
  }
}
```

**After（之后）：**
```javascript
class Person {
  constructor() {
    this._telephoneNumber = new TelephoneNumber();
  }
  get name() { return this._name; }
  set name(arg) { this._name = arg; }
  get telephoneNumber() { return this._telephoneNumber.toString(); }
  get officeAreaCode() { return this._telephoneNumber.areaCode; }
  set officeAreaCode(arg) { this._telephoneNumber.areaCode = arg; }
}

class TelephoneNumber {
  get areaCode() { return this._areaCode; }
  set areaCode(arg) { this._areaCode = arg; }
  get number() { return this._number; }
  set number(arg) { this._number = arg; }
  toString() { return `(${this._areaCode}) ${this._number}`; }
}
```

---

## Quick Reference: Smell to Refactoring（快速参考：异味到重构方法）

| Code Smell（代码异味） | Primary Refactoring（主要重构方法） | Alternative（替代方法） |
|------------|-------------------|-------------|
| Long Method（长方法） | Extract Method（提取方法） | Replace Temp with Query（用查询替代临时变量） |
| Duplicate Code（重复代码） | Extract Method（提取方法） | Pull Up Method（上提方法） |
| Large Class（大类） | Extract Class（提取类） | Extract Subclass（提取子类） |
| Long Parameter List（长参数列表） | Introduce Parameter Object（引入参数对象） | Preserve Whole Object（保留整个对象） |
| Feature Envy（特性依恋） | Move Method（移动方法） | Extract Method + Move（提取方法 + 移动） |
| Data Clumps（数据泥团） | Extract Class（提取类） | Introduce Parameter Object（引入参数对象） |
| Primitive Obsession（原始类型痴迷） | Replace Primitive with Object（用对象替代原始类型） | Replace Type Code（替代类型代码） |
| Switch Statements（Switch 语句） | Replace Conditional with Polymorphism（用多态替代条件） | Replace Type Code（替代类型代码） |
| Temporary Field（临时字段） | Extract Class（提取类） | Introduce Null Object（引入 Null 对象） |
| Message Chains（消息链） | Hide Delegate（隐藏委托） | Extract Method（提取方法） |
| Middle Man（中间人） | Remove Middle Man（移除中间人） | Inline Method（内联方法） |
| Divergent Change（发散式变更） | Extract Class（提取类） | Split Phase（拆分阶段） |
| Shotgun Surgery（霰弹式修改） | Move Method（移动方法） | Inline Class（内联类） |
| Dead Code（死代码） | Remove Dead Code（删除死代码） | - |
| Speculative Generality（夸夸其谈的未来化） | Collapse Hierarchy（折叠层次结构） | Inline Class（内联类） |

---

## Further Reading（延伸阅读）

- Fowler, M. (2018). *Refactoring: Improving the Design of Existing Code* (2nd ed.)
- Online catalog: https://refactoring.com/catalog/
