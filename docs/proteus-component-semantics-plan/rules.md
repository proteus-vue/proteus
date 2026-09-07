# G-31 规则：组件与 API 语义铁律

> 配套 `G-31-component-api-semantics.md`，进规约铁律总表。

---

## 原则归属

**原则 #0（统一语义收敛，PROTEUS-METHODOLOGY）** —— 具体化至"开发者书写面（组件与 API）"：

> 框架暴露给开发者的每一个组件与 API，都必须先定义语义（Component IR / Hook 接口），再交由各端 Backend 实现；**禁止将任何既有平台的组件名、属性名、API 形态直接上升为框架标准。**

---

## 铁律

### G-31.1 语义命名（核心）

> 所有内置组件必须以 **`p-` 前缀 + 语义名词**命名，且不得与小程序/HTML 组件同名。

- ✅ `<p-grid>` `<p-stack>` `<p-button>`
- ❌ `<view>` `<scroll-view>` `<swiper>`（属兼容层，不得进入 Layer 0）

**判定**：CI 扫描组件注册表，发现无 `p-` 前缀或非语义命名 → 报错。

### G-31.2 属性可降级（对齐 G-30.4）

> 每一个组件属性都必须声明其在各 Tier 下的降级行为（supported / fallback / unsupported）。

- 属性缺失降级声明 → Compiler 报 `PROP_NO_DEGRADATION`
- Tier 2/3/4 端缺能力 → 编译期通过 `@conditional` 裁剪

### G-31.3 异步即 Promise（对齐支柱 ③）

> Layer 0 所有 API 必须返回 `Promise`（或 Hook 封装），禁止回调式 / 全局对象式 API。

- ❌ `wx.xxx({ success, fail })`
- ❌ `uni.xxx(cb)`
- ✅ `await useNative().scanQR()`

**判定**：CI lint 规则 `no-callback-api`。

### G-31.4 组件进入 L1 须多端验证（对齐 G-28.3）

> 新组件进 L1（框架内置）前，须有 **≥3 端真实 Backend 实现**通过 conformance test。

- 两端实现 → L2（独立包）
- 单端实现 → L3（实验）

---

## 代码层规则（CMP005 ~ CMP008）

| 编号 | 触发条件 | 处置 |
|------|---------|------|
| **CMP005** | 业务代码直接使用平台 SDK（AVCapture / CameraX / wx.xxx） | 必须改为 `useNative()`（G-28.1 协同） |
| **CMP006** | 组件属性未声明降级 / capabilities | 编译期 `PROP_NO_DEGRADATION` |
| **CMP007** | 引入回调式 API 到 Layer 0 | lint 阻断 |
| **CMP008** | 组件 L1 但不足 3 端 conformance | 降级至 L2，禁止合入 core |

---

## 与既有规则的协同

| 本规则 | 依赖 | 关系 |
|--------|------|------|
| G-31.1 | 原则 #0 | 具体化 |
| G-31.2 | G-30.3（capabilities）、G-30.4（降级） | 复用降级机制 |
| G-31.3 | G-28.1（一律走 useNative） | API 形态一致 |
| G-31.4 | G-28.3（≥3 端验证）、G-27 conformance | 同一验收标准 |
| CMP005 | G-28.1 | 同一约束（入口侧） |
| CMP006 | G-30.3 | capabilities 机制复用 |

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | G-31.1~4 + CMP005~8 首次落地 |
