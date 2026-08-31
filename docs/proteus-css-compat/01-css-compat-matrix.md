# 01 CSS 跨端兼容矩阵

> 原则 #10「统一语义 + 原生实现」在样式层的总纲：**不追求像素级一致，追求语义级一致。**

## 一、四档定义

### ✅ 直映射（Direct Mapping）
属性语义在五端均有原生对应，Compiler 直接翻译，**开发者无感知**。
允许出现在任意 SFC `<style>` 中。

### 🔶 语义组件封装（Semantic Component）
Web/CSS 中存在但原生端**无一对一属性**的能力（如 `backdrop-filter`、sticky），
统一收敛为 `<p-*>` 语义组件，由组件内部按端映射。

### ⚠️ 编译期重写（Compile-time Rewrite）
语法在 Web 可用、但某端原生不支持或语义差异大（如 `calc()`、`vh`、`rgba()`），
**Compiler 在构建期求值/转换**，产物不含原始表达式。

### ❌ 禁止（Forbidden）
Web 特有、五端无法统一、或破坏原生渲染模型的能力，
`--strict-css` 直接构建报错。

## 二、属性矩阵

### 布局（Layout）

| 属性 | Web | Skyline | iOS | Android | 鸿蒙 | 档位 |
|------|-----|---------|-----|---------|------|------|
| display:flex + direction/justify/align/gap | ✅ | ✅ | ✅ UIStackView | ✅ ConstraintLayout chain | ✅ Flex/Row/Column | ✅ |
| gap | ✅ | ✅ | ✅(13+) | ✅ | ✅ | ✅ |
| width/height/min/max | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| padding/margin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| border/border-radius | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| box-sizing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| position: relative/absolute/fixed | ✅ | ✅(fixed 仅视口) | ✅ | ✅ | ✅ | ✅ |
| **position: sticky** | ✅ | 🔶 sticky-header | 🔶 UICollectionView | 🔶 RecyclerView | 🔶 ScrollAware | 🔶 `<p-sticky>` |
| **overflow: scroll** | ✅ | 🔶 `<scroll-view>` | 🔶 UIScrollView | 🔶 RecyclerView | 🔶 Scroll | 🔶 `<p-scroll>` |
| float | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| display: inline / inline-block | ✅ | ❌(text 内嵌套除外) | ❌ | ❌ | ❌ | ❌ |
| vertical-align | ✅ | ⚠️ 有限 | ❌ | ❌ | ❌ | ❌ |

### 视觉（Visual）

| 属性 | Web | Skyline | iOS | Android | 鸿蒙 | 档位 |
|------|-----|---------|-----|---------|------|------|
| color / opacity / visibility | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| background-color | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **linear-gradient** | ✅ | ✅ | 🔶 CAGradientLayer | 🔶 GradientDrawable | 🔶 LinearGradient | 🔶 `<p-bg-gradient>` |
| **backdrop-filter: blur** | ✅ | ✅ | 🔶 UIGlassEffect | 🔶 RenderEffect | 🔶 blur | 🔶 `<p-glass>` |
| box-shadow | ✅ | ⚠️ | 🔶 layer.shadow | 🔶 elevation+shadow | 🔶 shadow | 🔶 `<p-shadow>` |
| **box-shadow 高级参数(rgba)** | ✅ | ⚠️ | 🔶 ARGB | 🔶 ARGB | 🔶 ARGB | ⚠️ rgba→ARGB |

### 变换与动画（Transform / Motion）

| 能力 | Web | Skyline | iOS | Android | 鸿蒙 | 档位 |
|------|-----|---------|-----|---------|------|------|
| transform: translate / scale | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| transform: rotate / skew | ✅ | ❌(同层渲染) | ✅ | ✅ | ⚠️ | ⚠️ 走原生动画 API |
| transition | ✅ | 🔶 | 🔶 UIView.animate | 🔶 ViewPropertyAnimator | 🔶 animateTo | 🔶 见 motion plan |
| @keyframes animation | ✅ | ⚠️ | 🔶 CAAnimation | 🔶 Animator | 🔶 animationTo | 🔶 见 motion plan |

### 选择器与级联（Cascade）

| 语法 | Web | Skyline | 原生端 | 档位 |
|------|-----|---------|--------|------|
| `.class` | ✅ | ✅ | ✅(scope) | ✅ |
| 元素选择器 `div {}` | ✅ | ⚠️ 有限 | ❌ | ❌ |
| `* `通用选择器 | ✅ | ❌ | ❌ | ❌ |
| `[attr]` 属性选择器 | ✅ | ❌ | ❌ | ❌ |
| 后代/子代组合 `.a .b` / `.a > .b` | ✅ | ⚠️ 深层不支持 | ❌ | ❌ |
| `:active / :hover` | ✅ | ✅ | ✅(touch) | ✅ | ✅ | ✅(部分) |
| `:first-child / :nth-child` | ✅ | ✅(8.0.49+) | 🔶(Renderer 展开) | 🔶 | 🔶 | ⚠️ |
| `::before / ::after` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |

> **结论**：选择器只允许 `.class` + 组件 scope；其余级联语义由 **Compiler 构建期算好**，运行期不下发选择器。

## 三、对"兼容"的准确定义

**Proteus 的 CSS 兼容 = 语义一致，不是像素一致。**

- ✅ 同一份 SFC 在五端**布局结构相同、视觉语义相同、交互行为相同**
- ✅ 允许各端在**字体度量、默认间距、抗锯齿、阴影扩散**等系统级细节上有原生差异
- ❌ 不承诺"截图像素级重合"（那是 Flutter/Yoga 的目标）

**为何这是更优解**：原生外观符合各平台设计规范（HIG / Material / HarmonyOS），
系统新特性（iOS 26 间距、鸿蒙 NEXT 容器）**自动继承，无需框架更新**。

## 四、与竞品对照

| 方案 | CSS 兼容范围 | 代价 | 原生质感 |
|------|-------------|------|---------|
| uni-app (WebView) | 全 CSS（=浏览器） | 性能差、无原生质感 | ❌ |
| uni-app x (uvue/ucss) | 自创 ucss 子集（较窄） | 脱离 JS 生态、需 .uvue | ✅ |
| Lynx | 真 CSS 子集 + 自研布局引擎 | 维护布局引擎 | ✅ |
| **Proteus** | **子集（比 ucss 宽、比 WebView 窄）+ 编译转原生，不引 Yoga** | **中间态** | ✅✅ |

**差异化**：既不放弃 CSS 生态（比 ucss 宽），也不自研布局引擎（不引 Yoga），
靠「统一语义 → 各端原生实现」吃下原生质感。
