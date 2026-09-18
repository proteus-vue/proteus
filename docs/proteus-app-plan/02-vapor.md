# 02 · Vapor 兼容（Web 端 Vapor 模式）

## 目标

`@vue/vapor` 编译 Web（无虚拟 DOM、更小包体、更快）+ Proteus MP 编译管线并存——**同一份源码双模式可编译**。

## 1. 为什么 Vapor 与 Proteus 哲学同构

| 维度 | Vapor | Proteus MP |
|------|-------|-----------|
| 虚拟 DOM | ❌ 拒绝（codegen 直出命令式更新） | ❌ 无 DOM（编译期映射原生标签） |
| 更新方式 | reset/effect 精准命令式 | setData 依赖追踪 + 深层叶路径 diff |
| 产物 | 编译器生成 JS（无运行时 diff） | 编译器生成 wxml/wxss/js |

> Vapor 的 codegen 借鉴已落地（v0.4：setData 路径化写入 = Vapor reset/effect 同构）。
> v0.6 对照 Vapor 运行时做基准，并验证双模式可编译。

## 2. 双模式构建

```
业务源码（标准 Vue SFC）
├── Vapor 模式（Web）  → @vue/vapor 编译 → 无虚拟 DOM 的 Web 产物
└── Proteus 模式（MP） → Proteus 编译管线 → wxml/wxss/js
```

**双模式约束**：
- 业务代码只用 Vapor 支持的特性子集（模板语法/组合式 API）
- 不支持的特性（如有冲突的运行时 API）→ 编译期矩阵标记

## 3. 特性子集兼容矩阵（B6 产出）

| 特性 | Vapor | Proteus MP | 备注 |
|------|-------|-----------|------|
| 模板（v-if/v-for/v-model/v-bind/:class/:style） | ✅ | ✅ | 已对齐 |
| 组合式 API（ref/computed/watch/provide/inject） | ✅ | ✅ | vue-compat-advance 已覆盖 |
| 组件（props/emits/slots） | ✅ | ✅ | 作用域插槽 MP 限制（Batch 7） |
| Transition | ✅ | ✅ | 编译注入动画 |
| 生命周期 | ✅ | ✅ | 映射完成 |
| 动态组件 / 自定义指令 | 🟡 | ⚠ 警告 | 平台限制清单 |

## 4. 基准（v0.6 对照）

- 包体：Vapor Web vs 标准 Vue Web vs Proteus MP 产物
- 渲染性能：setData 依赖追踪 vs Vapor reset/effect（同构对照）
- 验收阈值：Vapor Web 构建通过 + 基准达标（roadmap §6）

## 5. 批次（详见 09-execution-batches.md B6）

1. 双模式构建验证：同一源码 Vapor Web + Proteus MP 均可编译
2. 特性子集矩阵落地（不兼容特性编译期标记）
3. 基准对比（包体/渲染性能）
4. Vapor codegen 借鉴回顾（setData 路径化写入对齐确认）

## 6. 验收

- [ ] 同一份示例代码 Vapor Web 构建通过 + Proteus MP 构建通过
- [ ] 特性矩阵文档化（兼容/不兼容清单）
- [ ] setData 依赖追踪基准达标（对照 Vapor 运行时）
