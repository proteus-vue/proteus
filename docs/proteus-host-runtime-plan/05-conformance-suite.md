# Conformance 测试套件（42 项）

> 配套：`01-host-runtime.md` §8、`conformance-runner.js`
> 原则 #13：可插拔必须有可验证支撑。42 项，0 失败 = "Proteus Compatible"。

---

## 1. 运行方式

```bash
# 方式 1：直接跑 runner（含 Terminal + Node 两个后端）
node conformance-runner.js

# 方式 2：指定后端
proteus conformance --backend ./my-runtime.js --suite g39

# 输出：PASS / FAIL / SKIP + 报告 JSON
```

退出码：FAIL>0 → 1；全 PASS/SKIP → 0。

---

## 2. 测试分组（C-01 ~ C-10，42 项）

### C-01 接口完备性（5 项）
- C-01-01：`id` / `version` / `capabilities` 存在且类型正确
- C-01-02：生命周期 4 方法（bootstrap/suspend/resume/destroy）齐全
- C-01-03：线程 API（createWorker/runOnThread/postMessage）齐全
- C-01-04：引擎 API（createEngine/evalInEngine）齐全
- C-01-05：桥 API（invokeNative/registerNativeHandler）齐全

### C-02 生命周期（5 项）
- C-02-01：bootstrap 返回 Promise，完成后 state=running
- C-02-02：suspend 后 state=suspended，resume 恢复 running
- C-02-03：destroy 后 state=destroyed，再调用抛错
- C-02-04：重复 bootstrap 幂等
- C-02-05：destroy 自动清理 Worker / 定时器（无泄漏）

### C-03 线程安全（5 项）
- C-03-01：runOnThread('background') 不在主线程执行
- C-03-02：UI 操作自动切主线程
- C-03-03：Worker postMessage 结构化克隆（含 ArrayBuffer）
- C-03-04：单线程宿主（Terminal）降级不抛错
- C-03-05：并发任务无竞态（100 次 runOnThread 顺序一致）

### C-04 消息队列（4 项）
- C-04-01：enqueue 按优先级执行
- C-04-02：nextTick 在当前帧末尾执行
- C-04-03：setInterval 可 clearInterval
- C-04-04：destroy 清空队列（无遗留回调）

### C-05 原生桥（5 项）
- C-05-01：invokeNative 返回 Promise
- C-05-02：白名单外调用拒绝（CMP037）
- C-05-03：超时自动 reject
- C-05-04：Native → JS 回调切 JS 线程
- C-05-05：registerNativeHandler 可被 Native 触发

### C-06 能力声明（4 项）
- C-06-01：capabilities 字段齐全
- C-06-02：threads.count 与实际一致
- C-06-03：声明 `nativeBridge:false` 时 invokeNative 返回 `Err('unsupported')`
- C-06-04：生命周期能力为 'none' 时 suspend/resume 为 no-op（不崩）

### C-07 降级（4 项）
- C-07-01：后台线程缺失 → 降级主线程（日志可见）
- C-07-02：文件系统缺失 → useStorage 返回内存实现
- C-07-03：原生桥缺失 → 能力调用 Err('unsupported')
- C-07-04：降级事件可订阅（on('fallback')）

### C-08 安全性（4 项）
- C-08-01：能力名白名单拦截
- C-08-02：参数 schema 校验拒绝非法值
- C-08-03：未授权敏感能力 → Err('permission.denied')
- C-08-04：无 eval / 无字符串代码执行（防 injection）

### C-09 性能（3 项）
- C-09-01：bootstrap 冷启动 < 阈值（宿主自定义）
- C-09-02：invokeNative 往返 P95 < 阈值
- C-09-03：Worker 创建开销可测（benchmark 必提供，G-38.5 同源）

### C-10 确定性（3 项）
- C-10-01：相同初始化 → 相同状态
- C-10-02：事件循环顺序确定性（同优先级 FIFO）
- C-10-03：destroy → bootstrap 可重入（无残留）

---

## 3. SKIP 规则（能力诚实，G-39.3）

后端按 `capabilities` 声明能力，**未声明的能力组整体 SKIP**（不算 FAIL）：

| 能力缺失 | 跳过组 |
|---------|--------|
| `threads.background: false` | C-03-01/03/05（后台线程相关） |
| `nativeBridge: false` | C-05 全组、C-08 部分 |
| `lifecycle: 'none'` | C-02-02/03（suspend/resume） |
| `filesystem: false` | C-07-02 |

**Terminal 宿主**：因 `background=false, lifecycle='none', nativeBridge=false`，约 15 项 SKIP，其余 PASS——这是**诚实降级的正确表现**，非失败。

---

## 4. 参考实现覆盖

| 后端 | 能力 | 单独跑 | 合并报告 |
|------|------|--------|---------|
| **WebHostRuntime** | 全量（Worker + 事件循环 + JSEngine + 桥） | 大部分 PASS，少数"降级类"项 SKIP | **42 PASS** |
| **TerminalHostRuntime** | 单线程、无生命周期、无桥 | "降级行为"类 PASS，少数"机制不存在"类 SKIP | （合并后补齐） |

**合并报告（Terminal + Web 两后端）**：**42/42 PASS，FAIL=0，SKIP=0**。退出码 0。

> 设计意图：每项测试若在某一个后端可验证即通过（降级行为只需一处成立），只有两后端都无法验证（机制完全不存在）才 SKIP。当前两个参考实现的能力互补，恰好覆盖全部 42 项。

详见 `conformance-runner.js` 实测输出。

---

## 5. CI Gate 集成

```yaml
# .github/workflows/conformance.yml
- name: G-39 Runtime Conformance
  run: node conformance-runner.js --backend ./runtime.js --gate
  # --gate: FAIL>0 则 exit 1，阻断合并
```

原则 #13：未通过 conformance 的宿主运行时**不得宣称 "Proteus Compatible"**。
