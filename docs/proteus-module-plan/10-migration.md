# 迁移指南

## 目标

存量项目（直接 `require` / 全局注册 / 事件总线）零改动迁移到 Module Boundary Layer。

## 迁移工具

`proteus init module`（✅ 已实现）生成契约骨架；`proteus migrate module`（自动转换，待实现——当前手动按 Step 2-4 操作）。

## 步骤

### Step 1：初始化

```bash
proteus init module
# 生成 proteus-module.config.ts 骨架（defineModule 模板）
```

### Step 2：声明模块

编辑 `proteus-module.config.ts`，按业务域填 `name` / `version` / `dependencies` / `chunk`（骨架已含全部字段注释）。
多模块工程：每个业务域子目录放自己的 `proteus-module.config.ts`（`proteus module:check` 递归扫描）。

### Step 3：共享逻辑跨模块引用（B0）

页面/组件直接 `import` 相对路径共享模块（.ts/.js）——编译期自动转为 `require`（共享模块 esbuild bundle 为独立产物）：

```ts
// 共享模块（utils/format.ts）
export function formatTime(ts: number): string { ... }

// 页面引用（MP 端编译为 require('../utils/format.js')）
import { formatTime } from '../utils/format'
```

### Step 4：运行时编排（B2，可选）

```ts
import { createModuleSystem } from '@proteus/module'
const ms = createModuleSystem({ modules: [tradeModule, userModule] })
await ms.init()           // 按拓扑序初始化（依赖者后 init）
const trade = ms.getModule('trade')   // 类型安全访问
const lazy = await ms.loadModule(lazyModule)  // 懒加载（M7.3）
```
小程序端：`getApp().moduleSystem = ms` 挂载全局单例（页面切换不重建）。

### Step 5：验证（CI 门禁）

```bash
proteus module:check --graph   # 契约校验 + 环检测 + Mermaid
proteus audit module --dist dist/mp-weixin   # 综合审计（契约/图谱/体积/去重，全部硬卡）
# 全绿 = 迁移成功
```

## 兼容模式

迁移期间可开启 `legacy: true`，允许裸 `require` 继续工作（仅 warn），逐步迁移（config 扩展，待实现）。

## 回滚

模块化方案纯编译期 + 运行时共存，可随时关闭（config 开关），回退到原生 `require`。

## 常见问题

**Q：循环依赖不可避免怎么办？**
A：抽取公共逻辑到独立模块（如 `trade-shared`），或改用 `ModuleEvent` 事件通信。

**Q：分包体积超限？**
A：见 M7.6，把公共依赖移到主包 `common/`，或拆分模块。

**Q：全局事件总线怎么迁移？**
A：改为 `ms.eventBus.emit('trade:order:created', payload)`，事件名走契约。
