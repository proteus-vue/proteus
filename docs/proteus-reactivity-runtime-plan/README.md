# Reactivity 运行时（动态引入 @vue/reactivity）专项

> **2026-09-08 立项**。背景：编译器目标是「尽可能消除 unsupported/partial」。`isReactive`/`isReadonly`/`isProxy`/`readonly`/`reactive` 被标 `unsupported` 的根因是——我方 MP 编译器走**编译期内联响应式**（`ref`→data、`computed`→派生字段、`reactive`→普通 data 对象、**无运行时 Proxy**），所以 `isReactive(reactive obj)` 语义丢失（无 `ReactiveFlags.IS_REACTIVE` 标记位）。本专项评估引入 **运行时 reactivity**（参考 uni-app `@dcloudio/uni-mp-vue`）。

## 关键结论（已实证，2026-09-08）

**动态引入 `@vue/reactivity` + setData 桥 完全可行；核心是 setData 桥（工程量），不是语义障碍。**

实证（纯 JS 模拟 MP 逻辑层）：
- `isReactive(reactive({a:1}))` → **true**（Proxy 标记位，与 Web 同语义）✅
- `isProxy(reactive())` / `isReadonly(readonly())` / `isProxy(readonly())` → true ✅
- `isReactive(普通对象)` → false ✅；`isRef(ref())` → true ✅
- `reactive` 对象变更可读、JSON 可拍平给 WXML（setData 传扁平对象）✅
- **唯一真工作** = reactivity Proxy 变更 → setData 同步桥（uni-mp-vue 核心；语义层面零障碍）

## 为什么 uni-app 能 isReactive 可用（参考）

`@dcloudio/uni-mp-vue` 给小程序端提供**裁剪版但完整的 Vue3 reactivity 运行时**——reactivity 核心从 `@vue/reactivity` 复用（reactive→Proxy + `ReactiveFlags` 标记位），并**把 Proxy 读写桥接到 setData 同步模型**。所以 isReactive/readonly/isProxy 与 Web 同语义，且 reactive 能驱动视图更新。

**我方差异**：`@proteus-vue/runtime` 无运行时 reactivity——编译期内联（ref→data、无 Proxy）→ isReactive 语义丢失。**我们同样可复用 `@vue/reactivity`（无需造轮子）**，参考 uni-mp-vue 加 setData 桥。

## 落地路径（方案 B：ref 保留内联 + reactive/readonly 走运行时，动态按需注入）

| 能力 | 当前 | 目标 | 机制 |
|------|------|------|------|
| `ref`/`computed`/`watch` | aligned（内联） | 不变 | 保持编译期内联（MP 高效模型） |
| `isReactive`/`isReadonly`/`isProxy` | unsupported | aligned | require `@vue/reactivity`（只读 API，最轻） |
| `reactive`/`readonly`/`shallowReactive`/`shallowReadonly` | partial/unsupported | aligned | require + **setData 桥**（视图数据） |

- **动态引入（按需）**：编译器检测源码使用上述 API → 产物注入 `require('@vue/reactivity')`；**未用不注入**（普通页面保持纯内联轻量）——满足「有的不需要」。
- **setData 桥**：reactive/readonly Proxy set → 拍平写入 `this.data`（`{ 'user.name': v }` 扁平 key），dispose 时解绑——参考 uni-mp-vue 做法；需处理深层嵌套/数组/嵌套 ref 解包。
- **与 ref 内联的边界**（Vue 语义一致性，需真机复核）：
  - `isRef(reactive)` → false（运行时，reactive 非 ref）✅；`isRef(ref)` → true（我们编译期内联，ref 来源∈ref/computed→true）✅
  - `isReactive(ref)` → false（运行时，ref 非 Proxy）✅；`isReactive(reactive)` → true（运行时 Proxy）✅
  - 风险：**跨线程序列化把 Proxy 拍平**（setData 传输后丢失标记位）——若在 onPage 前的 Proxy 对象被序列化给 WXML，标记位丢失是预期（WXML 只需值）；isReactive 应在逻辑层（App Service）调用（Proxy 未序列化时）→ 语义保持。需验证。

## 工作量与风险

- **主要工作量**：setData 桥（reactive/readonly 视图数据驱动）+ 深层嵌套/ref 解包 + 真机复核（跨线程/跨组件）。
- **风险**：引入运行时依赖到 MP 产物（打包 ESM→CJS/ES5，参考 uni-mp-vue 打包产物）；与现有"ref→data 内联"模型并存的一致性（边界如上）。
- **收益**：消除 `isReactive/isReadonly/isProxy/readonly/reactive` 的 unsupported/partial；超级应用（需运行时 reactivity 的远程/复杂页面）按需拿到真语义。

## 决策点

1. **是否立项**：引入运行时 reactivity + setData 桥（一次中型改动），而非仅编译期内联判断。
2. **范围**：先做只读 API（isReactive/isReadonly/isProxy）最轻；再补 reactive/readonly 视图数据（含 setData 桥）。
3. **推荐**：先立概念验证——编译器对含 reactive/isReactive 的 SFC 按需注入 require + reactive 走运行时，真机验 isReactive=true + reactive 变更刷新视图；通过再全量推广。

## 关联

- `docs/proteus-compiler-vue-align-plan/README.md`（消除 unsupported/partial 总路线，本专项是其子方向）
- `docs/compiler-platform-alignment.md`（glass-easel 平台语义）
- `docs/proteus-platform-plan` / 超级应用（HostContainer 沙箱，G-42）——若需跨业务/运行时 reactivity 可接入本专项
