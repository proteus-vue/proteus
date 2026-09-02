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
| `<scroll-view scroll-x>` | `<p-stack direction="horizontal">` | 语义识别 |
| `<swiper>` | `<p-stack snap="mandatory" loop>` | 语义识别 |
| `<movable-view>` | `<p-box>` + drag 能力 | 需手动 |
| `<input>` | `<p-input>` | codemod 自动 |
| `<list>` / `<recycle-view>` | `<p-list>`（内置虚拟化） | codemod + 验证 |

**关键差异**：`<scroll-view>` / `<swiper>` 不是 1:1 替换，而是**语义还原为布局原语**——这是"组件语义化"的必然（G-31 §2.2）。

---

## 3. API 迁移对照（codemod 自动覆盖 90%）

| 小程序 | Proteus | 说明 |
|--------|---------|------|
| `wx.request({...})` | `await useFetch(url)` | awaitify |
| `wx.navigateTo({url})` | `router.push({name, params})` | 路由名需建表 |
| `wx.setStorage(k,v)` | `useStorage()` | 响应式 |
| `wx.scanCode({success})` | `await native.scanQR()` | awaitify |
| `wx.login()` | `await auth.login()` | 链路合并 |

codemod 工具：`proteus-migrate`（计划内，见 `batches.md` B4）。

---

## 4. 三步迁移流程

```
Step 1：装 compat 层，旧代码原样跑通
        npm i @proteus/compat-miniprogram
        → 全部 wx.xxx 可用

Step 2：跑 codemod，批量转原生语义
        npx proteus-migrate --from miniprogram --to native
        → 70-90% 自动转换

Step 3：人工处理剩余（语义还原 + 路由名表 + 能力 reason）
        → 完成
```

---

## 5. 不能自动迁移的部分（需人工）

| 场景 | 原因 | 处理 |
|------|------|------|
| `scroll-view` → `p-stack` | 需理解布局意图 | AI Agent（G-23）辅助 |
| 字符串 URL → 命名路由 | 需路由名表 | 建表后 codemod |
| 自定义原生插件 | 散落在业务 | 封装为 Backend（G-28） |
| 平台特有 ifdef | 违背 G-30.1 | 改为 `@conditional` |

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
