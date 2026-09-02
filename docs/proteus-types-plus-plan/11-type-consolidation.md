# 类型收口方案（2026-08 · 用户指示：类型统一收口到 @proteus-vue/types）

> **★文档迁移（决策 #313）**：原 `docs/proteus-types-plan/10-type-consolidation.md`（v1.0 plan 已并入 `proteus-types-plus-plan` v2.0）——本文件随 v1.0 目录整合迁移至此，内容为历史落地记录（T1-T4 已完成）。

> **★状态：✅ 全部落地（T1-T4，2026-08）**——公共类型已收口，各实现包 types.ts 为 re-export 兼容层，消费方零改动，689 测试全绿。

> 目标：所有**公共导出类型**定义统一放 `@proteus-vue/types`（单一来源），各实现包 `types.ts` 保留原路径作 **re-export 兼容层**——包内 import 与包外消费方**零改动**。

## 1. 收口边界

| 类别 | 处置 | 说明 |
|------|------|------|
| 公共导出类型（interface/type/联合）| ✅ 移入 @proteus-vue/types | CompileOptions/CompileResult/TransformRuleOverrides、RouteRecord/RouteMeta/NavigateOptions、CapabilityDefinition/CapabilityAPI、RequestConfig/RequestResponse、ProteusConfig、Platform/CapabilityPlatform/RouteTransition 等 |
| runtime 值（class/函数）| ⚪ 留实现包 | `ApiError`/`CapabilityError`（class）、`createTrace`/`lineAt`（函数）、`defineConfig` 等——types 包保持纯类型（铁律 #1） |
| 内部类型（非公共导出）| ⚪ 留各文件 | 各实现文件内部接口不移动 |
| 全局 ambient（shims）| ⚪ 留 shared/templates | 应用侧全局声明，随 tsconfig include 链走；templates 有独立副本 |
| 模块扩充（RouteParamsByName declare module）| ⚪ 留应用侧 | auto-routes 生成的 declare module 是应用侧机制 |

## 2. 依赖方向（无环）

```
@proteus-vue/types（零依赖，纯类型 + schema 数据 + 品牌/迁移）
   ▲ compiler / capabilities / router / api / plugin-vite（type-only import + re-export）
```
- 各包 `types.ts` 改为：`export type { ... } from '@proteus-vue/types'` + 本地保留 runtime 值
- type-only re-export → esbuild/tsc 擦除 → **MP 产物零运行时依赖**
- 各包 package.json 加 `@proteus-vue/types` dependency（tsc 解析 + npm 安装）

## 3. 执行批次（每批全绿提交）

| 批 | 内容 | 状态 |
|----|------|------|
| T1 | @proteus-vue/types 补全类型文件（platform/compiler/capabilities/router/api/config）| ✅（e2c54d5）|
| T2 | capabilities/router 两包 types.ts → re-export（CapabilityError 保留本地）| ✅（e2c54d5）|
| T3 | compiler/api/plugin-vite 三包 types.ts → re-export（ApiError 保留本地；config 的 ProteusConfig 移入）| ✅（下个提交）|
| T4 | 收尾：重复联合清理（CapabilityPlatform = Platform alias）、README/board 状态、CI 验证 | ✅ |

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 类型与实现分离后同步成本 | 公共契约类型低频变更；tsc 全仓校验保证一致；内部类型不移 |
| re-export 引入包间依赖 | type-only 擦除，产物无影响；依赖方向单向（实现包 → types）|
| RouteParamsByName 等生成机制 | 基接口在 types，declare module 扩充留应用侧（既有机制不动）|
| 测试 import 路径 | 消费方 import 路径不变（re-export 兼容），测试零改动 |

## 5. 验收

- `npm run verify` 全绿（689 测试基线）+ examples vue-tsc 0 错误
- 各包 dist 产物无 @proteus-vue/types runtime require（type-only 擦除验证）
- 消费方（examples/tests）import 路径零改动
