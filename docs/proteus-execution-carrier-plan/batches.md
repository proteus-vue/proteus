# G-40-E：分批落地计划

---

## 1. 分批总览

| 批次 | 目标 | 交付物 | 依赖 | 周期 |
|------|------|--------|------|------|
| **B1** | SPI 定义 + 参考实现 | 接口 TS + 2 载体 | G-39 | 2 周 |
| **B2** | Conformance 套件 | 42 测试 + CLI | B1 | 2 周 |
| **B3** | 静态检查（G-40.1） | Compiler 插件 | G-38, B1 | 2 周 |
| **B4** | 零拷贝 + 批处理落地 | Bridge 改造 + Backend 改造 | B1, G-27 | 3 周 |
| **B5** | 实时逃逸 + AOT 路径 | 实时协议 + emit AOT | B1, G-28, G-38 | 4 周 |
| **B6** | 可观测 + 基准测试 | Metrics + benchmark | B4, B5 | 2 周 |

**总计约 15 周**（可与 G-37/38/39 并行部分）。

---

## 2. B1：SPI 定义 + 参考实现

### 交付

- `ProteusExecutionCarrier` 完整 TS 接口定义
- `CarrierCapabilities` 结构定义
- **2 个参考实现**（原则 #11 要求 ≥2）：
  - `JSICarrier`（模拟 JS 引擎路径，含跨界成本画像）
  - `AOTCarrier`（模拟原生路径，含真并发 + 实时）
- 本包 `carrier-reference.js` 已提供可运行原型

### 验收

- 两个载体能装载同一模块并产出相同结果
- capabilities 结构完整、字段类型正确
- 参考实现演示脚本运行成功

### 依赖

G-39 的 `createEngine` 接口（需修正返回类型，见下）

---

## 3. B2：Conformance 套件

### 交付

- 42 项测试（C-01 ~ C-10），见 `conformance-suite.md`
- CLI：`proteus conformance --carrier <path>`
- JSON 报告输出
- CI Gate 集成

### 验收

- 两个参考实现跑通（JSI: 38 PASS + 4 SKIP；AOT: 42 PASS）
- 退出码正确（0 = 通过，1 = 有 FAIL）
- SKIP 规则正确（不支持的能力跳过，不算 FAIL）

### 关键

**SKIP 不等于豁免**——需记录"该载体不具备某能力"，
业务使用到该能力时编译期报错。

---

## 4. B3：静态检查（G-40.1）

### 交付

- Compiler 插件：扫描业务代码中的 JS 运行时假设
- 禁止清单（6 项）的检测规则
- CI lint 集成

### 检测项

```javascript
// 全部应编译错误
window.foo
globalThis.bar
eval(code)
new Function(code)
setTimeout(fn, 10)        // 依赖精确时序
new Proxy(target, handler) // 运行时拦截
jsi::Value 相关操作
```

### 依赖

G-38 的 transform 阶段插件机制

---

## 5. B4：零拷贝 + 批处理落地

### 交付

**零拷贝**：
- `SharedBuffer` 实现（各端）
- `invokeBinary` 桥接接口
- CMP047/048/049 的运行时保障

**批处理**：
- `commitBatch` 接口加入 G-27 `ProteusRenderBackend`
- 框架 Diff 层改造：一帧聚合为 `RenderOp[]`
- 已有 Backend 的批处理适配

### 各端零拷贝实现

| 端 | 实现要点 |
|----|---------|
| iOS | `JSObjectGetArrayBufferBytesPtr` 取指针 |
| Android | Hermes ArrayBuffer 直传 |
| Harmony | native buffer 桥接 |
| Web | ArrayBuffer / SharedArrayBuffer（需 cross-origin isolation） |
| Flutter | `dart:ffi` 直接传指针 |
| AOT | 原生指针共享 |

### 验收

- `avgBatchSize` > 10（批处理确实生效）
- `zeroCopyHitRate` > 0.9
- 批处理内部无逐次跨界（C-06-02）

---

## 6. B5：实时逃逸 + AOT 路径

### 交付

**实时逃逸**：
- `RealtimeCapability` 接口
- 静态检查：`setInterval`/`rAF` 驱动实时能力 → 编译错误
- 各端实时线程接入（iOS/Android/Harmony/Web AudioWorklet）
- 事件节流策略

**AOT 路径**：
- G-38 `emit` 阶段产出 `aot-native`
- 静态子集定义（哪些 JS 特性可 AOT）
- 与 JSI 路径的语义等价验证（C-09）

### 验收

- 实时能力在 JSI 载体上被正确拒绝（C-08-02）
- 实时事件节流生效（原生 90Hz → JS 30Hz）
- AOT 产物与 JSI 产物行为一致（C-09 全过）
- `rtJsDrivenViolations` 恒为 0

---

## 7. B6：可观测 + 基准测试 ★

### 交付

- `CarrierMetrics` 全量采集
- 基准测试套件（真实测量跨界成本）
- 官网 benchmark 数据源

### ★ 关键：把推算换成实测

`zero-copy-batch.md` 中的收益表是**推算**，B6 必须用真实数据替换：

| 项 | 推算值 | 待实测 |
|----|--------|--------|
| 单帧 100 属性跨界成本 | 18.1 μs | **待实测** |
| 批处理后 | 1–2 μs | **待实测** |
| 批处理收益 | 10–18× | **待实测** |
| 零拷贝 vs 拷贝（10MB） | 20MB 搬运 → 0 | **待实测** |

### CMP046 的执行

> 未实测（`measured: false`）的数据禁止对外宣称。

**B6 完成后，所有对外性能数字必须来自本基准测试。**

---

## 8. 与路线图的落点

| 批次 | 里程碑 | 说明 |
|------|--------|------|
| B1, B2 | **M1** | 与 G-37/38/39 B1 同批（都是"定义 SPI shape"） |
| B3, B4 | **M2** | 依赖 IR schema 稳定 |
| B5, B6 | **M2–M3** | AOT 路径 + 实测数据 |

---

## 9. 跨 Plan 协同矩阵

| Plan | 协同点 | 批次 |
|------|--------|------|
| **G-39** | `createEngine` 返回类型修正为 Carrier | B1 |
| **G-27** | `commitBatch` 加入 RenderBackend | B4 |
| **G-38** | `emit` 产出 `aot-native`；静态检查插件 | B3, B5 |
| **G-28** | 实时能力分类与注册 | B5 |
| **G-31/32** | 128 原语不泄露载体细节 | B3 |
| **G-30** | Tier 模型声明载体能力 | B1 |
| **G-36** | AI Agent 生成代码过 G-40.1 检查 | B3 |
| **G-23** | AOT 路径保留调试符号 | B5 |

---

## 10. Definition of Done

G-40 完成的判定标准：

- [ ] `ProteusExecutionCarrier` 接口定义完成
- [ ] ≥2 个参考实现（JSI + AOT）可运行
- [ ] 42 项 conformance 套件可执行，参考实现全过
- [ ] G-40.1 静态检查在 Compiler 中生效
- [ ] `commitBatch` 在 G-27 Backend 中实现
- [ ] 零拷贝通道在 ≥3 个端实现
- [ ] 实时能力逃逸在 ≥2 个端验证（iOS + Web AudioWorklet）
- [ ] AOT 路径产出可运行产物
- [ ] `CarrierMetrics` 全量采集
- [ ] **基准测试产出的真实数据替换所有推算值**
- [ ] 铁律 G-40.1–6 + CMP044–050 进入规约铁律总表

---

*G-40-E · 分批落地计划*
