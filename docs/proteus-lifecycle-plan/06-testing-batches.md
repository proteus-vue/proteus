# 06 — 测试迁移 + 分批执行策略

## 一、测试矩阵

### 四层测试

| 层级 | 测试内容 | 工具 |
|------|---------|------|
| L1 单元 | Orchestrator 阶段执行 / 超时 / 降级 | Vitest |
| L2 集成 | defineApp → 三端产物验证 | Vitest + fixture |
| L3 跨端 | Web/Skyline/App 生命周期一致性 | 模拟运行时 |
| L4 E2E | 真实小程序 + 浏览器实测 | Playwright / miniprogram-simulate |

### 关键测试用例

```
describe('LifecycleOrchestrator', () => {
  it('按顺序执行 5 个阶段', () => { ... })
  it('阶段超时时执行 fallback', () => { ... })
  it('某阶段失败不阻塞后续', () => { ... })
  it('并行子任务全部完成才进下一阶段', () => { ... })
  it('trace 记录完整 phase 链', () => { ... })
})

describe('Skyline 映射', () => {
  it('defineApp.onShow → App.onShow', () => { ... })
  it('页面 onUnload 触发 store $dispose', () => { ... })
  it('全局组件不随页面销毁', () => { ... })
  it('onMemoryWarning 触发缓存清理', () => { ... })
})

describe('冷/热/恢复启动', () => {
  it('cold: 完整执行 5 阶段', () => { ... })
  it('warm: 跳过 bootstrap', () => { ... })
  it('recover: 触发 session 恢复', () => { ... })
})
```

### 跨端一致性矩阵

| 场景 | Web | Skyline | App |
|------|-----|---------|-----|
| 冷启动 5 阶段 | ✅ | ✅ | ✅ |
| onShow/onHide | visibilitychange | App.onShow/onHide | native delegate |
| 页面 onUnload 清理 | onUnmounted | onUnload | onDestroy |
| 内存警告 | N/A | wx.onMemoryWarning | didReceiveMemoryWarning |
| 崩溃恢复 | sessionStorage | Storage | 状态文件 |

## 二、迁移指南

### 从"手写 App/Page"迁移到 defineApp/definePage

**Before（原生小程序）**：
```js
App({
  onLaunch() { /* ... */ },
  onShow() { /* ... */ },
})
```

**After（Proteus）**：
```ts
export default defineApp({
  bootstrap(ctx) { /* onLaunch 前半 */ },
  onShow(ctx) { /* ... */ },
})
```

迁移工具（`proteus migrate lifecycle`）：
1. 扫描 `App({...})` → 转为 `defineApp({...})`
2. 扫描 `Page({...})` → 转为 `definePage({...})`
3. 自动映射钩子名（`onLaunch` → `bootstrap` + `coreReady`）
4. 检测 `onUnload` 中缺失的清理代码 → 补 `store.$dispose()`

### 兼容策略
- 保留 `App()` / `Page()` 支持（不强制迁移），但 warn
- `defineApp` 内部仍可调 `App()`（渐进式）
- 过渡期允许混写

## 三、分批执行策略（防撑爆）

### Batch 拆分

```
B1 (M1)  → 01-m1-phases.md
           defineApp API + 类型 + 阶段定义
           产物：app.ts 可运行骨架

B2 (M2)  → 02-m2-orchestrator.md
           LifecycleOrchestrator + 超时/降级
           产物：编排器核心

B3 (M3)  → 03-mapping.md (Web 部分)
           Web 端映射 + 测试
           产物：Web 可跑

B4 (M4)  → 03-mapping.md (Skyline 部分)
           Skyline 映射 + appBar + 页面级 store 清理
           产物：Skyline 可跑

B5 (M5)  → 03-mapping.md (App 部分)
           Native 桥接接口定义
           产物：接口稳定（暂不实现原生侧）

B6 (M6)  → 04-page-component.md
           definePage + defineComponent + retainState
           产物：页面/组件生命周期完整

B7 (M7)  → 05-reliability-observability.md (M7)
           超时/隔离/恢复/内存
           产物：可靠性加固

B8 (M8)  → 05-reliability-observability.md (M8)
           trace/DevTools/CI 审计
           产物：可观测完整

B9       → 06-testing-batches.md
           测试矩阵 + 迁移工具 + CI 集成
           产物：验收通过
```

### 分批依赖图

```
B1 ──→ B2 ──┬──→ B3 (Web)
             ├──→ B4 (Skyline) ──→ B6 (Page/Component)
             └──→ B5 (App)
                          ↓
                    B7 (M7) ──→ B8 (M8) ──→ B9 (测试/CI)
```

**关键路径**：B1 → B2 → B4 → B6 → B7 → B8 → B9

### 每批执行规则

每批 = 1 PR = LLM 单次 ≤ 3 个文件，上下文只包含：
- `README.md`
- `00-overview.md`
- 当前批次对应的模块文件
- 直接依赖的已完成模块

**绝不**一次把 10 份全塞进对话。

### Prompt 模板

```
【角色】Proteus 框架核心开发者
【任务】执行 Batch X（{批次名}）
【上下文】（仅以下文件，勿读其他）
  - README.md
  - 00-overview.md
  - {当前模块}.md
  - {直接依赖模块}.md（如已完成）
【要求】
  1. 严格按 {当前模块}.md 的 API 设计实现
  2. 产物需通过 {模块}-test.ts 用例
  3. 对齐 --trace-transform 输出规范
  4. 遵循铁律（见 00-overview.md）
【产出】
  - src/lifecycle/{文件名}.ts
  - tests/{文件名}-test.ts
  - 更新 CHANGELOG
```

## 四、验收 CheckList

> ★执行状态（2026-08 盘点）：**B1-B9 全部 ⬜ 未实现**（无 defineApp / LifecycleOrchestrator 代码）——纯规划态。
> 现有能力覆盖：页面/组件级生命周期（编译 onLoad/onReady/onUnload 映射 + runtime createPage/createComponent ✅）；App 级 onLaunch 生成（appSkeleton ✅，非阶段化）。
> **缺口**：App 级五阶段编排（bootstrap→interactive）+ 超时/降级 + --trace-lifecycle + 冷热分离——未做。
> 可独立先行：B1（defineApp API + 五阶段定义）+ B2（LifecycleOrchestrator：顺序执行/超时降级/错误隔离/trace）——不依赖 api/component（API 阶段可空跑）；B3-B9 依赖对应板块（Web/Skyline 映射、页面清理、App 原生、可观测、迁移）。

- [x] `defineApp` 五阶段按顺序执行（B1+B2 ✅：runtime/src/lifecycle.ts，2026-08）
- [x] Skyline 端 `App.onShow` 正确映射（B4 ✅ 部分：appSkeleton 生成 App 级 onShow/onHide 调试钩子；★MP 端阶段化受 app.js 直出无模块约束——全量模式入口自定义 App() 手动编排）
- [x] 页面 `onUnload` 自动 `$dispose` store（B6 ✅：编译器检测 useXxxStore 页面 → onUnload 注入 $dispose + 置空，2026-08）
- [x] `--trace-lifecycle` 输出完整（B2 ✅：Orchestrator trace + 阶段超时降级链）
- [ ] 冷启动 < 1s（中等机型）（B9）
- [ ] 迁移工具可自动转换 `App()` → `defineApp()`（B9）
- [ ] CI 审计通过（B9）

## 五、与现有计划的整合

Lifecycle 是所有层的交汇点，**必须最先稳定**：

```
Sprint 1: Lifecycle B1-B2（编排器骨架）
Sprint 2: Pinia M1-M2（依赖 coreReady 阶段）
Sprint 3: API A1（依赖 coreReady 阶段）
Sprint 4: Module B1-B3（依赖 bootstrap 阶段）
Sprint 5: Router B1-B5（依赖 navigationReady 阶段）
Sprint 6: Component B1（依赖 beforeFirstPaint 阶段）
```

调整建议：把 Lifecycle 提前到 **第一个执行的计划**，为其他五份文档提供生命周期契约。
