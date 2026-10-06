# App 图片渲染（native image element in self-draw）· 能力登记（登记态 · 2026-10-08）

> **来源**：`css:next` 指向 `object-fit`（P0·3×）。侦察发现 `object-fit` 在本框架里是**组件属性**（`<image mode>`），
> 不是编译器折叠的 CSS 属性；且 **App 自绘不渲染图片**（无作用对象）⇒ 用户裁定「按架构归类 + 立项 App 图片渲染」。
> 本文件是该能力的**登记件**（现状 / 为什么是独立能力 / 范围 / 依赖 / 触发）。

## 1. 现状（三端图片）

| 端 | `<image>` 渲染 | object-fit 交付 |
|---|---|---|
| **Web** | 浏览器 `<img>`（`packages/web/src/components/image.ts` 模拟层：`mode`→CSS `objectFit`） | ✅ CSS 原生（`mode` 映射，含 `object-position`） |
| **MP/Skyline** | 微信原生 `<image>` | ✅ 原生 **`mode` 属性**（`aspectFill`/`scaleToFill`/`widthFix`；Skyline 无 CSS `object-fit`） |
| **App（自绘）** | **无**（`<image>` 未落地宿主：iOS `decode_image` 挂 `nil`、Android 无 ImageView、内核 DTO 无 `src`） | ❌ 无作用对象 |

**结论**：`object-fit` 的语义载体是**组件**（`<image mode>` / `p-image.fit`），Web/MP 已交付；**App 缺的是「图片渲染」本身**，而非某个 CSS 属性。

## 2. 为什么是**独立能力**（不是 CSS 属性批）

- `object-fit` / `object-position` 作用于**替换内容**（replaced content：图片/视频）——它们描述「内容如何塞进盒子」，
  必须**先有内容**。App 自绘目前只承载**几何 + 文本 + 背景**（`NodeDto` 有 `text`/`is_text`，无图片内容字段），
  ⇒ 折叠 `object-fit` 到 App DTO **没有作用对象** = no-op = 假绿。
- 主流端同样如此：微信/Skyline 用 `<image mode>` 表达填充，**不是** CSS `object-fit`（官方属性表里 object-fit 只属 video 族）。
- 因此 `object-fit` 在能力清单里**归「组件通道」**（`channel: component`，Web/MP 已交付），
  真正的 App 缺口登记为**本能力**。

## 3. 范围（App 图片渲染最小闭环）

1. **数据通道**：`<image>` / `p-image` 的 `src`（+ `mode`/`fit`）进 App 屏内容 → `NodeDto`（新增 `src`/`image_fit` 类字段，与 `text` 同层）。
2. **内核**：图片是**叶子内容**（不参与排版计算，几何 = 自身盒）；如需内在尺寸可后续加 `intrinsic_size` 探测。
3. **三端宿主**（自绘管线内的图片内容绘制）：
   - Android：异步 decode（`BitmapFactory`/Coil）→ 按 `object-fit`（cover/contain/fill/none/scale-down）裁剪绘制到盒；
   - iOS：`decode_image` vtable **接线**（当前 `nil`）→ `UIImage` + `CALayer.contents` + `contentsGravity`/`contentsRect` 表达 fit；
   - 鸿蒙：`OH_Drawing` 图片绘制 + 按 fit 裁剪。
4. **组件面**：`p-image` 的 `mode`（aspectFill/scaleToFill/widthFix…）→ 统一归一为 `object-fit` 语义值下发；
   `lazy-load`/占位/加载态由宿主/组件分层承担。
5. **一致性链**：`object-fit` 进 `APP_PAINT_FIELDS`（那时**才有**作用对象）+ snapshot/probe/applier。

★**依赖**：图片**解码与缓存**（异步、可能失败、内存占用）是平台级能力（对标 Mnemosyne 内存线 + Hephaestus 高频原生能力线里的「相册/图片」）——
  本能力**本质是原生图片元素**，不是样式折叠。

## 4. 触发条件

- **A**：某验收场景需要 App 端**真显示图片**（当前 App 自绘内容里无图片元素）；
- **B**：与 Mnemosyne（内存/解码预算）或 Hephaestus（高频原生能力）合并立项时；
- **C**：产品化某图片密集型页面（相册/商品图/头像墙）时。

## 5. 关联

- **object-fit 归类**：`scripts/gen-css-feature-inventory.mjs`（`separate: true, channel: 'component'`）+ `scripts/verify-css-feature.mjs`（channel → parity/ends n/a）；
- **组件通道**：`packages/web/src/components/image.ts`（mode→objectFit）· `packages/built-in-components/src/components/image.ts` · `packages/components/p-image`；
- **App 渲染管线**：`packages/render-backend/src/screen-executor.ts`（屏内容）· `packages/layout-core-rust/src/ffi.rs`（NodeDto）· 三端宿主 `hosts/*`；
- **同类原生能力线**：`docs/Proteus_高频原生能力组件方案.md`（Hephaestus）· `docs/Proteus_全链路内存安全与可归因性方案.md`（Mnemosyne）；
- **决策**：`#572`（object-fit 归类 + 本能力立项）。
