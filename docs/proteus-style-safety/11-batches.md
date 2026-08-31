# 分批落地策略（G-16）

> 依赖：CSS 兼容矩阵、App Renderer、Compiler IR

---

## 依赖图

```
CSS 矩阵 (已完成)
    ↓ 白名单定义
B1: 属性名白名单 + Runtime Validator 骨架
    ↓
B2: 值类型系统 + 逐平台收窄
    ↓
Compiler IR (已有)
    ↓
B3: :style AST 静态推导 + 代码生成
    ↓
B4: 五端原生闸门 + DevTools 可视化
```

**B1 纯逻辑零依赖，可单测，建议与 `--strict-css` 同期启动。**

---

## 批次详情

### B1（基础层，可立即启动）

**目标：** 属性名白名单 + Runtime Validator 骨架

**内容：**
- `ALLOWED_STYLE_PROPS` 白名单（对照 CSS 矩阵）
- `validateStyle()` 核心函数
- 集成进 `patchStyle`（App Renderer）
- `--strict-style` CLI 开关
- 单元测试（非法值拦截）

**依赖：** CSS 四级矩阵 ✅

**验收：** 任何白名单外属性被拦截，五端无 crash

**Prompt 模板：**

```
实现 Style Runtime Safety B1：
1. 基于 CSS 兼容矩阵定义 ALLOWED_STYLE_PROPS 白名单
2. 实现 validateStyle(style, platform)，含：
   - 属性名白名单检查
   - 值类型守卫（Length/Color/Opacity）
   - 降级策略（开发 warn、生产丢弃）
3. 集成进 App Renderer 的 patchStyle，JSI 前拦截
4. 实现 --strict-style CLI + STS001-006 报错码
5. 单测覆盖：负数 width、NaN、undefined、语义组件属性、forbidden 属性
```

---

### B2（类型系统）

**目标：** 值类型系统 + 逐平台类型收窄

**内容：**
- 类型守卫（isLength / isColor / isOpacity）
- 逐平台收窄（iOS CGFloat / Android TypedValue / 鸿蒙 / Skyline）
- 降级默认值

**依赖：** B1

**验收：** 各端原生 API 绝无非法参数

---

### B3（编译期推导）

**目标：** `:style` AST 静态分析 + 代码生成

**内容：**
- 可达值集推导
- 常量折叠
- `_validated()` 内联生成
- 覆盖率统计

**依赖：** Compiler IR ✅

**验收：** 静态推导覆盖率 > 80%

**Prompt 模板：**

```
实现 Style Safety B3（编译期推导）：
1. 在 Compiler 新增 style-safety transform
2. 实现 deriveReachableValues(expr)：
   - Literal → 静态值
   - Conditional → 合并 consequent/alternate
   - BinaryExpression → 常量折叠
   - 动态源（apiData/函数调用）→ 标记动态
3. 完全静态 → 生成 _validated(prop, value) 内联
4. 含动态源 → 生成 _runtimeValidate() 调用
5. 输出 staticCoverage 统计到 style-report.json
```

---

### B4（原生闸门 + DevTools）

**目标：** 五端原生闸门 + 可视化

**内容：**
- iOS `StyleGate.swift`
- Android `StyleGate.kt`
- 鸿蒙 `StyleGate.ts`
- Skyline 校验
- DevTools Style Safety 面板

**依赖：** B1/B2 + App Renderer M2

**验收：** 纵深防御验证（前三层 mock 失效，第四层兜底）

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 白名单过严影响迁移 | `--strict-style --fix` 自动修复 + 渐进式启用 |
| 运行时开销超标 | 静态推导覆盖 > 80%，生产关闭 Validator |
| 第三方库绕过 | `trusted` 标记 + 统一入口 |
| 类型收窄误判 | 降级优先（宁错杀不错过） |

---

## 里程碑对照

| 里程碑 | 包含 | 产出 |
|--------|------|------|
| M1 | B1 + B2 | Validator 骨架 + 类型系统（可单测 demo） |
| M2 | B3 | 编译期推导（减少运行时开销） |
| M3 | B4 | 五端闸门 + DevTools（完整闭环） |

**建议 M1 与 App Renderer M1、CSS `--strict-css` 同期启动——三者都是纯逻辑零依赖，最快出可演示效果。**
