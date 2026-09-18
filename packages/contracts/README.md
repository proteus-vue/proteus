# @proteus-vue/contracts

**Proteus 跨层共享 DTO 契约**（架构规约 L0 + types-plan §07）。

## 定位

消除 Router/Module/API 各自定义 DTO 的重复（铁律 #9「同名必同义，契约先行」）——
跨层传递的类型统一在本包定义，**零运行时依赖纯类型**。

## DTO 清单

| 类型 | 域 | 消费方 |
|------|-----|--------|
| `RouteRecord` / `RouteMeta` / `RouteTransition` | 路由 | Router codegen、RouterView 转场映射、gen-routes |
| `ApiResponse<T>` | 网络 | 跨层响应传递（运行时 `RequestResponse` 含 config，归 api-types） |
| `StoreSnapshot` | 状态 | DevTools 导入状态、pinia-sync 协同、审计 |
| `CapabilityDescriptor` | 能力 | capabilities:manifest 产物、平台能力矩阵、审计 |

## 依赖方向

```
contracts（零依赖） ← types（re-export 兼容） ← 各实现包
```

types 包 re-export 本包类型（消费方经 `@proteus-vue/types` 零改动接入）。

## 使用

```ts
import type { RouteRecord, ApiResponse, StoreSnapshot, CapabilityDescriptor } from '@proteus-vue/contracts'
```
