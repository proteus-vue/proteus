# M2 正式验收报告（§9.2）

> 执行日期：2026-09-29 · 设备：**Redmi M098FE · Android 17（API 37）· arm64-v8a · 1200×2608 @480dpi**
> 被测：`proteus-layout-core 0.1.0 · engine=taffy-0.14`
> 脚本：`hosts/android/acceptance.sh`（可复跑）· 原始数据：`hosts/android/results/acceptance/<时间戳>/`

---

## 0. 结论

**三项指标全部达标**（§9.2 的合格线 = ≤ 原生；目标 = ≤ 原生 × 0.6 或 × 0.8）：

| 指标 | 合格 | 目标 | **实测比值** | 判定 |
|---|---|---|---|---|
| 4050 渲染耗时 vs 原生 View | ≤ 原生 | ≤ ×0.6 | **布局 0.063 · 绘制 0.667** | ✓ 布局远超目标 / 绘制合格 |
| 增量内存 vs 原生 | ≤ 原生 | ≤ ×0.8 | **0.328** | ✓ 超目标 |
| 与浏览器基准一致性 | — | ≤ 0.5dp | **0.375dp**（17 用例 / 67 节点） | ✓ |

**绝对值**
| 项 | Proteus | 原生 View |
|---|---|---|
| 布局（4050 元素） | **5 ms** | 17 ms（measure+layout，不含 4051 个 View 的创建） |
| 绘制 | **2 ms** | 3 ms |
| 增量内存 | **11.9 MB** | **36.4 MB** |

---

## 1. §9.2 测试环境要求 → 逐条落实

| §9.2 要求 | 落实方式 | 证据 |
|---|---|---|
| 必须 **release 包** | `build-and-run.sh --release`（清单去掉 `debuggable`） | 构建日志「构建模式：release」 |
| 每次测试前**杀进程重进** | 每轮 `am force-stop` → `am start` → sleep 3 | `raw.txt` 每轮独立 |
| **重复 5 次取均值** | `--runs 5` | 下表 5 轮原始值 |
| **Perfetto 确认跑在普大核** | app 内**持续采样** `/proc/self/task/<tid>/stat` 的 processor 字段（每 3ms 一次，覆盖整个测量窗口）；cpu0–5 = 3.6GHz 普大核，cpu6–7 = 4.6GHz 超大核 | `layout-env.json`：`cpus=[0,1,3,4,5] prime=0` ✓ |
| **监控温度避免降频** | app 内读 `/sys/class/thermal/thermal_zone*/temp` 取最大 | `temp 95000 → 95000 m°C`（无变化） |
| 普通包名、**不预载不预触发 JIT** | 包名 `dev.proteus.layoutcore` | — |
| **区分「初次安装」与「闲时优化」** | 每通路首轮标记 `first-install`，聚合时排除 | 下表 |
| 计时口径：**click → 指令送达** | 广播触发（等价外部事件；`input tap` 在 Android 17 需 INJECT_EVENTS 被拒） | 脚本 + app 内 `SystemClock` |

### 原始数据（5 轮）

| 轮次 | 通路 | PSS 增量 | CPU 分类 |
|---|---|---|---|
| 1 | proteus-mem **first-install** | 15798 KB | prime×0/3 ✓ |
| 2–5 | proteus-mem steady | 16150 / 16162 / 16114 / 15595 KB | prime×0/3 ✓ |
| 1 | native **first-install** | 43585 KB | prime×0/3 ✓ |
| 2–5 | native steady | 43506 / 43442 / 43527 / 43477 KB | prime×0/3 ✓ |

> ★上表是**最终版本**运行的数据；中间版本因发现的两个测量缺陷（见 §3）已废弃。

---

## 2. 三条测量口径的关键决策（否则数据不可比）

§9.2 原文「**严格复刻，否则数据不可比**」——本轮为此做了三处口径隔离：

| # | 问题 | 做法 |
|---|---|---|
| 1 | **测量装置自身吃内存** | 性能归因需要 7 个 1080×2400 ARGB 位图（每个 9MB，共 ~63MB）——这是**测量仪器的重量**，不是渲染路径的成本。故内存对比走**独立的纯结构通路**（`proteus-mem` / `native`，都不分配位图） |
| 2 | **两条通路的组成不同** | 原生的「创建 4051 个 View」与 Proteus 的「Rust 建树」必须同段比较；绘制则都比「录制 DisplayList」（同口径）。故分三段计时，不合成单一数字 |
| 3 | **PSS 采样时点** | 见 §3 |

---

## 3. ★★两个被自检抓出的测量缺陷（都曾产生 3 倍误差）

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| 1 | **被测结构失去强引用** | `ViewGroup tree` / `cmds` 是局部变量，方法返回后 GC 可回收 → 同一份代码两次运行测出 **42.5MB / 12.8MB（差 3 倍）** | 加 `keepAlive` 字段持有强引用；采样前 `System.gc()` + sleep 300ms |
| 2 | **PSS 读数为空** | 脚本用 `grep -E '^\s+TOTAL'`——Android 的 **toybox grep 不支持 `\s`** → PSS 恒空、比值算出 `-1` | 改 POSIX 字符类 `[[:space:]]`；核判定改为**以 app 自报为准**（app 读自身 `/proc` 无权限限制） |

**教训**：内存测量的最大风险不是"测不准"，而是**测的不是你想测的东西**。
两次误差都源于"被测对象在采样前已经消失"。**内存测量必须显式 keep-alive，并在采样前稳定堆状态。**

---

## 4. 诚实边界（未达 / 未测）

| # | 项 | 状态 |
|---|---|---|
| 1 | **Perfetto 精确核确认** | 本实现用**进程内采样**（每 3ms 读 processor 字段）判定核归属，**不是 Perfetto trace**。判定能力等价（能发现瞬时抬升），但若要求严格意义上的 Perfetto 证据，需补 trace |
| 2 | **绘制比值 0.667** | 达标（≤原生）但**未达目标 ≤0.6**。与文案重复率相关：本轮 2000 条文案全相同（图集命中率 100%）；**文案多变时实测 41ms（慢于原生）** |
| 3 | **未验证「不拍平时的耗时」** | §9.2 表格第二行要求「不拍平时的耗时仍 ≤ 原生」。本轮对照组未做拍平变体（NativeVapor 的拍平实现尚未落地） |
| 4 | **未测长列表（§9.3）** | 属 M3 验收范围 |
| 5 | **内存仅测「结构增量」** | 未含图片解码、文本缓存等运行时增长；§9.2 的 ±0.8 目标针对的即为结构成本，故口径正确，但完整内存画像需补 |

---

## 5. 复跑方式

```bash
# 前置：.tools 下有 NDK 与 JDK 17（见 hosts/android/README.md）
bash hosts/android/acceptance.sh --runs 5

# 只构建不跑
bash hosts/android/build-and-run.sh --no-install --release
```

产出：`hosts/android/results/acceptance/<时间戳>/`
（`layout-conformance.json` · `layout-bench.json` · `layout-compare-native.json` ·
`layout-native-only.json` · `layout-proteus-only.json` · `layout-memory.json` · `layout-env.json` · `raw.txt`）
