# M1 模块契约定义

## 目标

每个业务域用 `proteus-module.config.ts` 声明自身元信息，编译期据此构建依赖图谱。

## 契约结构

```ts
// proteus-module.config.ts
import { defineModule } from '@proteus/module'

export default defineModule({
  // 模块标识（全局唯一）
  name: 'trade',

  // 版本（用于版本协商）
  version: '1.2.0',

  // 依赖的其他模块
  dependencies: {
    user: '^1.0.0',
    payment: '^2.0.0',
  },

  // 对外导出的公共契约（仅 types/interfaces/events/config）
  exports: {
    types: ['./types', './models'],
    interfaces: ['./services/ITradeService'],
    events: ['./events'],
    configSchema: './config.schema.json',
  },

  // 分包策略（对齐 Router M7.1 chunk）
  chunk: 'trade',

  // 预加载规则（Skyline preloadRule）
  preload: ['user'],

  // 所需平台能力（Capability，见 Platform 层）
  capabilities: ['payment', 'share'],

  // 生命周期钩子
  lifecycle: {
    onInit: './lifecycle/init',
    onDestroy: './lifecycle/destroy',
  },
})
```

## 公共契约四件套（唯一允许跨模块 import）

| 类型 | 内容 | 示例 |
|------|------|------|
| **types** | 类型定义 | `TradeOrder`, `OrderStatus` |
| **interfaces** | 服务接口 | `ITradeService` |
| **events** | 事件契约 | `TradeEvents = { 'order:created': ... }` |
| **configSchema** | 配置校验 | JSON Schema |

## 禁止项

- ❌ 业务逻辑放进 `exports`（数据走 Pinia，逻辑走 API）
- ❌ 直接 `import { xxx } from '@/modules/trade/components'`（走 UI 组件必须走 Boundary）
- ❌ 模块内直接 `wx.*` / `window.*`（走 Platform Capability）

## 编译期校验

1. 扫描所有 `proteus-module.config.ts`
2. 构建 DependencyGraph
3. 检测循环依赖 → 报错
4. 生成 chunk manifest（供 Router M7.1 消费）
5. `--trace-transform` 输出：`module 'trade' → chunk 'trade' → [user, payment]`

## 测试

- `fixtures/modules/` 下放正常 + 循环依赖样例
- 循环依赖检测单测：断言抛错且提示清晰
- Schema 校验单测：缺失字段报错
