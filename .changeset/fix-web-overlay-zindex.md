---
'@proteus-vue/components': patch
'@proteus-vue/built-in-components': patch
---

修 Web 弹层被 page 挂载层盖住（"看得见、点不到、关不掉"）——body 追加弹层迁到 overlay 域

背景（CI e2e-web 长期 3 红 · 用户提来）：`e2e-overlay-family.test.ts`（p-drawer / p-popover）
与 `e2e-web-keypaths.test.ts`（showModal）**30s 超时**。真因不是"慢"、更不是"timeout 太短"：

- GP3-a 三层挂载（`packages/web/src/mount-layers.ts`）给 `page` 层 `z-index =
  mountLayerDomainOffset('page') = 1_000_000`（overlay=2_000_000）。
- 而**追加到 `<body>` 的弹层**（组件 `<teleport to="body">`、WeUI 平台层
  `document.body.appendChild`）**不受挂载层约束** ⇒ 裸 z-index 若仍取旧值（999 / 9990 /
  99990…），就被 page 层（1e6）**盖住**：遮罩/按钮可见但点不到 ⇒ Playwright 点不动、等超时。

修法（★对齐既有先例，非新造约定）：`p-loading-host`(2000000) / `p-toast-host`(2000010) /
`p-auth-gate`(2000020) 本轮之前就已用 **overlay 域**（注释写明"原 9999 < 页面层 1e6 ⇒ 被盖住"）。
把**其余** body 追加弹层一并迁到 overlay 域（≥ `mountLayerDomainOffset('overlay')`）：

- `p-drawer` `.p-drawer-root` 999 → 2000000
- `p-popover` `.p-popover-layer` 998 → 2000000 · `.p-popover-panel` 999 → 2000001
- `p-picker` `.p-picker-root` 9990 → 2000200
- WeUI 平台层（`@proteus-vue/built-in-components/style.css`）：ui-mask 99990→2000190 ·
  modal 99991→2000191 · actionsheet 99991→2000191 · picker-sheet 99992→2000192 ·
  toast 99999→2000199 · image-menu-mask 3000→2000100

（`p-modal` / `p-action-sheet` **不 teleport**（留在页面层内），其内部 999 相对页面内容仍在上层，不动。）

★**回归锁**：新增 `tests/teleport-overlay-zindex.test.ts`——静态扫描所有 body 追加弹层的
z-index，断言 ≥ overlay 域（**破坏性验证过**：改回 999 即红）。

验证：`test:e2e:web` **28/28 全过**（原 3 红；overlay 61s→4.5s、keypaths 超时→0.8s）· 全量
5620 通过 · `check:style-ir-golden` / `check:layers` / `check:app-css-surface` / `check:mp-attrs` 绿。
（`check:component-demo` 的 p-view/p-webview 漂移在干净树同样红，属另一 pre-existing，不在本批。）
