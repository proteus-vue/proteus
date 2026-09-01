# @proteus-vue/style-safety

Proteus 样式运行时安全（G-31 B1+B2）：动态 `:style` 最后闸门——属性名白名单 + 值类型校验 + 拦截记录。

## 安装

```bash
npm i @proteus-vue/style-safety
```

## 用法

```ts
import { createStyleGuard } from '@proteus-vue/style-safety'

// 动态样式守卫（开发模式 loose；生产 off 零开销）
const guard = createStyleGuard({ mode: 'loose' })

// 渲染层调用：非法属性被剔除/降级，绝不到达原生渲染管线
const safe = guard.patch({ width: 100, opacity: 1.5, display: 'inline-flex', 'p-glass': true })
//   → { width: 100, opacity: 1, 'p-glass': true }（opacity 降级 1，display 剔除）

// 拦截记录（DevTools style-safety Inspector 数据源）
guard.records() // [{ prop: 'opacity', value: 1.5, reason: '...', ts }]
```

## 规则

- ✅ 白名单：Length（width/padding/margin/gap/...）、Color、数值（opacity/flex/zIndex）、transform
- 🔶 语义组件：`p-*` 前缀放行（组件内安全路径）
- ❌ forbidden：display/float/position/backdropFilter/boxShadow/filter/overflow（必须 p-* 封装）

## 分层防御（G-31）

编译期静态分析（`@proteus-vue/compiler/style-safety`）覆盖越多，运行时调用越少；运行时 Validator 兜底动态值。
