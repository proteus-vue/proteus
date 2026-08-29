# M2 ModuleOrchestrator + 生命周期

## 目标

提供运行时模块管理器，负责模块初始化、依赖排序、生命周期调度。

## API 设计

```ts
import { createModuleSystem } from '@proteus/module'

const ms = createModuleSystem({
  modules: [tradeModule, userModule, paymentModule],
})

// 启动（按拓扑序初始化）
await ms.init()

// 获取模块（类型安全）
const trade = ms.getModule('trade')  // TradeModule
```

## 生命周期

```
register → resolve → init → ready → active → inactive → destroy
```

| 阶段 | 时机 | 可做 |
|------|------|------|
| `register` | 模块注册 | 声明依赖 |
| `resolve` | 依赖图构建完成 | 校验版本兼容性 |
| `init` | `ms.init()` | 创建服务实例、注册 Capability |
| `ready` | 所有依赖模块 ready | 订阅事件、拉取初始数据 |
| `active` | 模块进入前台 | 恢复轮询、刷新 |
| `inactive` | 模块进入后台 | 暂停轮询、缓存 |
| `destroy` | 模块卸载（App/页面销毁） | 清理定时器、解绑事件 |

## 模块实例结构

```ts
interface ModuleInstance {
  name: string
  version: string
  services: Record<string, any>  // 业务服务（懒创建）
  events: ModuleEventBus
  state: 'registered' | 'init' | 'ready' | 'active' | 'destroyed'

  init(): Promise<void>
  destroy(): Promise<void>
}
```

## 版本协商

依赖声明 `^1.0.0` 时，若实际解析到 `2.0.0`：
- 检查 `peerDependenciesMeta` 是否允许
- 不允许 → 抛 `VersionMismatchError`，列出冲突链
- 允许 → 记录 warning，继续

## 单例保证

小程序端 `createModuleSystem` 结果挂载到 `getApp().moduleSystem`，**全局唯一**。页面切换不重建（对齐全局播放条场景）。

## 测试

- 拓扑序初始化单测（mock 模块，断言 init 顺序）
- 生命周期切换单测（active/inactive 触发轮询启停）
- 版本冲突单测（断言抛错信息）
