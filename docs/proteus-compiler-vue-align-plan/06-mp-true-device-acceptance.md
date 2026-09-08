# 06 · Vue 能力对齐真机验收（mp-true-device-acceptance）

> **2026-09-08 立项**。专项栏目：把 `VUE_COMPAT_MATRIX` 的**编译期状态**延伸到**真机运行时验收**。
> 动机：编译通过 ≠ 真机正确——`aligned` 只代表编译产物「翻译对了」，但产物在真机/模拟器上可能渲染错误、
> 抛 `ReferenceError`、被 Skyline/WebView 平台差异破坏（p-popover 遮挡、page-scroll、getCurrentInstance
> 都是「编译过但真机坏」的实例）。本栏目**逐个能力**自动化真机验收。

## 为什么需要（对齐神谕：compile-state ≠ runtime-correct）

- 矩阵（`vue-compat.ts`）是**编译期**三类状态：`aligned`（翻译对）/ `partial`（受限+警告）/ `unsupported`（报错）。
- 但「翻译对」≠「真机能跑对」——需真机运行时收割：
  - 产物是否为合法 WXML/JS（编译期已验，但平台 ES5/引用完整性运行时才暴露）
  - 渲染/交互是否与 Vue 语义一致（v-model 双绑、transition 状态机、provide-inject 联动）
  - console 是否零错（真机 bug 的「铁证」——首次进页第一动作）

## 跑法（唯一标准：wechatide skill-CLI，官方 Electron 版）

```bash
pnpm build:mp                 # 产出 examples/dist/mp-weixin
PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-vue-compat.test.ts
# 前置：微信开发者工具已开项目窗口 + skyline private config = skylineRenderEnable:true
```

**★推荐用框架规范命令（自动做管理副本+开窗+skyline，避免手工误配）**：

```bash
PROTEUS_IDE_CLI="/path/to/wechatwebdevtools.app/Contents/MacOS/wechatide" \
  npx tsx packages/cli/src/index.ts test e2e:mp examples
```

### ⚠️ 关键运维结论（2026-09-08 实测）：**根因 = 缺 `simulator_refresh`（编译），不是端口/窗口**

- `automation_*` 工具（`automation_navigate` 等）经 wechatide CLI（`transport: skill_call`，官方标准，非 miniprogram-automator）驱动 IDE 内部自动化服务；该服务需要**模拟器里有一个已编译加载的活动页面**才能寻址。
- **真正的坑**：`open_project_window` 只**开窗不编译**——小程序产物副本（`.proteus/e2e-mp`）没被编译加载进模拟器 → `automation_runtime_info` 报 `Cannot destructure 'rawPath' of getPageMetaByWebviewId(...) as null`（无活动页），`automation_navigate` 报 `Uncaught [object Object]`/`timeout waiting for automator response`，`reLaunch` 全挂。此时 `simulator_screenshot` 仍能过（只是截当前空屏）——**故不要被「截图能过」误导**。
- **解法**：`open_project_window` + skyline 之后、跑 vitest 之前**必须 `simulator_refresh`**（=工具栏编译，把小程序编译加载进模拟器）+ 稍等就绪。已在 `packages/cli/src/index.ts` 的 `test e2e:mp` 固化。
- **已验证**：加 `simulator_refresh` 后 `proteus test e2e:mp examples` → smoke + 11 条 Vue 能力真机验收 + p-popover **13/13 全绿**（复用窗口也稳，不再依赖 fresh/单窗）。

- `tests/e2e-vue-compat.test.ts` 命名含 `e2e-vue-compat` → 被 `pnpm test` 的 `--exclude "tests/e2e-*.test.ts"` 排除，
  **不进全量/verify**；未设 `PROTEUS_MP_E2E_WXIDE` 时 `describe.skipIf` 跳过（不破坏单测）。
- 每个用例结构（对齐 15 铁律）：① `reLaunch` 到能力演示页 ② **console 零错门禁**（进页第一动作）③ 读页 data → 能力断言。
- **已验证**：加 `simulator_refresh` 后 `proteus test e2e:mp examples` → smoke + 12 条 Vue 能力真机验收 + p-popover **14/14 全绿**（复用窗口也稳，不再依赖 fresh/单窗）。
- **★2026-09-08 栏目页化**：新建 `examples/pages/vue-compat-demo.vue`（规范栏目页，逐能力卡片 + 可观察状态），作为 CAPABILITY_CASES 主目标（不再复用 forms/provide-inject-demo 的零散页）；配套 `examples/components/model-demo`（defineModel v-model 契约组件）。

## 能力 → 演示页 → 真机断言（CAPABILITY_CASES）

能力 → 演示页 → 真机断言（`CAPABILITY_CASES`，主目标 = `vue-compat-demo`，12 能力）

| 能力（矩阵 name） | 演示页 route | 断言（读页 data / evaluate 触发） | 状态 |
|-------------------|--------------|-----------------------------------|------|
| `ref`(data) | `/pages/forms` | `count`/`name` 存在（ref→data） | ✅ harness |
| `computed` | `/pages/forms` | `double` 派生字段存在 + **bump() 后重算（count=1→double=2，响应式非一次性）** | ✅ harness |
| `watch` | `/pages/forms` | `bump()` 后 `watchLog` 更新为 `watch: …→…` | ✅ harness |
| `v-model` | `/pages/forms` | `setData({name})` 驱动双绑数据（name 用 typeof 判存在——初值读取不稳，避免脆断言） | ✅ harness |
| `v-if/v-for` | `/pages/forms` | `agree` 布尔存在（v-if 条件数据） | ✅ harness |
| `<transition>` | `/pages/forms` | `toggleCard()` 切状态机不崩 | ✅ harness |
| `provide/inject` | `/pages/provide-inject-demo` | `user`/`theme` 存在（provide 快照） | ✅ harness |
| `withDefaults` | `/pages/components-demo` | 组件 props 默认值生效（宏观：组件不崩） | 待扩 harness |
| `popover(measureRect/this-scope)` | `/pages/semantic-primitives-demo` | 打开不崩 + 面板定位 | 另见 `e2e-mp-popover.test.ts` |

> 说明：演示页**复用现有 demo 页**（forms/provide-inject-demo/semantic-primitives-demo），避免为每个能力造新页；
> 断言语义以「编译目标行为的运行时等价」为准——可与 `tests/vue-compat-advance.test.ts`（编译期）对照。

## 新增能力的规范（防打地鼠回归）

1. 在 `VUE_COMPAT_MATRIX` 定为 `aligned` 后，**同批**补真机断言：`CAPABILITY_CASES` 加一项。
2. 断言用**可观察状态**（页 data / evaluate 触发方法），不做「只保证不崩」的弱断言——能断语义就断。
3. 涉及组件实例测量的（popover）走 `adapter.measureRect(sel, this)`（决策 1b，MP 原生 this scope）。
4. 控制台断言：console 零错是**硬门禁**；错误行列出以利定位。

## 真机验收 ↔ 编译矩阵 的分工

| 层 | 载体 | 验什么 |
|----|------|--------|
| 编译期 | `tests/vue-compat-*`（matrix/aligned/compile） | 能力状态三选一；产物形态；不裸标识符/不抛错 |
| 真机运行时 | `tests/e2e-vue-compat.test.ts` | console 零错；Vue 语义的运行时等价；渲染/交互无误 |

## 与 wechatide skill 的关系

- 复用 `@proteus-vue/test-core/driver` 的 `createWxideMini`/`createDriver`（wechatide skill-CLI 封装，官方 Electron 标准）。
- 不引入 automator（与新版 IDE 不兼容，`15-mp-e2e-console-gate.md` 已弃用）。
- 真机验收**走自动化测试框架**（`@proteus-vue/test-core/driver` + wechatide skill-CLI，官方 Electron 版，automator 已弃用）——同 `e2e-mp-popover.test.ts` 既定模式，非手工。
- 运行需开发者工具 + skyline 环境（`PROTEUS_MP_E2E_WXIDE=1` 门控；未设环境或不满足时 `describe.skipIf` 跳过）——**不阻塞单测绿**，但真机验收本身是框架自动化执行。

## 待扩展（对齐基线加深）

- `nextTick`（真机断言 `wx.nextTick` 是否在渲染后回调）——需一个可观察的演示页。
- `v-html`（rich-text 渲染）、`:class/:style`（运行时 class/style 序列化）、`v-show`（hidden 切换）。
- `defineModel`/`defineComponent`（编译期 unsupported/待对齐后补真机）。
