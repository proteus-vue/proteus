# G-31 附录：从小程序组件/API 迁移到 Proteus 语义

> 配套 `G-31-component-api-semantics.md` §6（分层：Layer 0 原生 / Layer 1 兼容）。

---

## 1. 迁移总原则

> **不是"一次性重写"，而是"compat 层兜底 + codemod 逐步替换 + 新代码用原生语义"。**

类比：TypeScript 迁移 JS（`allowJs` → 逐步 `.ts`）。

---

## 2. 组件迁移对照（自动 codemod 可覆盖 70%）

| 小程序 | Proteus 语义 | 迁移方式 |
|--------|-------------|---------|
| `<view>` | `<p-box>` | codemod 自动 |
| `<view class="grid">` | `<p-grid>` | 需识别布局意图（AI 辅助） |
| `<text>` | `<p-text>` | codemod 自动 |
| `<button>` | `<p-button>` | codemod 自动 |
| `<image>` | `<p-image>` | codemod 自动 |
| `<scroll-view>` | `<p-scroll-view>` | **codemod 自动**（★2026-09-19：端对齐批次 2 已把官方属性 40/40 全量透传 → 真 1:1；`<p-stack direction>` 仅为可选的进一步语义精炼） |
| `<swiper>` | `<p-stack direction="row" snap="mandatory" loop>` | 语义识别（★2026-09-19 `snap`/`loop` 已落地；MP 端降级为普通排列 + 可观察提示） |
| `<movable-view>` | `<p-draggable>` | codemod 自动（G-32 G8 已落地） |
| `<input>` | `<p-input>` | codemod 自动 |
| `<list>` / `<recycle-view>` | `<p-list>`（内置虚拟化） | codemod + 验证 |

**关键差异**：`<swiper>` 不是 1:1 替换，而是**语义还原为布局原语**——这是"组件语义化"的必然（G-31 §2.2）。
`<scroll-view>` 属**平台语义 1:1**：`<p-scroll-view>` 是官方组件的薄透传包装（属性同名、事件同名载荷归一），迁移无需人工判断方向/翻页意图。

---

## 3. API 迁移对照（codemod 自动覆盖 90%）

| 小程序 | Proteus | 说明 |
|--------|---------|------|
| `wx.request({...})` | `await useFetch(url)` | awaitify |
| `wx.navigateTo({url})` | `router.push({name, params})` | 路由名表：`proteus migrate mp` 自动产出 name 候选（**kebab，与 gen-routes 产物同名**） |
| `wx.setStorage(k,v)` | `useStorage()` | 响应式 |
| `wx.scanCode({success})` | `await native.scanQR()` | awaitify |
| `wx.login()` | `await auth.login()` | 链路合并 |

codemod 工具：`proteus-migrate`（计划内，见 `batches.md` B4）。

---

## 4. 三步迁移流程

```
Step 1：装 compat 层，旧代码原样跑通
        npm i @proteus-vue/compat-miniprogram   （plan 文档原名 @proteus/compat-miniprogram——组织 scope 收口）
        → 全部 wx.xxx 可用（bindCompatPlatform(createPlatformAPI()) + createWxCompat）

Step 2：跑 codemod，批量转原生语义
        npx proteus migrate mp <file|dir> [--dry-run]
        → 标签自动（view→p-box 等 13 个 1:1，含 scroll-view→p-scroll-view）+ 同步存储直改（→useStorage）
          + 回调式 API/语义识别标签 manual 标注 + 路由名表产出（kebab name，与 gen-routes 产物同名）
          （70-90% 自动转换，已落地 @proteus-vue/compat-miniprogram migrateMpSource）

Step 3：人工处理剩余（swiper 轮播语义 + 能力 reason）
        → 完成
```

---

## 5. 不能自动迁移的部分（需人工）

| 场景 | 原因 | 处理 |
|------|------|------|
| `swiper` → 轮播语义 | 无 1:1 组件，需识别「一维排列 + 吸附 + 循环」意图 | 人工决策或 AI Agent（G-23）辅助——目标形态 `<p-stack direction="row" snap="mandatory" loop>`（★2026-09-19 属性已落地） |
| 自定义原生插件 | 散落在业务 | 封装为 Backend（G-28） |
| 平台特有 ifdef | 违背 G-30.1 | 改为 `@conditional` |

> ★**已解决（2026-09-19）**：原表列的 `scroll-view → p-stack`（需理解布局意图）与「字符串 URL → 命名路由（需先建表）」
> 两项已不再是人工项——前者由 `<p-scroll-view>` 1:1 自动替换承接，后者由 `proteus migrate mp` 的路由名表直接产出候选。

---

## 6. 迁移验收（对齐 conformance）

迁移完成后跑：

```bash
proteus test:component --backend all
```

**同一份源码在五端渲染快照一致** = 迁移成功、语义等价。

---

## 版本记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-09-02 | 三步迁移 + 组件/API 对照 + codemod 覆盖度 + 人工处理项 + 验收 |
| v2 | 2026-09-02 | B6 落地：`@proteus-vue/compat-miniprogram`（createWxCompat 桥 + migrateMpSource 幂等 codemod + useStorage 目标）+ CLI `proteus migrate mp` |
