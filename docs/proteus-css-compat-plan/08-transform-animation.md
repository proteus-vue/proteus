# 08 Transform 与动画跨端边界

## 一、Transform（✅/⚠️ 混合）

| 函数 | Web | Skyline | iOS | Android | 鸿蒙 | 档位 |
|------|-----|---------|-----|---------|------|------|
| `translate(x,y)` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `scale()` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `rotate()` | ✅ | ❌(同层渲染) | ✅ | ✅ | ⚠️ | ⚠️ 走原生动画 |
| `skew()` | ✅ | ❌ | ✅ | ✅ | ⚠️ | ⚠️ 走原生动画 |
| `matrix()` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |

**规则**：
- `translate` / `scale` → ✅ 直映射，业务放心用
- `rotate` / `skew` / `matrix` → ⚠️ 仅 Web/Skyline 部分支持，**原生端须走原生动画 API**（见 motion plan），或直接禁止

> Skyline 限制源于「同层渲染」的 transform 支持范围。

## 二、Transition（🔶 语义封装）

```css
/* Web: 直接写 transition */
.card { transition: transform .3s; }
.card:hover { transform: scale(1.05); }
```

**Proteus**：`transition` 映射到各端原生动画系统，但**触发语义需用语义组件**保证一致：

```vue
<p-interactive :scale-on-press="1.05" :duration="300">
  <p-view class="card">...</p-view>
</p-interactive>
```

| 端 | 映射 |
|----|------|
| Web | CSS `transition` |
| Skyline | WXS worklet + 原生动画 |
| iOS | `UIView.animate / UIViewPropertyAnimator` |
| Android | `ViewPropertyAnimator` / `ObjectAnimator` |
| 鸿蒙 | `animateTo` |

→ 详细见 motion plan（手势/动画/Worklet）。

## 三、Keyframes 动画（🔶 语义封装）

```css
@keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
```

**跨端差异大**：Skyline/ArkUI 对 `@keyframes` 支持有限，原生端各有动画 API。
**方案**：`<p-animate>` 语义组件 + 动画定义 DSL，编译为各端指令。

```vue
<p-animate name="fadeIn" :duration="300">
  <p-view>...</p-view>
</p-animate>
```

## 四、手势驱动的动画（性能敏感）

高性能场景（滚动视差、拖拽、转场）**不能走 CSS transition**，必须走 Worklet（见 Performance plan）：
JS 主线程不参与，动画直接在 UI 线程对原生属性插值 → 60fps。

`transform: translate/scale` 在此场景下 ✅ 全端可用（映射到 `CALayer.transform` / `View.translationX` / `component.translate`）。

## 五、性能预算（对接 Performance plan）

| 场景 | 预算 |
|------|------|
| 首屏同步动画数 | ≤ 3 |
| 同时运行动画 | ≤ 5 |
| 单帧动画属性数 | ≤ 4 |
| 长列表 item 入场动画 | 仅可见区 |

超标 → Compiler 警告 + 自动降级为 `opacity` 单属性。

## 六、禁止项

❌ `will-change`（原生端无意义）→ Renderer 自动用原生优化（iOS `shouldRasterize`、Android 硬件层）
❌ `perspective` / `transform-style: preserve-3d`（3D 仅 Web/iOS 可靠）→ 走原生 3D API
❌ `mix-blend-mode`（仅 Web/Skyline）→ 用原生合成（iOS `compositingFilter`、鸿蒙 `blendMode`）

→ 复杂混合效果建议 `<p-glass>` 或平台特写 + `proteus-css-ignore`（需审批）。
