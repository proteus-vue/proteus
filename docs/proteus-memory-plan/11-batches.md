# 分批策略与 Prompt 模板

> 执行位：**G-24**（四层治理，与 Component G-06 协同、先于 Testing）；JSI 相关部分随 **G-22（App Renderer）** 落地。

---

## 总览

| 批次 | 内容 | 前置 | 验收 |
|------|------|------|------|
| **M1** | Owner/Resource/Disposer 核心模型 + LeakRegistry | G-06 Component 稳定 | 资源创建/销毁可追踪，单元测试 |
| **M2** | 长列表回收（RecycleView 定高 + Dynamic + Waterflow + KeyedState） | M1 | 20000 项不 OOM，活跃 cell 恒定 |
| **M3** | 页面销毁事务 PageTeardownTransaction + Owner Epoch | M1 | 重复导航 20 次无单调增长 |
| **M4** | 图片三级缓存 + 降采样 + trim | M1 | 大图列表峰值受预算约束 |
| **M5** | JSI/FFI 引用策略 + IDL 所有权标注 + peer 自动释放 | G-22 App Renderer M2 | native global ref 计数归零 |
| **M6** | 动画/GPU 三作用域 + Shader 池 | Glass 稳定 | 60s 动画无持续峰值 |
| **M7** | `proteus memory` CLI + MemoryPanel + CI 门禁 | M1-M6 | 基准场景全绿 |
| **M8** | 真机四堆矩阵 + 设备分级校准 + Blueprint 验证 | M7 | 五端验收门槛通过 |

---

## M1：核心模型（最高 ROI，纯逻辑零依赖）

**可独立运行、可单测**——完成即证明整套模型成立。

### 交付
- `Resource` / `Owner` / `Disposer` 接口
- `LeakRegistry`（注册 / 反向索引 / epoch 撤销）
- `useResource` / `onCleanup` composable
- `EffectRegistry`（subscription / timer / animation / io / native-listener）
- 调试模式：创建栈、强引用保留、retainer 图构建

### Prompt 模板（B1）

```
你是 Proteus 内存管理核心实现者。实现 Owner/Resource/Disposer 模型：

【输入】
- 需对齐 Component plan 的组件生命周期钩子
- 需对齐 Platform plan 的 assertPlatform

【约束】
- 所有跨运行时资源必须登记 owner
- 默认用 WeakRef，调试模式保留强引用
- 支持 owner epoch 撤销（HMR 场景）
- 零第三方依赖（纯 TS）

【交付】
- src/memory/{owner,resource,registry,effects}.ts
- tests/ 覆盖：注册/级联销毁/epoch 撤销/retainer 图
- 对齐 --trace-transform：资源创建/销毁输出 IR 事件

【验收】
- 创建 1000 资源后 dispose owner → GC 后 registry 为空
- epoch 递增后旧 effect 自动 dispose
- 生成 retainer 链报告
```

---

## M2：长列表回收

### Prompt 模板

```
实现 <pg-recycle-view> 四种策略：RecycleView(定高) / DynamicRecycleView
/ WaterflowView / KeyedStateCell。

【约束】
- 超过 threshold（默认 50）强制回收
- list-data 与 list-view 分离（窗口数据 vs 领域模型）
- key 绑定状态，复用不丢输入
- 对齐 Component plan 的 p-* 映射

【验收】
- 20000 项：活跃 cell 恒定（≈ 视口+缓冲）
- VNode 池大小不随数据量线性增长
- 滚动回退不重测高度（测量缓存）
```

---

## M3：页面销毁事务

```
实现 PageTeardownTransaction：cancelPendingIO → unsubscribeAll
→ stopTimers → clearBridgeHandlers → detachViewTree → nativeDestroy
→ releaseJSRefs → afterDestroy 断言。

【约束】
- 序列由框架生成，开发者只注册副作用
- WebView 走完整 Android 销毁序列
- Skyline 只销毁页面局部状态，不销毁共享引擎
- Owner Epoch 陈旧回调静默丢弃

【对齐】Compiler：构建期检测 LISTENER-NO-CLEANUP / GLOBAL-HOLD-VIEW
```

---

## M4：图片内存

```
实现 ImageCache（L0 原始字节 / L1 解码 Bitmap / L2 磁盘）：
- L1 双限额（对象数 + 字节）
- 降采样（按 display 尺寸算 inSampleSize）
- 并发解码信号量（页面级 + 全局级，默认 4）
- trim：页面隐藏 / 销毁 / onTrimMemory / 后台
- 引用追踪：request→decode→cacheKey→displayView→pageOwner

【验收】快速滚动 1000 图不超全局字节预算
```

---

## M5：JSI/FFI 引用策略（关键风险，靠后做）

```
实现 JSI binding 的 ownership 护栏：
- IDL 标注 [value]/[borrow]/[owned]/[callback]
- 代码生成器自动插入 peer map + release 桩
- JS→Native：短生命周期句柄，调用完释放 global ref
- Native→JS：WeakRef + owner epoch
- 禁止 [owned] 直接映射 Activity/ViewController/View/Canvas

【对齐】App Renderer plan 02-native-binding.md + 附录 A
【验收】详见 07-jsi-ffi-references.md
```

---

## M6：动画/GPU 三作用域

```
实现帧/动画/页面三级资源池：
- 帧作用域：Path/Gradient/CommandBuffer → 每帧末释放
- 动画作用域：Reusable Cache/Shared Texture → owner 卸载释放
- 页面作用域：Shader Program/图集 → 页面销毁释放
- GPU 资源池记录 PSS/Graphics Memory
- TrimMemory / 后台 / 内存压力 → 自动 trim

【对齐】Glass plan（Shader/离屏模糊缓冲纳入页面预算）
```

---

## M7：诊断 + CI

```
实现 `proteus memory` CLI + ProteusMemoryPanel：
- 标准场景：repeat-nav(20) / long-list / image-pressure / animation / HMR
- 采集四堆：Java/Native/JS/GPU + 活跃计数
- 输出：内存曲线 + 峰值报告 + retainer 链
- CI job：单调增长 / 残留对象 / 预算超限 → 阻断 PR
- TraceBus `memory` 域事件

【对齐】DevTools plan + consistency.yml
```

---

## M8：真机矩阵 + 校准

```
在 iOS / Android / 鸿蒙 / Web / Skyline 真机跑基准：
- 设备分级（low/mid/high）→ 预算缩放系数
- 校准四堆采集方法
- Blueprint 150 页验证（对齐 Blueprint plan）
- 输出各端预算系数表（PR 合入）
```

---

## 建议执行顺序

**M1 → M3 → M2 → M4 → M7**（先让"回收 + 销毁 + 诊断"闭环可验证），**再 M5 → M6**（JSI/GPU 是增量叠加，依赖 App Renderer + Glass 稳定），**最后 M8 校准**。

> M1 是纯逻辑零依赖，可**与 G-01 地基三联同期启动**——这是最快能跑通、也最能证明整套内存方案成立的切入点。
