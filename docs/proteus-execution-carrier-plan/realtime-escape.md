# G-40-B：实时能力逃逸协议

> **核心立场**：实时能力不该由 JS 驱动，应该由原生侧闭环。
> 这不是优化建议，是架构铁律（G-40.3）。

---

## 1. 问题：为什么 JS 驱动实时循环是架构错误

### 1.1 硬约束

`jsi::Runtime` 有严格的**线程亲和性**：

> 从其他线程访问 `jsi::Runtime` 或任何 `jsi::Value` 会导致 **undefined behavior**。

### 1.2 后果推演

```
JS 线程单线程模型
    ↓
一个耗时 50ms 的同步原生调用
    ↓
整个 JS 线程阻塞 50ms
    ↓
┌────────────────────────────┐
│ 触摸事件    ✗ 停摆          │
│ 定时器      ✗ 停摆          │
│ 回调        ✗ 停摆          │
│ 渲染提交    ✗ 停摆          │
└────────────────────────────┘
```

### 1.3 实时性要求 vs JS 线程现实

| 能力 | 实时要求 | JS 驱动可行性 |
|------|---------|--------------|
| 音频回调 | 每 5–20ms 一次，抖动 < 1ms | ✗ **不可能**（GC + 调度抖动） |
| 传感器高频流 | 100–1000 Hz | ✗ 不可能（跨界成本 + GC） |
| 游戏主循环 | 16.7ms/帧 | △ 勉强，但不可靠 |
| 视频帧处理 | 33ms/帧，大块数据 | ✗ 不可能（拷贝成本） |

**结论：以上四类在 JSI 路径下，架构上就是错的。**

---

## 2. 正确范式：原生侧闭环

### 2.1 对比

```
❌ 错误范式（JS 驱动）：
┌─────────────┐
│  JS 线程     │ 每 10ms 调一次原生
│              │──────────────────→ 原生渲染音频
│              │←──────────────────
└─────────────┘
   问题：① 阻塞 JS 线程 ② 时序无法保证 ③ GC 抖动

✅ 正确范式（原生闭环）：
┌─────────────┐
│  JS 线程     │ ① configure()  ② start()  ③ stop()
│              │───────────────────────────→ ┐
└─────────────┘                              │
                                    ┌────────┴────────┐
                                    │  原生实时线程    │
                                    │  闭环运行        │
                                    │  （音频回调）    │
                                    └────────┬────────┘
┌─────────────┐                              │
│  JS 线程     │ ④ 事件回传（节流后）          │
│              │←─────────────────────────────┘
└─────────────┘
   优势：① JS 线程零阻塞 ② 时序由原生保证 ③ 无 GC 抖动
```

### 2.2 关键：start() 之后 JS 不再参与

这是整个协议的核心。**不是"JS 少调几次"，而是"JS 完全退出循环"。**

---

## 3. 接口契约

### 3.1 实时能力接口

```typescript
interface RealtimeCapability<TConfig, TEvent> {
  readonly id: string
  /** 声明实时特性，供框架检查 */
  readonly realtime: {
    /** 回调周期（ms），音频典型 5–20ms */
    period: number
    /** 抖动容忍（ms） */
    jitterTolerance: number
    /** 数据吞吐（bytes/s） */
    throughput: number
  }

  // === 仅有的三个 JS 侧可调用动作 ===

  /** ① 配置下发（一次性，非循环） */
  configure(config: TConfig): Result<void>

  /** ② 启动（启动后循环在原生侧，JS 不再参与） */
  start(): Result<void>

  /** ③ 停止 */
  stop(): Result<void>

  // === 原生 → JS 的单向事件 ===

  /** ④ 事件订阅（必须节流，见 §4） */
  onEvent(handler: (e: TEvent) => void): Unsubscribe

  /** 当前运行状态查询 */
  getState(): 'idle' | 'running' | 'stopped' | 'error'
}
```

### 3.2 为什么只有这三个动作

| 动作 | 频率 | 是否阻塞 | 合理性 |
|------|------|---------|--------|
| `configure` | 一次性 | 是（很短） | 配置必然是一次性的 |
| `start` | 一次性 | 是（很短） | 启动是瞬时动作 |
| `stop` | 一次性 | 是（很短） | 停止是瞬时动作 |
| `onEvent` | 受控低频 | 否（异步） | 事件驱动 |

**没有任何一个是"循环调用"**——这是设计的强制约束。

---

## 4. 事件回传的节流约束

### 4.1 问题

原生侧事件可能极高频：

```
音频电平：48kHz / 1024 samples = ~47 次/秒
IMU 传感器：1000 Hz
视频帧：30 fps
```

如果每个事件都回传 JS，**等于把阻塞问题从"调用"变成"回调风暴"**。

### 4.2 节流策略

```typescript
interface ThrottlePolicy {
  /** 最大回传频率（Hz） */
  maxHz: number
  /** 聚合策略 */
  aggregate: 'latest' | 'buffer' | 'reduce'
  /** 超出策略：丢弃 or 合并 */
  overflow: 'drop' | 'coalesce'
}

// 默认策略
const defaultThrottle: ThrottlePolicy = {
  maxHz: 30,              // 不超过帧率
  aggregate: 'latest',    // 只保留最新值
  overflow: 'drop'        // 超出直接丢弃
}
```

### 4.3 大块数据不回传 JS

**视频帧、音频 PCM 这类数据不应回传 JS 线程。**

正确做法：
```
原生侧：采集 → 处理 → 渲染/编码（全在原生侧完成）
JS 侧：只接收元数据（尺寸、时长、状态码）
```

如需在 JS 侧展示（如预览），走**零拷贝通道 + GPU 纹理共享**，
而非把像素数据搬进 JS 堆。

---

## 5. G-40.3 铁律与机器检查

### 5.1 铁律原文

> **实时能力（音频、高频传感器、游戏循环、视频帧处理）
> 必须在原生线程闭环运行，禁止由 JS 侧驱动循环。**

### 5.2 检查方式

**① 静态检查（Compiler IR 层）**

扫描业务代码，命中以下模式即**编译错误**：

```javascript
// ❌ 违规：JS 侧 setInterval 驱动实时循环
setInterval(() => {
  native.renderAudio(buffer)
}, 10)

// ❌ 违规：JS 侧 requestAnimationFrame 驱动传感器
requestAnimationFrame(() => {
  const v = native.readIMU()
})

// ❌ 违规：JS 侧循环调用大块数据处理
for (const frame of frames) {
  native.processFrame(frame)   // 应该一次性下发，原生侧循环
}
```

**② Capabilities 检查（运行时）**

```typescript
// 框架在载体初始化时检查
if (carrier.capabilities.concurrency.threadAffinity) {
  // JSI 载体：threadAffinity = true
  // → 实时能力必须走原生闭环，禁止 JS 驱动
  enforcement.realtimeJsDriven = 'forbidden'
}

if (!carrier.capabilities.realtime.capable) {
  // 该载体无法承载实时能力
  // → 注册实时能力时直接报错，而非运行时崩溃
  throw new CapabilityError('realtime not supported on this carrier')
}
```

**③ 指标监控（G-40.6）**

```
rtJsDrivenViolations 应恒为 0
```

CI 中任何非零值直接判失败。

---

## 6. 各端实现映射

| 端 | 实时线程机制 | 优先级 API | 事件回传 |
|----|-------------|-----------|---------|
| **iOS** | `AVAudioSession` + 实时线程 | `pthread_set_qos_class` | `DispatchQueue.main` |
| **Android** | `AudioTrack` + 快速路径线程 | `Process.setThreadPriority(THREAD_PRIORITY_URGENT_AUDIO)` | `Handler(Looper.getMainLooper())` |
| **Harmony** | `AudioRenderer` + `TaskPool` | `taskpool.Priority.HIGH` | `emitter` |
| **Web** | `AudioWorklet` | 不可控（浏览器管理） | `postMessage` |
| **Flutter** | `dart:ffi` + Isolate | 平台相关 | `ReceivePort` |
| **TV / Watch** | 继承宿主 | 继承 | 继承 |

### Web 的特殊说明

Web 端 `AudioWorklet` **本身就是原生侧闭环的正确范式**：
- 运行在音频渲染线程
- 不受主线程 JS 阻塞影响
- 通过 `postMessage` 与主线程通信

**这与 G-40.3 的范式完全一致**——说明该协议在各端都有对应实现路径。

---

## 7. 与 G-28 能力后端的关系

G-28 定义了 50 个能力原语。其中属于**实时类**的需遵循本协议：

| 原语 | 是否实时类 | 处理 |
|------|-----------|------|
| `useAudio()` | ✓ | 走 RealtimeCapability 接口 |
| `useSensor()`（高频） | ✓ | 走 RealtimeCapability + 节流 |
| `useCamera()`（预览流） | ✓ | 原生闭环 + GPU 纹理 |
| `useLocation()` | ✗ | 常规能力（低频，可 JS 驱动） |
| `useScanQR()` | ✗ | 常规能力 |
| `usePayment()` | ✗ | 常规能力 |

**分类依据**：回调周期 < 100ms 或 吞吐 > 1MB/s → 实时类。

---

## 8. 反例与正例

### 8.1 反例：JS 驱动音频（违规）

```javascript
// ❌ 违反 G-40.3
const audio = useAudio()
setInterval(() => {
  const buf = audio.readSamples(1024)   // 跨界 + 阻塞
  process(buf)                           // JS 侧处理（GC 抖动）
  audio.writeSamples(buf)                // 跨界
}, 10)
```

问题：
- 每 10ms 两次跨界（约 362 ns，可接受）
- **但 `process()` 在 JS 线程执行，GC 会导致抖动 > 10ms**
- 一旦超时，音频出现爆音（glitch）

### 8.2 正例：原生闭环（合规）

```javascript
// ✅ 符合 G-40.3
const audio = useRealtimeAudio()

await audio.configure({
  sampleRate: 48000,
  bufferSize: 1024,
  effect: 'reverb'          // 效果链在原生侧
})

audio.onEvent(e => {
  // 节流后最多 30Hz，只处理元数据
  updateLevelMeter(e.level)
})

audio.start()   // ★ 之后 JS 完全退出循环
```

优势：
- JS 线程零阻塞
- 音频处理在原生实时线程，无 GC 抖动
- 事件节流到 30Hz，不会打爆 JS

---

## 9. 结论

> **实时能力的问题是"架构范式"问题，不是"性能优化"问题。**

试图在 JSI 路径上优化实时能力，方向本身就是错的。
正确的做法是**让实时能力逃逸出 JS 线程**，在原生侧闭环。

**这正是 G-40.3 作为铁律而非优化建议的原因。**

---

*G-40-B · 实时能力逃逸协议*
