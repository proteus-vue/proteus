# 03 能力矩阵

> 矩阵 = 平台 × 能力 → 可达层级（✅ 必达 / 🔶 尽力 / ❌ 不可达）

| 能力 | iOS | 鸿蒙 | Android | Web | Skyline |
|------|-----|------|---------|-----|---------|
| 基础模糊 (L1) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 颜色着色 (L1) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 圆角边框 (L1) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 噪点纹理 (L2) | 🔶 | 🔶 | 🔶 | ✅ | 🔶 |
| 高光描边 (L2) | 🔶 | 🔶 | 🔶 | ✅ | 🔶 |
| 动态形变 (L2) | 🔶 | 🔶 | ❌ | 🔶 | ✅ |
| 系统材质 (L3) | ✅ iOS26+ | ✅ NEXT | ❌ | ❌ | ❌ |
| 半透明穿透 | ✅ | ✅ | 🔶 | ✅ | ✅ |

## 版本门槛

| 平台 | 最低版本 | L3 门槛 |
|------|---------|---------|
| iOS | 13+ | 26+ |
| 鸿蒙 | API 9+ | NEXT |
| Android | API 31+ | — |
| Web | 现代浏览器 | — |
| Skyline | 2.x | — |

## 能力注册表（对齐 types-plan）

```ts
// packages/platform/src/capabilities/glass.ts
export const glassCapability: CapabilityDescriptor = {
  name: 'glass',
  level: {
    ios: { min: '13', l3: '26' },
    harmony: { min: 'API 9', l3: 'NEXT' },
    android: { min: 'API 31', l3: null },
    web: { min: '*', l3: null },
    skyline: { min: '2.0', l3: null },
  },
  fallback: 'solid',
}
```

`Platform.assertCapability('glass')` 静态可分析 → 编译期提示降级。

## 静态分析示例

```vue
<!-- ✅ 正确：用 pg-glass，自动降级 -->
<pg-glass preset="card"/>

<!-- ⚠️ 警告：裸 backdrop-filter 无法降级 -->
<div style="backdrop-filter: blur(20px)"/>
```

`proteus audit glass` 检测裸玻璃写法，建议替换为 `<pg-glass>`。
