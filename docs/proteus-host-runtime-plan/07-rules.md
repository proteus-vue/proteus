# G-39 严格规则（铁律）

> 配套：`01-host-runtime.md` §9
> 编号已避让既有：G-38（CMP029-034）、G-37（CMP023-028），本文件用 **G-39.1-6 + CMP038-043**

---

## 1. 铁律（MUST）

### G-39.1 生命周期唯一拥有
- Backend / 业务 **不得**自己监听平台前后台事件（如 `visibilitychange`、`onPause`）
- 只能通过 `runtime.on('suspend' | 'resume', cb)` 订阅
- **违反示例**：RenderBackend 里 `document.addEventListener('visibilitychange', ...)` → FAIL

### G-39.2 线程唯一拥有
- Backend **不得**直接创建线程（`pthread_create` / `new Thread` / `dispatch_async`）
- 耗时任务统一 `runtime.runOnThread('background', task)`
- UI 操作自动切主线程，禁止 Backend 自己切

### G-39.3 能力诚实声明
- `capabilities` 必须如实反映宿主能力，**不得**虚报
- 未声明的能力组，conformance 自动 SKIP（不强制）
- 虚报 → 运行时降级不可观测 → CMP038

### G-39.4 降级可观测
- 每次降级（后台→主线程、文件系统→内存、桥→Err）**必须**触发 `fallback` 事件 + 结构化日志
- 生产环境可上报指标；开发环境可见警告
- 静默降级（业务无感知）→ CMP039

### G-39.5 原生桥安全
- 能力名 **白名单** + 参数 schema 校验（CMP037）
- 调用超时可取消
- Native → JS 回调 **必须**切回 JS 线程，禁止任意线程回调 JS

### G-39.6 禁止循环依赖
- 依赖方向：`L1 Framework → L4 Runtime`，**禁止** `L4 → L1`
- Runtime 是底层，不感知上层框架/业务

---

## 2. 补充规则（CMP）

### CMP035：宿主不得假设业务/框架实现
- Runtime 只暴露 SPI，内部不硬编码调用任何业务函数

### CMP036：禁止跳层访问
- 合法：`L0 → L1 → (L2|L3) → L4 → Native`
- 违规：`L0 → L4`（直接调 host API）、`L0 → Native`（跳过三层）
- **由 `verify.sh` 步骤 10 用正则自动扫描判定**

### CMP037：原生桥白名单 + 参数校验（安全）
- 未注册能力名 → 拒绝
- 敏感能力需运行时权限 → `Err('permission.denied')`
- 禁止 eval / 字符串代码执行（防 prompt injection，对接 G-36）

### CMP038：能力声明一致性
- `capabilities.threads.count` 必须与实际线程池大小一致
- 声明 `nativeBridge:false` 时 `invokeNative` 必须返回 `Err('unsupported')`
- 违反 → C-06 组 FAIL

### CMP039：降级必须可观测
- 每个降级路径有 `onFallback` 监听器 + 日志
- 静默降级不可接受

### CMP040：生命周期状态机确定性
- 非法转换（如 `destroyed → running`）必须抛错
- 幂等：`bootstrap()` 多次调用状态不变

### CMP041：线程安全
- 跨线程数据通过 `postMessage`（结构化克隆），禁止共享可变状态

### CMP042：资源清理
- `destroy()` 必须清理 Worker / 定时器 / 原生桥回调，无泄漏（C-02-05）

### CMP043：性能基准强制
- 宿主必须提供 benchmark（bootstrap 冷启动、invokeNative P95、Worker 开销）
- CI 门禁，对标 G-38.5

---

## 3. 与既有编号对照（避让记录）

| 来源 | 最大编号 | 本文件起始 |
|------|---------|-----------|
| G-37 | CMP028 | — |
| G-38 | CMP034 | CMP038（跳过 035-037 已用于 G-39 补充规则，避免重号） |
| **G-39** | — | **G-39.1-6 + CMP038-043** |

> 注：CMP035/036/037 在 `02-responsibility-matrix.md` 中定义（职责边界），本文件 G-39 组引用之，编号不冲突（同一规则的不同视角）。

---

## 4. 验收（对应 conformance 42 项）

| 铁律 | 对应测试组 |
|------|----------|
| G-39.1 | C-02 生命周期 |
| G-39.2 | C-03 线程安全 |
| G-39.3 | C-06 能力声明 |
| G-39.4 | C-07 降级 |
| G-39.5 | C-05 / C-08 原生桥与安全 |
| G-39.6 | 步骤 10 循环依赖扫描 |
| CMP038 | C-06-02 |
| CMP039 | C-07-04 |
| CMP040 | C-10 确定性 |
| CMP042 | C-02-05 |
| CMP043 | C-09 性能 |
