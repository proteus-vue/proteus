# 鸿蒙设计哲学的系统性吸收

> **定位**：不是罗列鸿蒙特性，而是**迁移四个设计范式**到 Proteus 方法论。
> **对应原则**：#0 第七次泛化（不绑内存管理范式）+ #13.21~#13.24

---

## 1. 为什么是鸿蒙，而不是其他

鸿蒙不是"又一个移动 OS"，它是**第一个把"一次开发多端部署"写进内核设计的商用系统**。
这和 Proteus 的目标高度重合，所以它的设计决策对我们有直接参考价值——
不是抄 API，是学**它在面对同样问题时怎么权衡**。

**四个值得迁移的范式：**

```
① ArkTS 的「限制换能力」      → Proteus Safe Subset（PSS）
② Stage/Ability 生命周期标准化 → G-42 容器生命周期的官方实现
③ 元服务 / 原子化服务          → G-42 AtomicService 容器形态
④ 分布式软总线                → Owned<T>.transferToDevice()
```

---

## 2. 范式①：ArkTS 的「限制换能力」—— 最重要的一个

### 2.1 鸿蒙做了什么

ArkTS 是 TypeScript 的**受限超集**。它主动禁止了一批动态特性：

| ArkTS 禁止的特性 | 具体限制 |
|-----------------|---------|
| `any` / `unknown` | 必须显式类型 |
| structural typing | 必须用 nominal typing |
| 对象动态增删属性 | 属性必须在类型声明中 |
| 解构赋值的部分场景 | 限制对象解构 |
| 部分闭包捕获 | 限制捕获变量的修改 |
| `delete` 操作符 | 禁止动态删除属性 |

### 2.2 换来了什么

```
静态类型完备 → 完整类型推导
对象布局稳定 → AOT 编译可行
作用域可分析 → 更激进的编译优化
```

**代价**：表达力受限，部分 JS 生态代码不兼容。
**收益**：性能数量级提升 + 静态可分析性。

### 2.3 我们的迁移：Proteus Safe Subset（PSS）

**核心洞察**：
> 借用检查做不完备，不是因为"JS"，是因为"动态 JS"。
> 在受限子集内，静态分析是可以完备的。

这与 ArkTS 的权衡**完全同构**：

| | ArkTS | Proteus PSS |
|--|-------|-------------|
| 放弃 | 部分动态表达力 | 部分动态表达力 |
| 换来 | AOT 编译能力 | **编译期完备的借用检查** |
| 可选性 | 全量强制 | **模块级可选**（`off`/`loose`/`strict`） |

### 2.4 PSS 的三级模式

```ts
// page.config.ts
export default definePageConfig({
  safeSubset: 'strict'    // 'off' | 'loose' | 'strict'
})
```

| 模式 | 限制内容 | 借用检查保证 |
|------|---------|-------------|
| `off` | 无 | 运行时兜底 |
| `loose` | 禁 `any`、禁动态属性增删 | 覆盖主路径 |
| **`strict`** | 完整 PSS 限制 | **编译期完备** ✅ |

### 2.5 PSS strict 的完整限制清单

```ts
// ✅ 允许
const buf: Owned<ArrayBuffer> = pageContext.alloc(size)
const view = buf.borrow()          // 借用，作用域内有效
buf.transferTo(other)              // Move
if (cond) { buf.drop() }           // 条件释放

// ❌ 禁止（strict 模式编译期报错）
const x: any = buf                 // 禁 any
buf['dynamicProp'] = 1             // 禁动态属性
delete buf.size                    // 禁 delete
window.__cache = buf               // 禁逃逸到全局
store.hold(buf)                    // 禁跨页面强持有
setTimeout(() => buf.read(), 0)    // 禁闭包捕获 Owned（除非显式 borrow）
const f = eval('buf.read')         // 禁 eval
```

### 2.6 这个迁移解决了什么

我上一版 G-43 草案里承认：

> "JS 无法做完整的编译期借用检查 —— 闭包、动态属性、eval 都会逃逸。
> 我们的策略是编译期覆盖主路径 + 运行时兜底。"

**引入 PSS 后，这句话被修正为：**

> **PSS strict 内：编译期完备。**
> **PSS 外：运行时兜底 + 100% 可观测。**
> **分层保证，模块自主选择。**

**这是本轮最有价值的一个吸收** —— 它把一个"做不到"变成了"分场景做到"。

---

## 3. 范式②：Stage / Ability 生命周期标准化

### 3.1 鸿蒙做了什么

鸿蒙 Stage 模型把应用组件生命周期**标准化**：

```
AbilityStage（应用级）
  └─ UIAbility（任务级）
       ├─ onCreate → onWindowStageCreate → onForeground
       ├─ onBackground → onWindowStageDestroy → onDestroy
       └─ ExtensionAbility（服务级：卡片/输入法/后台任务）
```

**关键设计**：生命周期是**契约**，不是实现。
任何组件（Ability / Extension / 元服务）都遵守同一套状态机。

### 3.2 我们的迁移

G-42 定义了 `HostContainer` SPI（6 种容器形态）。
鸿蒙的 Stage 模型可以直接映射为**其中一个官方实现**：

| 鸿蒙概念 | Proteus 对应 |
|---------|-------------|
| AbilityStage | `SuperAppContainer`（G-42） |
| UIAbility | `StackContainer` 内的一个业务 |
| ExtensionAbility | 宿主注册的后台能力 |
| WindowStage | 宿主的根视图容器 |
| 生命周期状态机 | G-42 页面生命周期契约 |

**价值**：G-42 的容器生命周期契约不再是"我们自己拍脑袋定的"，
而是**与一个商用 OS 的成熟模型对齐** —— 这提高了设计的可信度，
也让鸿蒙团队出身的开发者能零成本理解。

### 3.3 具体映射表

| 鸿蒙生命周期 | Proteus 页面状态 | 触发的资源动作 |
|-------------|-----------------|---------------|
| `onCreate` | `created` | 初始化所有权上下文 |
| `onWindowStageCreate` | `mounted` | 分配边界资源 |
| `onForeground` | `resumed` | 恢复借用依赖 |
| `onBackground` | `suspended` | 释放可重建资源（保留 Owned） |
| `onWindowStageDestroy` | `unmounting` | **五原子销毁** |
| `onDestroy` | `destroyed` | 归还配额 |

---

## 4. 范式③：元服务 / 原子化服务

### 4.1 鸿蒙做了什么

元服务（Atomic Service）的核心特性：

```
• 免安装（无需显式安装，即点即用）
• 可分可合（一个元服务可被多个宿主组合）
• 跨设备流转（在手机/平板/车机间无缝迁移）
• 轻量化（包体积有严格上限）
```

**设计本质**：把"应用"这个单位**拆细**到"服务"粒度。

### 4.2 我们的迁移

G-42 的容器形态从 6 种扩展到 **7 种**，新增：

```
┌─ AtomicService ────────────────────┐
│ 免安装：由宿主按需加载               │
│ 可分可合：多个元服务组合成一个页面    │
│ 轻量化：有资源配额硬上限             │
│ 可流转：所有权可跨设备转移            │
└────────────────────────────────────┘
```

**与 G-42 SuperAppContainer 的关系**：

```
SuperAppContainer
  ├─ 业务 A（常规，完整能力）
  ├─ 业务 B（常规）
  └─ ★ 元服务区（AtomicService 集合）
       ├─ 支付元服务（轻、有配额上限）
       ├─ 登录元服务
       └─ 分享元服务
```

元服务享受**更严格的沙箱和配额**（G-42 已定义的机制），
只是粒度更细、生命周期更短。

---

## 5. 范式④：分布式软总线 —— ★ 最锋利的一个

### 5.1 鸿蒙做了什么

分布式软总线让设备间可以**无缝协同**：

```
手机上的视频 → 流转到 TV 继续播放
手机编辑的文档 → 流转到平板继续编辑
```

### 5.2 传统跨设备的做法（及其问题）

```js
// 传统：在 B 设备"重新加载一遍"
deviceB.load('player', { videoId: 'xxx', position: 0 })

// 问题：
// 1. 状态丢失（播放进度要从头算）
// 2. 资源重建（重新解码、重新缓冲）
// 3. 用户感知到"重新开始"
```

**本质**：跨设备是"复制"，不是"迁移"。

### 5.3 我们的迁移：跨设备所有权转移

有了所有权模型，跨设备流转可以变成**所有权转移**：

```ts
// Proteus：所有权转移（状态不丢、资源不重建）
const buf: Owned<ArrayBuffer> = pageA.ownedBuffer

await buf.transferToDevice('deviceB')
//  ↓ 三件事原子发生
//  1. 底层字节通过分布式通道迁移
//  2. 原设备自动 drop（Move 语义，原所有者不可再访问）
//  3. 目标设备接管 Owner 身份，无需重建
```

### 5.4 为什么这是 Move 语义的分布式版本

回忆 Rust 的 Move：

```rust
let a = String::from("hello");
let b = a;              // 所有权转移
// println!("{}", a);   // ❌ 编译错误：use after move
```

跨设备转移是**同一个语义**，只是作用域从"同一进程"扩展到"跨设备"：

| | Rust Move | 跨设备 Move |
|--|-----------|-------------|
| 转移对象 | 栈上/堆上值 | 底层字节 + Owner 身份 |
| 转移后原所有者 | 不可访问（编译期） | 不可访问（编译期 + 运行时） |
| 资源是否重建 | 否 | **否** ← 关键差异 |
| 状态是否保留 | 是 | **是** |

### 5.5 接口设计

```ts
interface Owned<T> {
  // ... 同进程操作

  /** 跨设备所有权转移 */
  transferToDevice(deviceId: string): Promise<
    | { ok: true;  remoteHandle: RemoteHandle<T> }
    | { ok: false; error: DeviceTransferError }
  >

  /** 跨设备借用（只读，原设备保留所有权） */
  borrowAcrossDevice(deviceId: string): Promise<BorrowedRemote<T>>
}

type DeviceTransferError =
  | { code: 'device_unreachable' }
  | { code: 'quota_exceeded'; limit: number }
  | { code: 'resource_not_transferable'; reason: string }
```

### 5.6 关键约束

```
1. 并非所有资源都可转移
   → 与设备强绑定的（摄像头句柄、传感器流）不可转移
   → 返回 resource_not_transferable，而非静默失败

2. 转移是原子的
   → 要么完全成功（原设备 drop + 目标设备接管）
   → 要么完全失败（原设备保持所有权）
   → 不存在"两边都有"或"两边都没有"的中间态

3. 失败必须可观测
   → 返回 Result<T>，禁止抛异常（对齐 G-32 Result 范式）
```

---

## 6. 四个范式的内在一致性

看起来是四个独立特性，其实是**同一个设计哲学的四个表现**：

```
鸿蒙的核心哲学：
  「通过标准化和限制，换取跨设备/跨形态的一致性能力」

  ① 限制换能力    → 限制表达力，换取静态可分析性（AOT / 借用检查）
  ② 生命周期标准化 → 统一契约，换取容器可替换
  ③ 元服务        → 拆细粒度，换取可分可合
  ④ 分布式软总线  → 统一抽象，换取跨设备一致性
```

**这与 Proteus 的方法论同构：**

```
Proteus 的核心哲学（原则 #0）：
  「定义与平台无关的语义层，让一切平台差异成为后端实现细节」

  → 不绑平台 API / 渲染引擎 / 编译器 / 执行载体 / 宿主 / 容器
  → ★ 现在：不绑内存管理范式（G-43）
```

**两者都是「用约束换能力」** ——
鸿蒙用约束换跨设备一致性，Proteus 用约束换跨端可插拔。

---

## 7. 对方法论文档的更新建议

`PROTEUS-METHODOLOGY.md` 建议增补一节：

> ### 方法论的外部印证：鸿蒙
>
> Proteus 的「约束换能力」思路并非孤例。
> 鸿蒙 ArkTS 通过限制 TS 动态特性换取 AOT 编译能力，
> Stage 模型通过标准化生命周期换取容器可替换性，
> 分布式软总线通过统一抽象换取跨设备一致性。
>
> **这与原则 #0「统一语义收敛」是同一设计哲学的不同投影。**
> 鸿蒙在 OS 层验证过的路径，Proteus 在框架层复现。

---

## 8. 诚实边界

| 限制 | 说明 |
|------|------|
| **PSS 借鉴的是思路不是清单** | ArkTS 的限制清单针对 AOT 优化，PSS 针对借用检查，两者目标不同，限制项不完全重合 |
| **跨设备转移为接口定义 + 模拟验证** | 真实分布式通道依赖宿主实现，本轮未做真机验证 |
| **元服务容器是 G-42 的增量** | 需 G-42 落地后才能实现，本轮只定义形态 |
| **鸿蒙映射表是我们的解读** | 非鸿蒙官方对应关系，实际接入时需以官方文档为准 |

---

**版本**：v1.0
**日期**：2026-09-03
**状态**：已落地
