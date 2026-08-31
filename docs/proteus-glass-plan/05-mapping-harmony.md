# 05 鸿蒙映射：ArkUI blur / fractal（重点深耕）

## 定位

**鸿蒙是中国系统里玻璃支持最完善的平台，是 Proteus 差异化深耕点。**

## API 版本

- `blur` / `backdropBlur`：API 9 起稳定
- 材质/玻璃态强化：HarmonyOS NEXT

## 基础映射（L1，API 9+）

```ts
// ArkTS 生成代码（示意）
@Component
struct ProGlass {
  @Prop radius: number = 16
  @Prop tint: string = 'rgba(255,255,255,0.15)'

  build() {
    Stack() {
      // 背景模糊层
      Blank()
        .backdropBlur(20)
        .backgroundColor(this.tint)
        .borderRadius(this.radius)
    }
  }
}
```

## Intensity → blur 半径

| intensity | blur 半径 (px) |
|-----------|---------------|
| thin | 10 |
| regular | 20 |
| thick | 30 |
| ultra | 50 |

## L3：NEXT fractal 材质

```ts
// 仅 NEXT 可用
.blur(BlurStyle.FRACTAL, 20)
```

Capabilities 守门：`glassCapability.level.harmony.l3 === 'NEXT'`。

## preset 映射

| preset | ArkUI 实现 |
|--------|-----------|
| navigationBar | `backdropBlur` + `.border({ width: 0.5, color: '#ffffff33' })` |
| modal | `backdropBlur` + 大圆角 + 阴影 |
| card | `blur` + `borderRadius` |
| tabBar | `backdropBlur` + 顶部高光边 |

## 深耕点（Proteus 差异化）

1. **响应式玻璃**：监听滚动 → `blur` 半径动态变化（ArkTS 动画 60fps）
2. **色彩跟随系统**：鸿蒙支持主题色，玻璃 tint 随 `Configuration.ColorMode`
3. **分布式场景**：鸿蒙跨设备，玻璃态可随设备形态适配（折叠屏）

## 对齐 Component plan

- `<pg-glass>` → ArkUI `Stack` + `backdropBlur`
- `p-*` 映射表新增鸿蒙列
- Compiler IR → ArkTS backend

## 降级

```
NEXT        → fractal 材质     (L3)
API 9-12    → backdropBlur     (L1)
< API 9     → backgroundColor  (L1 实色)
```
