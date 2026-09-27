# 真机实验（H3 / H4 的关键证据源）

## 为什么必须真机

| 假设 | 模拟器为何测不出 | 真机能测什么 |
|---|---|---|
| **H4** layer tree 深度 → commit 成本 | Render Server 与 App **同进程**（无 IPC），实测深度 1→100 无差异 = **无效测量** | 真机 commit 走 **IPC 到 backboardd** → 深度的影响才显现 |
| **H3** 滚动 FPS（UILabel vs CATextLayer） | 模拟器共享 Mac GPU/CPU，且无持续渲染负载 | 真机 A 系列芯片 + 真实 GPU → 滚动丢帧率 |
| **离屏渲染**（方案坑位 #5） | 需真机 GPU 计数器 | Instruments Color Offscreen-Rendered |
| **内存占用**（方案 §9.2 验收项） | 内存结构与真机不同 | Instruments Allocations |

## 跑法

```bash
# 前置（一次性）：
#   ① 数据线连 iPhone → 设备上点「信任此电脑」
#   ② Xcode → Settings → Accounts → 登录 Apple ID（免费个人团队即可，自动生成开发证书）
bash hosts/ios/experiments/device/run-device.sh          # 自动选设备；也可传 UDID
bash hosts/ios/experiments/device/run-device.sh <UDID>
```

脚本会：探测设备 → 探测签名 → 编译（`platform 2` = 真机）→ 签名 → `devicectl` 安装/启动 →
从控制台抓 JSON 落盘到 `results/device.json`。

**探不到前置时脚本会明确报错并列出步骤**（不静默失败）——本仓当前状态即如此：
`security find-identity` 为 **0 个**证书，且设备未连接。

## 与模拟器版的差异

- 加了 **`os_signpost`** 埋点（`build` / `layout` / `commit` 三段）→ 可在 Instruments
  （Points of Interest 或 Core Animation 模板）里直接看到时间轴，与 `xctrace` 采集对齐。
- `meta` 里记录 `device: Physical Device` / `model`（机型）/ `systemVersion` ——保证「同一台机器」可比。
- **测试定义与模拟器版完全一致**（4050 元素 / view 不设宽高由文字撑开 / 三段计时 / 多次重跑取中位）
  → 两端数字**可直接对比**，从而把模拟器结论升级为真机结论，或推翻它。

## 已知阻塞（本机实测）

| 阻塞 | 证据 | 解决 |
|---|---|---|
| 无代码签名身份 | `security find-identity -v -p codesigning` → **0 valid identities** | Xcode 登录 Apple ID |
| 设备未连接 | `devicectl list devices` 只有模拟器；`system_profiler` 无 USB 设备 | 数据线连接 + 信任 |

> 注：Xcode 记录过一个真机 UDID（`00008101-001938AC1A68801E`），说明此前连过——当前未插。
