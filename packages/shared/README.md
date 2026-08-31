# @proteus-vue/shared

Proteus 公共层——平台适配器（adapter 抽象 + mp/web 实现）+ 存储层（StorageAdapter 工厂/序列化/追踪）+ 全局类型声明（`wx` / `Page` / `RouteBuilder` / `MpEvent` shims）。

## 导出

| API | 说明 |
|-----|------|
| `adapter` | **平台适配器单例**：`getCurrentPages` / `navigateTo` / `systemInfo` 等平台差异归一（mp/web 实现按环境注入）——框架各层只依赖此接口，不直连 `wx` |
| `PlatformAdapter`（类型） | 适配器结构契约（形状兼容即用，便于自定义/测试注入） |
| `StorageAdapter` 工厂 / 序列化 / 追踪 | 存储层：`createStorageAdapter`（localStorage / wx storage 抽象）+ 序列化 + 变更追踪 |
| 全局类型声明 | `wx.*` / `Page` / `RouteBuilder` / `MpEvent` 等 shims（types-plan B3 的运行时侧补充，供业务 TS 编译） |

## 使用

```ts
import { adapter } from '@proteus-vue/shared'

// 框架内部统一走 adapter，业务拿到的是平台无关接口
const pages = adapter.getCurrentPages()       // MP 真实栈深 / Web 恒为 1
await adapter.navigateTo({ url: '/pages/x' })

// 自定义适配器注入（测试 / 新平台）
adapter.configure({ getCurrentPages: () => [...], navigateTo: async () => {} })
```

## 设计要点

- **零平台分支铁律的底座**：`adapter` 是框架各包（router / runtime / api）唯一允许的平台访问点
- 本包是**运行时最底层**：其余所有 `@proteus-vue/*` 运行时包都依赖它（发布拓扑最上游之一）
