# 性能预算、验收矩阵与分批策略

> **执行位**：G-22 补充（自适应容器 `p-adaptive`）
> **关联**：`05-benchmark-batches.md`（G-22 主）、G-19（DevTools TraceBus）

---

## 1. 性能预算

| 指标 | 预算 | 测量方式 |
|------|------|----------|
| 区间计算 `compute()` | < 0.1ms / 次 | JS 微基准 |
| 容器宽度监听（ResizeObserver）回调 | < 1ms | Performance Observer |
| 形态切换（Vue patch） | < 16ms（1 帧） | DevTools Performance |
| 原生容器转场 | 系统原生（iOS ~250ms） | 不计入框架开销 |
| 内存（Controller 实例） | < 1KB / 实例 | 堆快照 |
| 首屏额外 JS | < 3KB（gzip） | bundle 分析 |

**核心开销只在"宽度变化瞬间"**——稳态下零开销（不轮询、不监听屏幕旋转）。

## 2. 五端真机验收矩阵

| 端 | 设备 | 场景 | 预期 |
|----|------|------|------|
| iOS | iPhone SE → iPad Pro | 拖拽窗口 | sheet ↔ dialog ↔ popover 无缝切换 |
| iOS | iPad Split View | 分屏 1/3 ↔ 2/3 | `UISplitViewController` 自动 drawer ↔ sidebar |
| Android | Pixel 折叠 | 折叠 ↔ 展开 | BottomSheet ↔ Dialog |
| 鸿蒙 | Mate X5 | 折叠 ↔ 展开 | `SideBarContainer` Embed ↔ Overlay |
| Web | Chrome | 拖拽窗口 320↔1440px | `@container` 查询实时 reflow |
| Skyline | 微信开发者工具 | 横竖屏切换 | 页面栈半屏 ↔ 模态 |

**验收标准**：切换过程无闪烁、无布局抖动、转场用系统动画。

## 3. 正确性单测（B1 优先，纯逻辑零依赖）

```typescript
// compute.ts —— 纯函数
describe('AdaptiveController.compute', () => {
  const variants = [
    { form: 'sheet', lo: 0, hi: 600 },
    { form: 'dialog', lo: 600, hi: 840 },
    { form: 'popover', lo: 840, hi: Infinity },
  ]

  it('returns sheet below 600', () => {
    expect(compute(variants, 320)).toBe('sheet')
    expect(compute(variants, 599)).toBe('sheet')
  })

  it('returns dialog at boundary', () => {
    expect(compute(variants, 600)).toBe('dialog')
    expect(compute(variants, 700)).toBe('dialog')
  })

  it('returns popover above 840', () => {
    expect(compute(variants, 840)).toBe('popover')
    expect(compute(variants, 1920)).toBe('popover')
  })

  it('falls back to last variant for out-of-range', () => {
    expect(compute(variants, -100)).toBe('sheet')  // lo=0 兜底
  })
})

// validate.ts —— 区间校验
describe('validateAdaptiveConstraint', () => {
  it('rejects overlapping ranges (FLD007)', () => {
    const diags = validate([{ form: 'a', lo: 0, hi: 600 }, { form: 'b', lo: 500, hi: 900 }])
    expect(diags).toContainEqual(expect.objectContaining({ code: 'FLD007' }))
  })

  it('accepts continuous ranges', () => {
    const diags = validate([{ form: 'a', lo: 0, hi: 600 }, { form: 'b', lo: 600, hi: Infinity }])
    expect(diags).toHaveLength(0)
  })
})
```

## 4. 端到端用例

### 4.1 折叠屏展开（鸿蒙 Mate X5）

```
初始：折叠态 280pt → form = sheet（底部 Sheet）
展开：展开态 680pt → 容器宽度变化 → compute(680) = dialog
结果：弹窗自动从 Sheet 切换为 Dialog，转场用系统动画
```

### 4.2 iPad 分屏（iOS）

```
初始：1/3 分屏 340pt → form = drawer（汉堡菜单）
拖拽：2/3 分屏 720pt → compute(720) = sidebar（常驻侧栏）
结果：`UISplitViewController` 自动切换 displayMode
```

### 4.3 桌面窗口拖拽（Web）

```
窗口 400px → sheet（底部）
窗口 700px → dialog（居中）
窗口 1200px → popover（锚定触发源）
全过程：`@container` 查询实时 reflow，无 JS 开销
```

## 5. 分批策略

### B1：编译器 + 纯逻辑（M1，零依赖）✅ 已落地

- [x] `compute()` 纯函数（区间查找）——`computeAdaptiveForm`（fluid/adaptive.ts，[lo, hi) 左闭右开 + 越界兜底）
- [x] `validateAdaptiveConstraint()`（FLD007/008/009）——`validateAdaptiveRanges` + fluid:check 接入
- [x] `parseAdaptiveExpression()`（字符串 → AST）——支持 ∞/inf/省略端点
- [x] 单测覆盖（§3）——tests/adaptive.test.ts（12 用例）

**验收**：100% 单测通过，零原生依赖 ✅

### B2：运行时 Controller（M2）✅ 已落地

- [x] `AdaptiveController`（ResizeObserver 绑定）——`createAdaptiveController`（fluid/adaptive.ts，复用 createContainerQuery + computeAdaptiveForm，工厂注入可单测）
- [x] `applyAdaptiveForm()` 五端 nodeOps 抽象——Web 端 `resolveAdaptiveFormStyle`（sheet 底部全宽 / dialog·popover 居中降级）；B3 原生映射待 App Renderer
- [x] 容器宽度变化 → 形态切换——`src/components/p-adaptive`（modes 表达式 + visible + formChange emit；MP 无 RO 恒首区间兜底）

**验收**：Web 端拖拽窗口实时 reflow ✅（fluid-system-demo p-adaptive 区块，tests/adaptive.test.ts B2 用例）

### B3：原生映射（M3，按端）

- [ ] iOS：`UISheetPresentationController` / `UIPopover` / `UISplitViewController`
- [ ] Android：`BottomSheetDialog` / `NavigationRail` / `SlidingPaneLayout`
- [ ] 鸿蒙：`SideBarContainer` / `Sheet` / `Popup`

**验收**：五端真机矩阵（§2）全部通过

### B4：组件库（M4，P1）

- [ ] `<p-modal>` / `<p-drawer>` / `<p-nav>` / `<p-detail>`
- [ ] 与 Glass / Safe Area 协同
- [ ] 文档 + Playground demo

**验收**：官网示例"拖拽窗口看弹窗形态自动切换"

### B5：DevTools + Agent（M5）

- [ ] Inspector 形态可视化 + 手动覆盖
- [ ] G-23 Agent `scanHardcodedWidth` → `suggestAdaptiveProp`（FLD008 自动修复）

**验收**：Agent 自动把 `if (width < 600)` 重构为 `p-adaptive`

## 6. CI 门禁

```yaml
# .github/workflows/fluid.yml
- name: strict-fluid
  run: pnpm proteus check fluid --strict
  # 阻断：FLD007/008/009 违规

- name: adaptive unit tests
  run: pnpm test adaptive
  # 阻断：compute / validate 单测失败
```

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 嵌套容器宽度监听开销 | 只在形态变化时计算，稳态零开销；`ResizeObserver` 原生批量回调 |
| 区间端点与 `p-fluid` 断点不一致 | FLD009 强制引用 `app.config.layout.breakpoints`（单一事实源） |
| 低端设备无系统原生容器 | 降级链（§6 of 03-five-end-mapping）+ `CapabilityRegistry` |
| Skyline 不支持 popover 定位 | 降级为 `position: fixed` 居中 |
| 形态切换闪烁 | 使用系统原生动画（非 CSS transition），iOS/Android/鸿蒙天然无闪烁 |
