# @proteus-vue/capabilities

Proteus 能力体系（platform-plan B1-B5）——Capability 契约 / Adapter Registry / 编译期分叉 / 运行时降级 / 平台规范。业务代码只使用 `capability` / `useCapability()`，无任何平台判断。

## 导出

| API | 说明 |
|-----|------|
| `defineCapability(def)` | 定义能力描述文件（`meta.id` kebab-case / `tier` 1-4 / `adapters` 平台映射 / 可选 `fallback` 降级） |
| `registerCapability(adapter)` / `hasCapability(id)` | 运行时注册中心（以 adapter 为单位） |
| `CapabilityRegistry` | 注册中心类（多实例隔离工厂，B2） |
| `defineAdapter(platform, factory)` / `validateAdapter` | adapter 注册与校验 |
| `detectPlatform()` | 平台探测（web / skyline / app） |
| `useCapability(id)` / `resolveCapability(id)` | **业务唯一入口**：按当前平台解析 adapter，缺失走 fallback |
| `matchPlatform` / `assertPlatform` / `exhaustiveCheck` / `getPlatform` | **平台守卫（铁律 #4）**：替代 `#ifdef` 的编译期分支 |
| `validateCapabilityDefinition(input)` | 纯函数校验（id / tier / adapters / fallback 合法性） |

## 子路径（node 工具，不进运行时产物）

| 子路径 | 说明 |
|--------|------|
| `@proteus-vue/capabilities/scan` | 扫描 `capabilities/*.capability.ts` → `capability-manifest.json`（编译期契约，CLI `capabilities:manifest` 共用） |
| `@proteus-vue/capabilities/check` | 业务 `useCapability('id')` 引用扫描 → 对照 manifest 平台覆盖 → 缺失报告（编译期报错/警告） |

## 使用

```ts
import { useCapability, defineCapability, matchPlatform } from '@proteus-vue/capabilities'

// 1. 能力描述文件（capabilities/share.capability.ts）
defineCapability({
  meta: { id: 'share', tier: 2, name: '分享' },
  adapters: {
    web: () => () => navigator.share?.({ title: document.title }),
    skyline: () => () => wx.showShareMenu({ menus: ['shareAppMessage'] }),
  },
  fallback: 'clipboard',
})

// 2. 业务使用——零平台分支
const share = useCapability('share')
share?.('标题')

// 3. 平台守卫（铁律 #4，替代 #ifdef）
matchPlatform({
  web: () => 'web-only',
  skyline: () => 'mp-only',
  app: () => 'app-only',
})
```

## 设计要点

- **铁律 #1**：业务代码只依赖 `useCapability` 接口，适配与降级全部收敛在能力定义内
- **平台裁剪**：编译期按当前平台裁剪产物，运行时 registry 按平台探测选择 adapter（缺失能力编译期可见，B3）
