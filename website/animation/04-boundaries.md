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

> **为什么"零唤醒"用 OS 级 CPU 会计而不是 Instruments**：本机 `xctrace` 无法录制设备（DeviceSupport 版本滞后），改用 `thread_info` 两次采样差 → 可机器判定，且配了**阳性对照**（tick 路径必须有显著开销，< 5ms 即判"探针失效"不得判绿）——否定性断言必须有对照才可信。

## 诚实边界（未做 / 部分做）

| 事项 | 现状 |
|---|---|
| 共享元素（跨页面） | 同视图树形态已落地；**跨页面的稳态几何回传**需页面栈层配合（未做） |
| 滚动联动（真手势） | 驱动接口与输入源已解耦（回调里报位置即可）；**真机手指拖拽**未接线 |
| 120 FPS | 目标需 ProMotion 设备；iPhone 12 为 60Hz——**如实标注未声称** |
| 手势协商 | 嵌套滚动冲突 / 多指：按方案设计**不属本引擎**，独立立项 |
| 逃生口率 | 统计装置就绪（`escapes.format()`）；业务用量**待采数** |
| 跨端视觉一致性 | 指令流保证"画什么"一致，**不保证"画出来一样"**（圆角裁剪/阴影/文本基线各平台不同）——靠 conformance 与浏览器真值基准兜底 |

## 破坏性验证（判据自身也有牙）

判据不是"跑一遍绿的就算数"——每条关键判据都做过**注入式破坏验证**：

| 判据组 | 破坏形态 | 结果 |
|---|---|---|
| 曲线 golden | TS 侧公式三次改二次 | 3 条当场红 |
| 复用解绑 | `stopped=0` / 解绑后仍被改动 | 红 |
| 平台动画（Android） | 去掉严丝合缝判断 / 同色判断 / 裁剪感知 | 各自用例红 |
| 路由转场（双端） | 镜像对打坏 / 方向写反 / 树保留破坏 / 计时不自洽 | 6 变体全红 |
| 执行器宿主动作 | 动画未完成 / 树操作未发生 / 钩子缺失 | 5 变体全红 |

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
```

## 回到起点

- [总览](/docs/animation/00-overview)——为什么做、三个杀手锏
- [交互演示](/animation)——转场播放器 / 曲线求值器（真跑，非示意图）
