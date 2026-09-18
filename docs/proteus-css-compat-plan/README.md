# Proteus CSS 跨端兼容性方案

> 配套：`architecture-principle.md` 原则 #10「统一语义 + 原生实现」在**样式层**的具体落地
> 执行位：G-21（Compiler CSS 处理管线），与 Component（布局语义）、Glass（L3 映射）、Platform（判别联合）协同

## 一句话结论

**Proteus 不承诺"Web CSS 五端像素级兼容"——那是 Flutter/Yoga 的路。**
**Proteus 承诺的是：在明确界定的 CSS 子集内，开发者写一份 SFC 样式，Compiler 编译为五端原生样式指令，达到「语义一致 + 原生质感 + 系统特性免费继承」。**

## 四档兼容等级

| 级别 | 含义 | 处理 |
|------|------|------|
| ✅ 直映射 | flex / box-model / color / opacity / transform(translate,scale) | Compiler 直接编译为五端原生指令 |
| 🔶 语义封装 | backdrop-filter / sticky / scroll / shadow / gradient | `<p-glass>` `<p-sticky>` 等语义组件收敛 |
| ⚠️ 编译期重写 | calc → 约束；vh → safe-area；rgba → ARGB | 构建期求值，不下发平台 calc |
| ❌ 禁止 | `*` 选择器、float、inline、依赖 stacking context 的 z-index | `--strict-css` lint 报错 |

## 文档索引

- `01-css-compat-matrix.md` —— 四级兼容矩阵（核心，逐属性标注）
- `02-strict-css-lint.md` —— `--strict-css` 校验规则与报错码
- `03-compile-time-rewrite.md` —— calc / vh / rgba / 选择器 的编译期处理
- `04-semantic-style-components.md` —— p-glass / p-sticky / p-scroll / p-shadow / p-bg-gradient
- `05-five-end-mapping.md` —— Web / Skyline / iOS / Android / 鸿蒙 五端样式映射细则
- `06-selector-cascade.md` —— 选择器级联的编译期固化（为何禁 `*`/`[attr]`）
- `07-box-model.md` —— 盒模型、border-box、safe-area
- `08-transform-animation.md` —— transform / transition / animation 跨端边界
- `09-compiler-integration.md` —— Compiler 管线集成（--strict-css / --css-compat-report）
- `10-benchmark-budgets.md` —— 样式预算、体积上限、运行时开销
- `11-batches.md` —— 分批策略 B1-B3 + Prompt 模板
- `12-anti-examples.md` —— 反例与迁移（对照 uni-app uvue / Lynx）

## 校验

- 打包：`bash pack.sh`（自动校验非空 + 生成 SHA256）
- 解压验证：`unzip -t proteus-css-compat.zip`
