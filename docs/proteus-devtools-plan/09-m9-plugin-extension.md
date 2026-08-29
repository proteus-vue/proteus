# M9 — 插件扩展机制

## 目标

让业务 / 第三方为 DevTools 增加自定义泳道、面板、命令，而不改核心。

## 插件 API

```ts
export interface DevToolsPlugin {
  name: string
  version: string
  setup(ctx: PluginContext): void | Promise<void>
}

export interface PluginContext {
  bus: TraceBus                    // 订阅事件
  panel: PanelAPI                  // 注册自定义面板
  commands: CommandRegistry        // 注册命令（palette 调用）
  storage: KVStorage               // 持久化插件配置
}
```

## 注册方式

```ts
// proteus.config.ts
export default defineConfig({
  devtools: {
    plugins: [
      () => import('@proteus/devtools-plugin-network').then(m => m.default),
    ],
  },
})
```

懒加载：插件在面板打开时才 `import()`，避免启动开销。

## 内置插件（参考实现）

| 插件 | 功能 |
|------|------|
| `devtools-plugin-network` | 增强 API 瀑布 + 请求重放 |
| `devtools-plugin-i18n` | 语言包热切换 + 缺失 key 检测 |
| `devtools-plugin-accessibility` | Skyline 语义树可访问性检查 |

## 安全沙箱（M7）

- 插件默认无 `eval` / 无 Node 文件访问（浏览器扩展天然隔离）
- 面板渲染在 `<iframe sandbox>` 内，禁止跨域 fetch（除白名单）
- 插件 manifest 声明权限：`storage` / `network` / `commands`

## Registry

```ts
class PluginRegistry {
  register(plugin: DevToolsPlugin): void
  unregister(name: string): void
  async activate(name: string): Promise<void>
  list(): Array<{ name: string; active: boolean; version: string }>
}
```

激活顺序由 `peerDependencies` 拓扑排序（对齐 Module 依赖图算法），循环依赖报错。

## 验收

- 第三方插件注册新泳道，事件正常流入且不污染核心缓冲
- 插件异常被捕获，面板提示"插件崩溃"，核心不受影响
- 循环依赖插件在 activate 时报错并给出拓扑排序建议
