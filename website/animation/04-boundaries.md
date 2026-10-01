---
title: 证据与诚实边界
order: 5
group: 边界
---

# 证据与诚实边界

每一项读数都指向一个**可复跑的判据脚本**；每一条"还没做的"都逐条列出。**宣称不得先于实现**是本仓的铁律。

## 真机证据

| 指标 | 读数 | 判据 |
|---|---|---|
| 转场帧率 | 59.3 FPS（iPhone 12 · 60Hz 设备已达上限） | `check-anim-rt2.py` E 组 |
| 帧耗时 p95 | 0.679 ms（预算 8.33ms） | `check-anim-rt2.py` E 组 |
| 掉帧 | 0 / 179 帧（3.0s 持续测量） | `check-anim-rt2.py` E 组 |
| 主线程参与（转场） | 1.0 ms vs tick 对照 17.4ms（600ms 窗口 · OS 级 CPU 会计） | MA0-RT 实测（含阳性对照） |
| 主线程绘制（Android） | `onDrawCount` 增量 = 0（动画全程主线程零绘制） | `check-platform-anim.py` B2 |
| 布局动画（FLIP） | 215 节点同屏补间 · 帧耗时 p95 0.713ms | `check-anim-rt2.py` F/H 组 |
| 指令路径 vs JS 路径 | 10.5× – 84.5×（N=50 → 1000；宿主侧下界） | `rt0-anim-spike.md` |
| 路由转场（双端） | 镜像对精确互逆 · 宿主真动作齐备 | `check-app-stack.py` ⑦ 组 |
| 炫技场（800 片 · 12 幕 · 一轮到底） | 58.4 FPS · 每帧 p50 2.31 / p95 5.53ms · 掉帧 17/1887（0.90%）· FLIP 全量重排 841 片（内核 2ms） | `check-showcase.py`（真机 `showcase.json`） |
| 炫技场 · **长跑压力**（160 幕 · 5.6 分钟） | 57.9 FPS · 掉帧 0.95% · **内存 +0.2MB**（148 采样）· 无热节流（fair→fair）· 62.3 万条声明式指令 | `check-showcase.py`（真机 `showcase-soak.json`） |
| 长跑的热态边际（如实标注） | 零错峰全并发幕（3200 条同时刻）热化后尾部帧 8.2–9.6ms（p50 反降至 ~3.7ms）；错峰幕 ≤4ms——远低于 16.7ms 预算，长跑预算是 12ms 线 | `check-showcase.py`（`SOAK_FRAME_BUDGET_MS`） |
| 动画**不提前结束**（1× 速的机器判据） | 逐幕 `anim_end/名义跨度 ≥ 0.84`（曲线幕 ≈1.00；2× 速时约 0.5——这条判据就是抓它的） | `check-showcase.py` ②d · 判据自证 `selftest-showcase-judge.py` 15/15 |
| **真手势滚动**（双端） | iOS：pan 识别器在岗 · 唯一出口驱动 4 次 · 偏移归零 · 内核 changed=5 · 写层 5 · Android：**真实 MotionEvent** → `scrollY=100` · 视差 `ty=-40`（≈-0.4×滚动量） | `check-anim-rt2.py` I6 · `check-kernel-anim.py` M6b |
| **跨页面共享元素**（双端） | 源页矩形切换前捕获（1080×200）→ 目标页节点（不同屏）→ 内核算几何 + 写首帧 → 帧循环完成；判据侧独立复算 dx/dy/scale | `check-app-stack.py` ⑦.7 |

> **为什么"零唤醒"用 OS 级 CPU 会计而不是 Instruments**：本机 `xctrace` 无法录制设备（DeviceSupport 版本滞后），改用 `thread_info` 两次采样差 → 可机器判定，且配了**阳性对照**（tick 路径必须有显著开销，< 5ms 即判"探针失效"不得判绿）——否定性断言必须有对照才可信。

## 诚实边界（未做 / 部分做）

| 事项 | 现状 |
|---|---|
| 120 FPS | 目标需 ProMotion 设备；iPhone 12 为 60Hz——**如实标注未声称** |
| 手势协商 | 嵌套滚动冲突 / 多指：按方案设计**不属本引擎**，独立立项 |
| 逃生口率 | 装置就绪（`escapes.format()`）；**演示面已采数**：炫技场 31200 条声明式指令 / 0 条逃生口 = **0%**（判据 ⑥ 每轮机器断言）——全业务面**待采**（演示面 ≠ 业务面，如实标注） |
| 跨端视觉一致性 | 指令流保证"画什么"一致，**不保证"画出来一样"**（圆角裁剪/阴影/文本基线各平台不同）——靠 conformance 与浏览器真值基准兜底 |
| 跨页面共享元素的**视觉合成** | 编排/几何/完成链已双端真机验证（见真机证据表）；**多棵内核树叠放渲染**（飞行途中两页同屏）不在本装置范围——与 ScreenHost 既有边界同源 |

## 破坏性验证（判据自身也有牙）

判据不是"跑一遍绿的就算数"——每条关键判据都做过**注入式破坏验证**：

| 判据组 | 破坏形态 | 结果 |
|---|---|---|
| 曲线 golden | TS 侧公式三次改二次 | 3 条当场红 |
| 复用解绑 | `stopped=0` / 解绑后仍被改动 | 红 |
| 平台动画（Android） | 去掉严丝合缝判断 / 同色判断 / 裁剪感知 | 各自用例红 |
| 路由转场（双端） | 镜像对打坏 / 方向写反 / 树保留破坏 / 计时不自洽 | 6 变体全红 |
| 执行器宿主动作 | 动画未完成 / 树操作未发生 / 钩子缺失 | 5 变体全红 |
| 炫技场判据（19 用例） | 帧数造假 / 单幕爆预算 / 掉帧 5% / 内存泄漏 / 幕序缺失 / 终值未生效 / FLIP 未跑 / 热节流 / 幕尾空等 / **动画 2× 速** / 缺结束取证 / **逃生口率超标 / 缺取证** / 长跑预算线双向 | 15 红 + 2 绿（预算线内）全对 |

## 复跑入口

```bash
# App 端动画（iOS 真机）
bash hosts/ios/run-selfdraw.sh            # animProbe 相位
python3 hosts/ios/check-anim-rt2.py hosts/ios/results/anim-rt2.json

# Android 内核驱动动画（真机）
adb shell am broadcast -a dev.proteus.RUN --es path kernel-anim
python3 hosts/android/check-kernel-anim.py hosts/android/results/kernel-anim.json

# 路由转场执行器（双端）
bash hosts/android/run-app-stack.sh
python3 hosts/android/check-app-stack.py hosts/android/results/app-stack.json

# 炫技场（800 片 · 12 幕）——「一轮到底」= 官网视频/数字同源的那轮
bash hosts/ios/run-selfdraw.sh --showcase --record
bash hosts/ios/make-showcase-video.sh     # 转网页视频（含源片帧率判据）
python3 hosts/ios/check-showcase.py hosts/ios/results/showcase.json

# 炫技场 · 长跑压力测量（内存泄漏 + 热节流；另存 showcase-soak.json，不覆盖上者）
PROTEUS_SHOWCASE_SOAK_MS=300000 bash hosts/ios/run-selfdraw.sh --showcase
python3 hosts/ios/check-showcase.py hosts/ios/results/showcase-soak.json
```

## 回到起点

- [总览](/docs/animation/00-overview)——为什么做、三个杀手锏
- [交互演示](/animation)——转场播放器 / 曲线求值器（真跑，非示意图）
