# 00 · 架构总览与能力等级

## 1. 要解决的核心痛点

主流跨端框架常用“条件编译”：

```js
// ❌ 业务代码中随处可见
#ifdef MP-WEIXIN
wx.login()
#elif defined(H5)
window.location.href = '/login'
#endif
```

**短期方便，长期代价：**

1. 业务逻辑与平台判断混杂，文件内多分支膨胀
2. 一个能力改行为，需要全局搜索所有 `#ifdef`
3. 回归困难：很难知道“哪个平台的分支被改坏了”
4. AI 无法安全重构：条件分支不可预测
5. 新平台加入 = 全量业务代码再补分支

---

## 2. Proteus 的方案定位

> **不是“抽象全部平台能力”，而是“抽象能力的接入方式”。**

- 框架只承诺：
  - 能力的**存在形式**（接口）
  - 能力的**获取方式**（Adapter）
  - 能力的**失败方式**（降级/错误）
- 不承诺：
  - 所有平台行为 100% 一致
  - 所有原生 API 都能映射

---

## 3. 架构分层

```
L4 业务代码
    └── 只使用 capability / useCapability()

L3 标准能力 API（@proteus-vue/capabilities）
    └── login / payment / share / biometrics / clipboard ...

L2 Adapter 层（platforms/* + adapters/*）
    └── WebAdapter / SkylineAdapter / AppAdapter

L1 平台原生能力
    └── wx.* / window.* / Native Bridge
```

---

## 4. 核心概念

### 4.1 Capability（能力）

一个能力 = 一个明确接口 + 元数据：

```ts
interface Capability<T> {
  id: string                 // 'login.wechat'
  name: string               // '微信登录'
  platforms: PlatformSet
  version?: string
  required?: boolean         // 缺失时是否阻断
  fallback?: Capability<any> // 降级能力
}
```

### 4.2 Adapter（适配器）

```ts
interface Adapter<C extends Capability> {
  capability: C['id']
  platform: Platform
  isSupported(): boolean | Promise<boolean>
  create(): C['api']
}
```

### 4.3 业务调用方式（目标形态）

```ts
// ✅ 业务代码：无任何平台判断
const login = useCapability('login.wechat')

if (!login.isSupported()) {
  // 框架保证此处是明确“能力缺失”，不是平台判断
  return fallbackUI()
}

await login.signIn()
```

---

## 5. 能力等级（Capability Tiers）

| 等级 | 含义 | 策略 |
|------|------|------|
| **L1 通用能力** | 三端都有 | 直接统一 API |
| **L2 映射能力** | 行为近似，需适配 | Adapter 对齐 |
| **L3 平台独占** | 仅某平台有 | 明确不支持 / 降级 |
| **L4 实验能力** | 不稳定 / 新 API | 显式 opt-in |

---

## 6. 铁律（不可违反）

1. **业务目录禁止平台判断语句**
2. **平台代码只存在于 `platforms/*` 与 `adapters/*`**
3. **能力必须可探测（feature detection > platform detection）**
4. **缺失能力必须可降级或显式失败**
5. **每个能力必须有跨平台回归用例**
6. **编译产物必须可追溯：能力 → 平台 → adapter → 源码**

---

## 7. 与已有层的关系

| 层 | 职责 | 与本计划关系 |
|----|------|--------------|
| Pinia | 状态 | 可存 capability 状态 |
| Router | 路由 | 可依赖 capability（如登录） |
| API | 网络/设备 | 本身是 capability 的子集 |
| Component | UI | 消费 capability |

---

## 8. 里程碑

| 阶段 | 内容 |
|------|------|
| M1 | Capability 契约 |
| M2 | Adapter 注册中心 |
| M3 | 编译期分叉 |
| M4 | 运行时降级 |
| M5 | 平台原生模块规范 |
| M7 | 可靠性与性能 |
| M8 | 可观测与审计 |
| M9 | 回归测试 + CI |

---

## 9. 不做的事（明确排除）

- ❌ 提供 `#ifdef` 语法
- ❌ 承诺 100% 行为一致
- ❌ 自动 polyfill 所有原生 API
- ❌ 在业务代码中生成平台分支代码（黑盒）
