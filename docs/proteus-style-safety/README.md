# Proteus 全端样式运行时安全解决方案

> 执行位：**G-31** · 优先级：**P1** · 归属：Architecture 原则 #10 + Compiler + Runtime + DevTools
>
> 配套：CSS 跨端兼容矩阵（`proteus-css-compat`）、App Renderer、Memory Plan、App Capabilities

## 一句话定位

**Proteus 不让任何一条未经语义校验的样式值，抵达原生渲染管线。**

Web 时代样式写错最多"不生效"，App 端 **JSI 直调会把非法值直接塞给原生 API，可能 crash**。
因此样式安全不是"lint 建议"，而是 **框架运行时契约**。

## 核心主张

```
开发者写的每一条样式
    ↓
① 语义层校验（只允许 p-* token + 白名单属性 + 类型正确的字面量）
    ↓ 放行
② 编译期推导（静态可达 → 生成校验后的指令）
    ↓
③ 运行时 Validator（动态值最后一道闸门，O(n) 属性数）
    ↓ 只放行合法值
④ JSI / 原生渲染管线（绝无非法参数）
```

**三层防线，任一生效即安全。** 编译期覆盖越多，运行时开销越小。

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-style-runtime-safety.md` | ★ 主文档：问题/三层防线/语义层/类型系统/降级/开关 |
| `02-three-layer-defense.md` | 三层防线细节：编译静态校验 / :style AST 推导 / Runtime Validator |
| `03-semantic-token-layer.md` | 语义层设计：`p-*` token + 白名单属性 + 禁止直通 CSS |
| `04-type-system.md` | 样式值类型系统与逐平台类型收窄（Length/Color/Opacity...） |
| `05-compile-time-derivation.md` | `:style` AST 静态分析 + 常量折叠 + 可达值集 |
| `06-runtime-validator.md` | Runtime Style Validator 实现 + 降级 + 上报 + 性能预算 |
| `07-five-end-native-gates.md` | 五端原生闸门（iOS UIEdgeInsets/Android TypedValue/鸿蒙/Web/Skyline） |
| `08-strict-style-cli.md` | `--strict-style` / `--style-report` / 报错码 STS001-020 |
| `09-integration.md` | 与 CSS 矩阵 / Memory / Theme / HMR / DevTools 的协同 |
| `10-benchmark-budgets.md` | 性能预算（验证开销 <3%）+ 真机五端验收矩阵 |
| `11-batches.md` | 分批 B1-B4 + Prompt 模板 |
| `architecture-update.md` | 合并进 Architecture 规约的变更（原则 #10 补充 + G-31） |
| `pack.sh` | 打包脚本（双通道交付 + SHA256 校验） |

## 校验结果

见 `CHECKSUM.md`（生成时填充）。

## 设计原则（继承 Architecture #10）

> **框架定义统一语义，各端用原生方式实现。**

内联 style / 动态 `:style` 的本质问题：**开发者绕过语义层，把 CSS 属性名直塞各端**——
而各端原生 API 的参数模型根本不是 CSS。

因此解法不是"校验 CSS 是否合法"，而是 **禁止 `:style` 直通 CSS，只允许 `p-*` 语义 token + 已映射属性**。

## 与现有体系的关系

```
CSS 四级兼容矩阵（proteus-css-compat）
        ↓ 白名单属性 / 级别定义
Style Runtime Safety（本方案）        ← 新增 G-31
        ↓ 运行时闸门
App Renderer（Custom Renderer patchStyle）
        ↓ JSI
五端原生渲染管线
```

**本方案 = CSS 矩阵的"运行时执行层"**：矩阵定义什么合法，本方案保证非法值永远到不了原生。
