# 08 · 与其他 9 份计划的关系与接口契约

> 明确本计划（Types + Config Schema）与各运行时层、基建层的引用关系与变更同步规则。

---

## 1. 关系全景

```
                         ┌──────────────┐
                         │   Compiler   │ ← 产出 IR（被本计划类型化）
                         └──────┬───────┘
                                │ 使用 SFCIR/RouteIR/StoreIR...
                         ┌──────▼───────┐
                         │     CLI      │ ← 消费 ProteusConfig + audit 规则
                         └──────┬───────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   ┌────────────┐        ┌────────────┐        ┌────────────┐
   │  Platform  │        │ Lifecycle  │        │   Module   │
   │ (Platform) │        │ (AppPhase) │        │ (ModuleIR) │
   └────────────┘        └────────────┘        └────────────┘
          │                     │                     │
   ┌──────▼──────┐       ┌──────▼──────┐      ┌──────▼──────┐
   │   Pinia     │       │   Router    │      │     API     │
   │ (StoreIR)   │       │ (RouteIR)   │      │ (baseURL...)│
   └─────────────┘       └─────────────┘      └─────────────┘
          │                     │                     │
          └─────────┬───────────┘                     │
                    ▼                                 ▼
              ┌───────────┐                   ┌───────────┐
              │ Component │                   │ DevTools  │ ← trace 类型
              └───────────┘                   └───────────┘
```

**本计划是横切契约**：所有层 import `@proteus/types`，CLI 加载 `ProteusConfig`，Audit 引用 schema。

---

## 2. 接口契约（逐层）

| 计划 | 引用本计划什么 | 本计划提供的类型/产物 |
|------|--------------|---------------------|
| Compiler | IR 形状 | `SFCIR`/`RouteIR`/`StoreIR`/`ModuleIR`/`CapabilityIR` |
| CLI | 配置加载 + audit | `ProteusConfig` schema + `validateConfig()` + audit 规则骨架 |
| Lifecycle | 阶段钩子签名 | `AppPhase`/`LaunchType`/`LifecycleContext`/`PhaseHook` |
| Platform | 平台判别 | `Platform`/`assertPlatform()`/`matchPlatform()` |
| Router | 路由类型 | `RouteIR`/`RouteMeta`/`RoutesRegistry` |
| Pinia | store 注册表 | `StoreIR`/`StoresRegistry`/`Brand<StoreId>` |
| Module | 模块类型 | `ModuleIR`/`ModulesRegistry` |
| API | 配置字段 | `ProteusConfig['api']` |
| Component | 全局组件 | `ProteusConfig['components']` |
| DevTools | trace 结构 | `ValidationError`/`--trace-transform` 字段 |

---

## 3. 变更同步规则（铁律 #5 细化）

**任何 `proteus.config.ts` 字段变更须同步三处：**

1. **本计划 schema**（`02-m2-config-schema.md` 的 `ProteusConfigSchema`）
2. **CLI audit 规则**（`proteus-cli-plan` `03-m3-audit-doctor.md` 的规则列表）
3. **对应 transform JSDoc**（`transforms/` 里消费该字段的规则注释）

**CI 自动校验**：
- `schema-change-check`：检测 `schema.ts` 变更是否带 `migration` 条目
- `audit-rule-sync`：比对 schema 字段与 audit 规则覆盖率（缺规则即失败）
- `transform-doc-sync`：`proteus audit transform-docs` 检查 JSDoc 是否引用字段

---

## 4. 新增平台（如鸿蒙）的扩散路径

1. 扩展 `Platform` 联合：`'web' | 'skyline' | 'app' | 'harmony'`
2. 各 `switch (__PLATFORM__)` 编译报错 → 补全分支（穷尽检查）
3. Compiler codegen 加 `harmony` 后端
4. CapabilityIR 补 `harmony` adapter
5. **业务代码零改动**（类型收窄强制补全）

---

## 5. 验收

- [ ] 任一运行时层 import 类型无循环依赖
- [ ] schema 变更触发 CI 同步检查
- [ ] 新增 Platform 成员后全仓 `tsc` 报错点可穷尽定位
- [ ] Audit 规则覆盖率 = schema 字段数（100%）
- [ ] DevTools 能解析全部 trace 类型
