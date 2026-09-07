# Proteus 内存管理方案 · 总览

> 目标：**从架构上规避 uni-app / uni-app x 频繁内存溢出（OOM）的结构型泄漏链**。
> 核心原则——**用运行时强制约束取代开发者自律**：每一次跨层分配都有 owner、每一次页面退出都可验证回收、每一次峰值都有明确预算。

---

## 1. 为什么需要专门的内存方案

uni-app 体系的 OOM **并非由单一 API 导致**，而是多条结构性泄漏链叠加的结果：

- 长列表 `v-for` 全量创建 VNode，节点数 = 数据量 × 每项错误节点数
- 每页面独立 WebView 引擎 + DOM/CSS/框架运行时重复
- 图片 LRU 只管淘汰顺序，**不管解码后像素总量**
- 逻辑层/视图层双线程，**两端各持一份对象图**
- JSI/FFI 直调让"JS 对象—Native 对象—回调闭包"压进**同一条强引用图**
- HMR / UTS 热替换后旧模块、旧闭包、旧原生 View 仍被可达引用持有

**关键判断**：仅靠"提示开发者及时 destroy"无法解决系统性风险。框架必须在**组件模型、资源所有权、跨运行时引用、调度层**设置统一约束。

> ⚠️ **不做的事**：不虚构跨设备统一的"MB 红线"。现有公开资料不足以推导普适阈值（官方口径也多是"对象数配额"而非字节数），故所有预算均通过**运行时特征检测**确定，CI 验收以**相对增长 + 残留对象**为主。

---

## 2. 设计目标

| 目标 | 含义 |
|------|------|
| **可追溯** | 每次分配都能定位 owner、创建栈、引用边 |
| **可释放** | 每个 owner 有对称的销毁事务 |
| **可验证** | 页面退出后的残留可被运行时断言 / CI 阻断 |
| **有预算** | 峰值受帧预算 + 页面预算 + 全局预算约束 |

**不是"零分配"**——而是让峰值可控、页面退出后残留可归因。

---

## 3. 四层治理体系

```
┌──────────────────────────────────────────────┐
│ ④ 诊断层  ProteusMemoryPanel / proteus memory │
├──────────────────────────────────────────────┤
│ ③ 跨运行时层  JSI/FFI IDL 所有权 + weak bridge │
├──────────────────────────────────────────────┤
│ ② 资源层  Owner + Budget + Disposer            │
├──────────────────────────────────────────────┤
│ ① 组件层  可回收视图 / 分页 / keyed state      │
└──────────────────────────────────────────────┘
         ↑ 页面销毁事务贯穿四层
```

详见：`01-research-basis.md`（调研依据）、`02-four-layer-governance.md`（治理体系）、`03-page-teardown.md`（销毁事务）。

---

## 4. 与现有 plan 的对齐

| 层 | 对接点 |
|----|--------|
| **Architecture** | 新增第 10 条铁律：*所有跨运行时资源必须登记 owner 并实现 disposer* |
| **Component** | 长列表默认 `recycle-view`，禁止全量 VNode 假设 |
| **Platform** | `assertPlatform` + 页面/会话 owner 模型 |
| **App Renderer** | JSI/FFI 引用策略（单向 ownership + weak bridge） |
| **Glass** | GPU/Shader 资源池归页面预算管辖 |
| **Performance** | 内存预算并入性能预算，真机矩阵扩展 Java/Native/JS/GPU 四堆 |
| **Testing** | 重复导航压测 + heap snapshot diff 进 CI |
| **DevTools** | TraceBus 暴露 `memory` 域，Panel 可视化 |
| **Compiler** | 构建期检测：全量列表无 key、未注销全局监听、JSI 对象跨 owner |

执行位：**G-24**（四层治理，与 Component G-06 协同，先于 Testing），JSI 相关部分随 **G-22（App Renderer）** 落地。

---

## 5. 铁律（写入 Architecture）

1. **Owner 铁律**：所有跨运行时资源（ImageBitmap / Canvas / Shader / Socket / Native Peer / Subscription）创建时必须登记 owner
2. **对称销毁铁律**：`onMounted` 注册 → `onUnmounted` 自动 disposer；页面关闭 = 销毁事务
3. **单向引用铁律**：JS → Native 默认短生命周期句柄；Native → JS 默认弱引用 / owner epoch
4. **回收不变量**：超过阈值（默认 50 项）的线性列表**必须**走可回收视图，禁止全量 `v-for`
5. **峰值预算**：图片解码、离屏缓冲、Shader 受帧/页面/全局三级预算约束
6. **可验证**：重复打开页面 20 次，第 20 次与第 2 次稳定驻留差值 ≈ 0（CI 门禁）

---

## 6. 文档清单

| 文件 | 内容 |
|------|------|
| `00-overview.md` | 本文件 |
| `01-research-basis.md` | uni-app / uni-app x 九类 OOM 根因调研 |
| `02-four-layer-governance.md` | 四层治理体系完整设计 |
| `03-page-teardown.md` | PageTeardownTransaction 销毁序列 |
| `04-resource-owner-model.md` | Resource / Owner / Disposer / Budget |
| `05-recyclable-views.md` | 长列表回收（定高/动态高/瀑布流/富交互） |
| `06-image-memory.md` | 图片三级缓存 + 字节预算 + trim |
| `07-jsi-ffi-references.md` | JSI/FFI 引用策略 + IDL 所有权标注 |
| `08-leak-registry.md` | 泄漏注册表 + WeakRef + epoch |
| `09-diagnostics-ci.md` | MemoryPanel + `proteus memory` + CI 门禁 |
| `10-benchmark-budgets.md` | 真机矩阵 + 分级预算 + 验收门槛 |
| `11-batches.md` | 分批策略 + Prompt 模板 |

---

## 7. 诚实边界

- ✅ **做**：四层治理体系、销毁事务、Owner 模型、JSI 引用策略、诊断 CI、重复导航压测
- ⏸ **搁置**：具体 MB 绝对值（运行时特征检测决定）、鸿蒙/小程序特有细节的深度验证（由 Blueprint 验证阶段补全）
- ❌ **不做**：宣称"永不 OOM"——只承诺**可验证的回收 + 可追溯的峰值**

---

## 参考

调研依据见 `01-research-basis.md`，关键一手来源：DCloud uni-app/uni-app x 官方文档、Android WebView 内存管理、微信 Skyline、HarmonyOS ArkUI Image、NativeScript Android/iOS 内存管理文档。
