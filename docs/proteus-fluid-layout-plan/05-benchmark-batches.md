# 性能预算与分批实施

## 1. 性能预算

| 指标 | 预算 | 说明 |
|------|------|------|
| **编译期 clamp 生成耗时** | < 1ms / 属性 | B1 验证 |
| **运行时布局重算（App 端）** | < 16ms（1 帧） | 容器尺寸变化时 |
| **额外 JS 体积** | < 2KB（gzipped） | Web/Skyline 零开销 |
| **额外原生代码** | < 50KB | iOS/Android/鸿蒙 |

## 2. 验收矩阵

| 端 | 场景 | 预期 |
|----|------|------|
| Web | 320 → 1440 拖拽窗口 | `clamp()` 实时响应，60fps |
| Skyline | 小程序横竖屏切换 | 网格列数自动变化 |
| iOS | 旋转 + 分屏 | `UICollectionView` 重算，无卡顿 |
| Android | 折叠屏展开/收起 | spanCount 动态更新 |
| 鸿蒙 | 横竖屏 | `Grid.columnsTemplate` 更新 |

## 3. 分批实施

| 批次 | 内容 | 依赖 | 状态 |
|------|------|------|------|
| **B1** | `p-fluid` clamp 生成 + 断点推导 | Compiler (G-02) | ✅ 已落地（compiler/fluid-layout.ts：generateClamp/deriveBreakpoints/calcColumns/gridTemplate + tests/fluid-layout.test.ts 6 用例） |
| **B2** | `p-grid` Web/Skyline + CSS Grid | B1 | ✅ Web 已落地（src/components/p-grid：repeat(auto-fill, minmax)；Skyline 降级普通容器） |
| **B3** | `p-stack` + `p-fit` | B1 | ✅ 已落地（src/components/p-stack / p-fit + 挂载测试） |
| **B4** | iOS/Android/鸿蒙 原生映射 | B2 + App Renderer (G-07) | ⬜ **延后**（无原生渲染层） |
| **B5** | 运行时容器监听 + 横竖屏 + 折叠屏 | B4 | ⬜ **延后**（依赖 B4） |

## 4. B1 可单测用例（MVP 起点）

```typescript
describe('fluid-layout B1', () => {
  test('clamp 生成', () => {
    expect(generateClamp(20, 32, 375, [320, 1440]))
      .toBe('clamp(20px, calc(15.77px + 1.1268vw), 32px)')
  })

  test('断点推导', () => {
    expect(deriveBreakpoints(375)).toEqual([
      { name: 'sm', min: 188 },
      { name: 'md', min: 328 },
      { name: 'lg', min: 469 },
      { name: 'xl', min: 609 },
    ])
  })

  test('网格列数', () => {
    expect(calcColumns(320, 160, 12)).toBe(1)
    expect(calcColumns(768, 160, 12)).toBe(4)
    expect(calcColumns(1440, 160, 12)).toBe(8)
  })
})
```

> **B1 三个算法全部已验证通过**（见 `fluid-layout-verify.js`——脚本未入库，等价断言已转 tests/fluid-layout.test.ts），可直接转为单元测试。

> **★收尾说明（2026-09）**：B1-B3 已落地（纯算法 + Web 组件 + demo 页 examples/pages/fluid-layout-demo.vue）；**B4/B5 延后**——五端原生渲染层（App Renderer G-07）尚不存在，iOS/Android/鸿蒙映射与运行时容器监听无从落地；`p-fluid` 指令的编译期 clamp 生成（Web vite transform / MP template 规则）与 FLD001-006 严格规则接入为后续批次（待 Compiler Plugin G-21 与 style-safety 白名单扩展就绪）。
