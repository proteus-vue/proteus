# 真机基准与验收门槛

> 所有预算通过**运行时特征检测**确定，不写死 MB 常量。本文档定义设备分级、采集方法、验收标准。

---

## 1. 设备分级（运行时探测）

应用启动时探测可用内存，确定 tier → 缩放各级预算：

| Tier | 判定（可用 RAM） | 典型设备 |
|------|----------------|---------|
| **low** | < 3 GB | 低端 Android、老款鸿蒙 |
| **mid** | 3 - 6 GB | 主流中端机 |
| **high** | > 6 GB | 旗舰机 / iPad |

预算按 tier **线性缩放**（如 low=1.0x, mid=2.0x, high=3.5x），具体系数由 Blueprint 验证阶段校准。

---

## 2. 四堆采集

扩展 Performance plan 的真机矩阵为**四堆**：

| 堆 | 含义 | 采集方式 |
|----|------|---------|
| **Java Heap** | Android Dalvik/ART 对象 | Android Studio / LeakCanary |
| **Native Heap** | C++ / JSI / Bitmap 底层 | `malloc` stats / `dumpsys` |
| **JS Heap** | V8 / Hermes / JSC | heap snapshot |
| **GPU / Graphics** | 纹理 / Shader / 离屏缓冲 | 平台 GPU 工具 |

> 对齐 Performance plan 的 `07-benchmark-baseline.md`，内存指标作为其**新增维度**并入同一张基准表。

---

## 3. 标准场景

### 场景 A：重复导航（核心回归）
```
打开 PageA → 滚动列表 20000 项 → 打开 WebView → 播放动画
→ 触发 HMR → 返回
→ 重复 20 次
```

### 场景 B：长列表极限
- 1000 / 5000 / 20000 项 × 固定随机图片
- 采集：活跃 cell 数、VNode 池大小、Java/Native/JS/GPU 四堆

### 场景 C：图片压力
- 快速滚动图片列表（并发解码）
- 切换 `aspectFill` / 大图
- 采集：Bitmap 池峰值、解码并发数、GPU 纹理数

### 场景 D：动画/GPU
- 持续 60s 复杂动画（Shader / 离屏 / filter）
- 采集：帧峰值、command buffer、临时 texture

### 场景 E：HMR 稳定性
- 修改组件 → accept → 反复导航 → heap snapshot
- 断言：旧 epoch 对象可被 GC、无 use-after-free

---

## 4. 验收门槛（相对增长为主）

> **不虚构跨设备统一 MB 红线**——现有公开资料不足以支撑，官方口径多为"对象数配额"而非字节数。

**在同一设备、同一场景下**：

| # | 断言 | 标准 |
|---|------|------|
| 1 | 稳定驻留差值 | 第 20 次 - 第 2 次 ≈ 0（< tier 阈值） |
| 2 | 活跃计数归零 | cell / 页面 / WebView / Timer / Subscription / JSI peer = 0 或可解释 |
| 3 | GC 后基线回落 | 退出页面 + GC → 回到基线区间 |
| 4 | 峰值 ≤ 分级预算 | 帧峰值 / 页面峰值 / 全局峰值均不超限 |
| 5 | 无 `RetainedRootError` | `afterDestroy` 断言全部通过 |
| 6 | 无 retainer 链告警 | CI 报告无"global/singleton/closure 长生命周期持有" |

**"可解释"** = 确有跨页面共享资源（Shader 缓存、连接池）且已用引用计数管理，PR 中显式说明。

---

## 5. 判定原则（重要）

> **仅检查最终是否触发 `LowMemory` / OOM 不足以发现缓慢累积的泄漏。**

正确做法：
- 看**内存曲线**（是否单调增长）
- 看**节点数 / 活跃计数**（是否随操作线性上升）
- 抓**heap snapshot diff**（销毁前后差异）
- 构建 **retainer 图**（为什么还活着）

---

## 6. 与现有 plan 对齐

- **Architecture**：铁律 #10（owner + disposer）纳入全局验收
- **Performance**：四堆指标并入性能预算；`--trace-app` 扩展 `--trace-memory`
- **Testing**：重复导航压测 + heap snapshot diff **进 CI 门禁**
- **Compiler**：构建期检测（见 `05-recyclable-views.md` 规则表）
- **DevTools**：TraceBus `memory` 域 + `ProteusMemoryPanel`

---

## 诚实边界

- ✅ **做**：设备分级 + 四堆采集 + 标准场景 + 相对增长验收 + CI 门禁
- ⏸ **搁置**：具体 MB 绝对值（由 Blueprint 验证阶段校准系数）
- ⏸ 各小程序基础库 / 鸿蒙深层缓存的细粒度细节（验证阶段补全）
- ❌ **不做**：宣称"永不 OOM"——只承诺可验证的回收 + 可追溯的峰值
