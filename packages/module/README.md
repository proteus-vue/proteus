# @proteus-vue/module

Proteus 模块化（module-plan）——模块契约 `defineModule` + 校验（B1）+ 依赖图谱 / 分包评估 / 重复检测。业务域声明式边界，是编译期依赖图谱与分包规划的地基。

## 导出

| API | 说明 |
|-----|------|
| `defineModule(config)` | **模块契约声明**：`id` / `requires`（依赖模块）/ `pages` / `api` 边界 + 编译期校验 |
| `validateModuleConfig(input)` | 纯校验（`ModuleValidationIssue[]` 结果） |
| `scanModuleConfigs` / `loadModuleConfig` / `walkModuleConfigs` / `formatModuleCheck` | 扫描 / 加载 / 遍历模块配置（CLI `module:check` 共用） |
| `DependencyGraph` / `buildModuleGraphManifest` / `moduleGraphToMermaid` | 依赖图构建 + Manifest + Mermaid 可视化（循环依赖 `CycleError`、版本冲突检测） |
| `createModuleSystem` / `createModuleEventBus` | 模块系统运行时（按契约加载实例 + 事件总线），`satisfies` / `parseSemver` 语义化版本比对 |
| `generateRollupOptions(options)` | 模块化 Web 产物 codegen（按依赖图拆分 chunk） |
| `SUBPACKAGE_LIMITS` / `scanSubPackages` / `evaluateSubPackageSizes` | 小程序分包规划：主包/分包大小评估（2MB/20MB 限制） |
| `readSubPackageRoots` / `scanDuplicateModules` | 分包根扫描 + 跨分包重复模块检测 |
| `auditModule(module)` | 模块审计（依赖/边界/大小） |

## 使用

```ts
import { defineModule, validateModuleConfig, DependencyGraph } from '@proteus-vue/module'

// 1. 模块契约（proteus-module.config.ts）
const cart = defineModule({
  id: 'cart',
  requires: ['catalog', 'user'],
  pages: ['pages/cart/index'],
  api: { expose: ['addItem'], consume: ['catalog.getSku'] },
})

// 2. 校验（纯函数）
const result = validateModuleConfig({ id: 'cart', requires: ['catalog'] })
if (!result.ok) console.error(result.errors)

// 3. 依赖图 + 循环检测
const graph = new DependencyGraph()
for (const cfg of allConfigs) graph.addModule(cfg)
console.log(graph.detectCycles()) // CycleError[]
```

## 子路径

| 子路径 | 说明 |
|--------|------|
| `@proteus-vue/module/contract` | 契约声明 + 校验（`defineModule` / `validateModuleConfig`） |
| `@proteus-vue/module/scan` | 配置扫描 / 汇总（node 工具） |

## 设计要点

- 模块边界声明式：`requires` 显式依赖、`api.expose/consume` 接口边界——编译期即可检查越权引用
- 分包规划与重复检测为构建期工具能力，业务代码不直接依赖
