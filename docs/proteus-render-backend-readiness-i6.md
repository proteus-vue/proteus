# I6 后端生产就绪度评估

> 任务卡：**I6**（`Proteus_缺口补齐任务卡清单.md`）· 日期：2026-09-29
> 评估对象：**五后端**（Headless / VueDom / Native / Flutter / Hybrid，即卡内口径）
> 采集方式：**跑真实代码**（`runBackendConformance` + 能力位读取 + 宿主证据盘点），非手写印象

---

## 0. 结论速览（★三档就绪度）

| 后端 | 接口完整性 | 真机嵌入 | 综合判定 | 一句话 |
|---|---|---|---|---|
| **Headless** | **13/13** ✅ | 不需要（纯内存） | 🟢 **生产就绪** | 参考实现；SSR/测试/AI 无设备回归的直接载体 |
| **VueDom** | **13/13** ✅ | Web 即宿主（浏览器） | 🟢 **生产就绪** | Vue DOM nodeOps 全复用；Web 端实际在用 |
| **Flutter** | **13/13** ✅ | ❌ 无宿主 | 🟡 **原型（映射层就绪，真机未验）** | 语义→widget 树映射完成，未在真设备跑过 |
| **Hybrid** | （见 §4） | ❌ 无宿主 | 🟡 **原型** | 纹理共享 + 分区切后端；无真机证据 |
| **Native×3** | **13/13** ✅ | ✅ iOS/Android 有宿主 | 🟡 **原型 + 生产双轨（★见 §3）** | **接口层是原型（mock 适配器）；真机链路走另一条路径** |

★**最重要的一条结论（§3 详述）**：Native 有**两条路径**，评估时必须分开看——
`render-backend/native.ts`（SPI 层的 native-ios/android/harmony，**缺省 mock 适配器**）
与 `renderer-app/adapters/selfdraw.ts`（**真机实际走的自绘适配器**，有 22 份 iOS 报告 + 30 个 Android 验收目录）。
**卡里"Native 原型在、生产未就绪"的准确含义是前者**；后者已有大量真机证据（但这不等于 SPI 层就绪）。

---

## 1. 能力矩阵（★能力位来自**实际读取**，非文档抄录）

| 维度 | Headless | VueDom | Native×3 | Flutter | Hybrid |
|---|---|---|---|---|---|
| `layout` | none（不排版） | native（浏览器） | native | **yoga** | 继承子后端 |
| `glass` | none | L1 | **L3** | **L3** | 继承 |
| `blur` | none | approximate | **true** | **true** | 继承 |
| `animation` | js | js | **native** | **native** | 继承 |
| `textureSharing` | false | false | **true** | **true** | **true（本后端核心）** |
| `remoteRendering` | false | false | false | false | false |
| `ssr` | **true** | false | false | false | false |
| `input` | touch | touch, **cursor** | touch, **cursor, remote** | touch, cursor, remote | 继承 |

**读法**：`layout: none` 的 Headless 不排版（它是"语义树容器"，不是渲染器）；
`glass: L1` 的 VueDom 只有基础玻璃（浏览器能力上限）；Native/Flutter 是 L3 全档。
★**`remoteRendering: false` 全后端一致**——远程渲染未实现（诚实边界，非某一后端缺失）。

---

## 2. 接口完整性（conformance 实测 · 六后端全绿）

`runBackendConformance` 13 项检查（必选方法 / 句柄唯一性 / 能力枚举合法 / 可选方法类型）：

| 后端 | 结果 |
|---|---|
| headless | **13/13** ✅ |
| vue-dom | **13/13** ✅ |
| native-ios / native-android / native-harmony | **13/13** ✅ |
| flutter | **13/13** ✅ |

★**评估过程中的一个自纠（记录以免重犯）**：首轮探针报 **Native×3 未通过 `createElement.unique`**，
看似真缺陷。查明是**我的调用错误**——`createNativeBackend(adapter?, platform?)` 第一参是
**适配器**、第二参才是 platform，我写成 `createNativeBackend({ platform: 'ios' })`
⇒ 对象被当 adapter（无 `createView`）⇒ 抛错 ⇒ 判据失败。
★**教训**：跨包调用先读**签名**（或抄既有测试的用法），别按参数名猜。

---

## 3. ★Native 的双轨结构（本卡最需要说清的一点）

| | **SPI 层**（`render-backend/native.ts`） | **真机链路**（`renderer-app/adapters/selfdraw.ts`） |
|---|---|---|
| 定位 | G-27 B4 的 `ProteusRenderBackend` 实现 | App 端实际运行的渲染适配器 |
| 适配器 | **`createMockNativeAdapter()`（缺省 mock）** | 宿主原生实现（Swift / Java） |
| 证据 | conformance 13/13（**接口正确，但跑的是 mock**） | iOS **22 份**报告 · Android **30 个**验收目录 |
| 成熟度 | 🟡 **原型**：接口对齐完成，真实 SDK 桥未接 | 🟢 **已有生产级验证**（长列表/滚动/内存/字体等） |

**⇒ "Native 生产就绪"要分两句讲**：
1. **SPI 层尚未生产就绪** —— 卡 I6/C1 说的就是这个（`NativeBackend` 的**真实 SDK 桥**未接）；
   mock 适配器证明的是"接口形状对"，不是"能驱动真机"。
2. **App 端渲染链路已真机验证** —— 但走的是 **selfdraw 适配器**（另一条路径），
   两者**尚未在代码上统一**（这是 C1 的实质工作：把 selfdraw 的能力收敛到 SPI 层，或明确二者分工）。

★**这是 I6 给 C1 的关键输入**：C1 不是"从零实现 Android 后端"，
而是**把已有的真机链路接到 SPI 接口上**（或论证 selfdraw 即为 NativeBackend 的生产实现）。

---

## 4. Hybrid（混合渲染）—— 单体后端之外的形态

Hybrid 不是独立渲染器，而是**在既有后端之上**做"纹理共享 + 页面/区域级切后端"：

- `textureSharing: true` 是它的核心（跨后端贴图共享）；
- `runHybridConformance` 有独立判据（`tests/hybrid-renderer.test.ts:125` 断言其通过统一 SPI 面）；
- **无真机嵌入证据**（无宿主目录引用 hybrid）⇒ 🟡 **原型**。
- ★风险：纹理共享的真实成本（跨进程/跨引擎）**未经真机量化**——这是它离生产最远的一环。

---

## 5. 风险清单与补齐建议（每后端）

| 后端 | 主要风险 | 补齐建议 | 优先级 |
|---|---|---|---|
| **Native×3** | **SPI 层与真机链路分叉**（两套适配器，能力可能漂移）；harmony **无任何宿主证据** | ① 把 selfdraw 的宿主实现接为 SPI 的 adapter（C1 主体）② 建立"两条路径产出等价"的判据 ③ harmony 需真机宿主 | **P0** |
| **Flutter** | 仅映射层（`toWidgetTree`），**无宿主、无真机**；`layout: yoga` 与原生 Native 的 `native` 语义差异未验证 | 需真实 Flutter 宿主 + 与 Native 的对拍判据 | P1 |
| **Hybrid** | 纹理共享成本未量化；无真机 | 先在单一平台量化跨后端纹理共享开销 | P2 |
| **VueDom** | 玻璃仅 L1（浏览器能力上限，非缺陷）；`ssr: false` | 无（Web 端已生产使用） | — |
| **Headless** | 无（不排版是设计，非缺失） | 无 | — |

★**共同缺口（全后端）**：`remoteRendering: false` —— 远程渲染未实现（跨端一致性路线图的后续项）。

---

## 6. 诚实边界（本评估**不**声称的）

1. **conformance 通过 ≠ 生产就绪**：它只验"接口形状 + 基本行为"（13 项），
   不含性能、内存、真机兼容性。Native×3 的 13/13 是在 **mock 适配器**上取得的。
2. **本评估不含性能数据**：各后端的性能对比需真机矩阵（iOS/Android 已有部分：
   长列表复用率 0.997 / 帧率 124.5 / 内存比 0.328，但那属 **selfdraw 链路**，不是 SPI 层）。
3. **"生产就绪"的判据是本报告定义的**（接口 + 宿主 + 真机证据三者齐备），
   不是行业标准；不同团队可能有别的门槛。
4. **harmony 完全无证据**（无宿主、无报告）⇒ 其能力位是**声明值**，未经任何实机验证。

---

## 7. 复算方式（可复现）

```bash
# 接口完整性（六后端 conformance）—— 需 happy-dom（文件头 @vitest-environment）
npx vitest run tests/render-backend.test.ts
# 能力位（真实读取）
npx tsx -e "…"   # 见本报告 §1 的采集方式（探针已并入 tests/render-backend.test.ts 的断言面）
```
