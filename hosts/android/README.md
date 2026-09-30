# hosts/android —— Android 真机验证宿主（M2 阶段）

★★目标：把 **Rust 排版核心**（`packages/layout-core-rust`）送上 Android 真机，完成 M2 的出口条件。

## 为什么这套宿主是「手工打包」而不是 Gradle

与本仓 iOS 竖切（`hosts/ios`）同款哲学：**目标是「链路能否跑通 + 数字是否可信」**，
Gradle 会引入 AGP/版本矩阵/仓库配置等与验证无关的变量。
故直接用 Android SDK 自带工具链：

```
aapt2（资源+清单）→ javac（Java 宿主）→ d8（dex）→ apksigner → adb install
```

> **诚实边界**：宿主代码用 **Java** 写（不依赖 kotlinc），故 `javac` 现成可用。
> 等 M3 接真实构建链时再考虑 Kotlin/Gradle。

## 与 iOS 侧的对齐

两端**共用同一个 Rust 核心**，只是边界形态不同：

| 端 | 边界 | 位置 |
|---|---|---|
| iOS | **C ABI**（Swift `@_silgen_name` 直调） | `packages/layout-core-rust/src/ffi.rs` |
| Android | **JNI**（Java `native` 方法） | `packages/layout-core-rust/src/jni.rs` |

两边都只做「JSON 进 / JSON 出」——结构体 ABI 跨语言易踩坑，JSON 可观测、可存档。

## M2 出口条件（方案 §9.2）

**测试定义（严格复刻）**：2000 个 view（各含 1 text）分 50 行 × 40 个，每行外层套 1 个 view
→ 合计 **4050** 元素；**view 不设宽高**，尺寸由内部文字撑开。

| 指标 | 合格 | 目标 |
|---|---|---|
| 4050 渲染耗时 vs 原生 View | ≤ 原生耗时 | ≤ 原生 × 0.6 |
| 增量内存 | ≤ 原生 | ≤ 原生 × 0.8 |

> ⚠️ **§9.2 的测试环境要求（极易产生错误数据）**：必须 release 包 · 每次测试前杀进程重进 ·
> 用 Perfetto 确认跑在**普大核**（被调度到超大核则数据作废）· 监控温度避免降频 ·
> 重复 5 次取均值。
>
> **本宿主的定位**：`layout-report.txt` 里的对比是**单次冒烟**（口径已标注），
> 用于快速判断「方向对不对」；**正式验收须按上述要求单独执行**。

## 运行

```bash
# 前置（一次性）：.tools 下装 NDK 与 JDK 17（脚本会自动定位）
bash hosts/android/build-and-run.sh

# 只构建不安装
bash hosts/android/build-and-run.sh --no-install
```

## 取回报告

```bash
adb shell run-as dev.proteus.layoutcore cat files/layout-report.txt
adb logcat -d -s proteus:I | tail -60
```

## 平台动画（MA0-RT + 逐节点）

两条路径，各有**机器判据**（`hosts/android/check-platform-anim.py`——此前只有手工读数，本轮补齐）：

| 路径 | 覆盖场景 | 机制 |
|---|---|---|
| `platform-anim` | **整页转场** | `ProteusHostView.animatePageComposited`（容器级 `ViewPropertyAnimator` → RenderThread） |
| `platform-anim-node` | **任意节点的合成动画** | `attachAnimCarrier`：把该节点的指令提升为**载体 View**，由平台动画驱动 |
| `kernel-anim` | **内核驱动动画**（tick 路径） | JNI 转发内核 `anim_start/tick_bin/stop/seek_scroll/shared_element` + 宿主逐节点变换绘制 |

★★**内核驱动路径（本轮补齐的关键缺口）**：Android 此前只有**平台**路径 ⇒
**序列编排（keyframes）/ 滚动联动 / 共享元素在本端根本无法运行**（这些动效内核才表达得了）。
本轮补上：JNI 五个导出 + 宿主逐节点变换（`Canvas.save/translate/rotate/scale`，变换语义与 iOS
`applyTransform` 同构）+ Choreographer 帧循环。

```bash
adb shell am broadcast -a dev.proteus.RUN --es path kernel-anim
adb pull /sdcard/Android/data/dev.proteus.layoutcore/files/kernel-anim.json hosts/android/results/
python3 hosts/android/check-kernel-anim.py hosts/android/results/kernel-anim.json
```

★**两个装置坑（都真机踩到，判据文案里已写清）**：
① `View.postOnAnimation` 对**未 attach** 的 View 会**排队** ⇒ 改用 `Choreographer.postFrameCallback`；
② 测试**同步**跑在 `runAll()` 里会被同批重活（§9.2 采样循环）**饿死**主线程
（实测首帧延迟 **3505ms** ⇒ 首帧即停）⇒ `postDelayed` 让出主线程。
★**诚实边界**：`shared_element` 的 `fromNodeId` 路径需要核心树的**绝对几何**（与 iOS `node_abs_rect` 同源）；
本端当前用 `sourceRect`（系统坐标）路径验证，单节点绝对几何入口未接（不影响结论）。

★**为什么逐节点必须落到 View（据 `android.jar` 取证，非记忆）**：`RenderNode` 与
`Canvas.drawRenderNode` 是公开 API，但 **`RenderNodeAnimator` 不公开** ⇒ 裸 `RenderNode`
的属性只能被主线程逐帧"设置"，**无法在 RenderThread 上动画**；能被平台动画的只有 View。
载体只承载**被动画的节点**（其余仍走 `onDraw` 指令流），动画结束即拆除。

```bash
# 构建安装（release）
bash hosts/android/build-and-run.sh --release
# 触发（★App 是**广播触发**：`--es path` 只改按钮文案，不会自动跑）
adb shell am broadcast -a dev.proteus.RUN --es path platform-anim-node
adb shell am broadcast -a dev.proteus.RUN --es path platform-anim
# 取回 + 判据
adb pull /sdcard/Android/data/dev.proteus.layoutcore/files/platform-anim-node.json hosts/android/results/
adb pull /sdcard/Android/data/dev.proteus.layoutcore/files/platform-anim.json hosts/android/results/
python3 hosts/android/check-platform-anim.py hosts/android/results/platform-anim-node.json hosts/android/results/platform-anim.json
```

**判据口径（一处易错）**：B2 量的是**动画窗口内**增量（基线在动画中途取）——
`addView` 接入载体的**一次性**布局/绘制成本不该算作"主线程参与了动画"（如实记录在报告里）。
```

## 三个已实测的坑（脚本已处理）

| # | 坑 | 正解 |
|---|---|---|
| 1 | **必须用 rustup 的 toolchain** | 本机 PATH 上 `rustc` 来自 Homebrew，而 Android target 装在 `~/.cargo` → 脚本显式前置并校验 |
| 2 | **NDK clang 必须显式传给 cargo** | 不设 `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` 会用系统 clang，链接阶段失败 |
| 3 | **sdkmanager 需要 JDK 17+** | Android Studio 自带的是 JDK 11（`UnsupportedClassVersionError`）→ 本仓自带 JDK 17 于 `.tools/jdk17` |

## 截图回归（内容级等价验证）

```bash
# 1) 部署场景（app 用 Rust 几何摆放 20 行色块）
adb shell am start -n dev.proteus.layoutcore/.MainActivity --es path shot
adb shell "am broadcast -a dev.proteus.RUN --es path shot -p dev.proteus.layoutcore"
# 2) 截图 + 核验
adb exec-out screencap -p > scene.png
adb shell "cat /sdcard/Android/data/dev.proteus.layoutcore/files/layout-shot-scene.json" > scene.json
PYTHONPATH=.tools/py python3 screenshot-verify.py scene.json scene.png
```

**它验证什么**：**Rust 算出的几何 → 屏幕上的真实像素**（两个独立来源的比对）。
- 期望侧：宿主机按**场景规格**独立重算（`offset_top + i×row_h`）+ 自己算行色
- 实测侧：设备**系统截图**（走完整显示管线 SurfaceFlinger → 屏幕）
- 故「Rust 布局算错」或「绘制画错」都会失败

**★六个实测坑（都已固化在代码里）**

| # | 坑 | 正解 |
|---|---|---|
| 1 | 截图带 **Display P3** ICC → 与 sRGB 期望值比对失败（饱和色 Δ≈37，中间色 Δ≈6） | 用 `ImageCms` 转换到 sRGB 再比 |
| 2 | 场景 View 被排到按钮之后（差 272px） | 用**绝对定位** + 报告 `view_origin_*` |
| 3 | 布局未完成就读 `getLocationOnScreen`（得 0×0） | `post()` 到布局之后读 |
| 4 | 报告 TextView **盖在场景上**（截图中表现为行内灰色横条） | 截图模式不上屏报告 |
| 5 | 只采行中心 → **3px 错位检不出** | 加**边界区采样**（fy=0.08/0.92） |
| 6 | 期望值取自 app 自己的报告 = **自己判自己的卷** | 宿主机**独立重算**几何与颜色 |

**破坏性验证**：仅绘制侧偏移 4px → 20 行**全部检出**（边界区不符）+ 给出 `dy=-16` 诊断。

## M3 原生组件混用（native-host）

```bash
adb shell am start -n dev.proteus.layoutcore/.MainActivity --es path shot-native
adb shell "am broadcast -a dev.proteus.RUN --es path shot-native -p dev.proteus.layoutcore"
adb exec-out screencap -p > nh.png
adb shell "cat /sdcard/Android/data/dev.proteus.layoutcore/files/layout-native-host.json" > nh.json
PYTHONPATH=.tools/py python3 native-host-verify.py nh.json nh.png
```

**验三件事**（期望由宿主机按**场景规格**独立重算）：
1. **位置由 Rust 几何驱动**：子 View 的 left/top/w/h == 排版核心算出的几何
2. **原生 View 真的在渲染**：截图在该区域取到 WebView 的颜色
3. **z-order 实测**：与 native-host 重叠的自绘色块，屏幕上显示哪个

**★实测结论**：**原生 View 在自绘内容之上**（Android 固有约束：子 View 由 `dispatchDraw` 在 `onDraw` 之后绘制）。
这正是方案 §9 坑位 #4 预警的「层级需专门设计」——现在是**实测确认**而非假设。

| 检查 | 结果 |
|---|---|
| ① 位置由 Rust 几何驱动 | ✓ (60,320) 750×200 精确一致 |
| ② 原生 View 真在渲染 | ✓ WebView 蓝 |
| ③ z-order | **native-on-top**（如实记录约束） |
| 自绘行复核 | 4/4 ✓ |

**破坏性验证**：native-host 几何偏移 25px → **2 处失败被检出**（位置不符 + 相邻自绘行被遮）。

## 滚动同步（z-order 约束下，方案坑位 #4）

```bash
# 用「等状态文件就绪」而非固定 sleep 抓图（★关键：exec-out screencap 传输耗时会错位）
bash hosts/android/scroll-sequence.sh   # 见脚本；或按 README 手动两步
PYTHONPATH=.tools/py python3 scroll-sync-verify.py <报告目录> <截图目录>
```

**验三件事**（期望由宿主机按规格独立重算）：
1. **native-host 跟随**：`translationY == -scrollY`（且 `layoutTop` 不变 = 零 layout 成本）
2. **滚出视口被裁**：超出视口时 `INVISIBLE` + 屏幕上无残留像素
3. **与自绘内容同步**：同一 scrollY 下，自绘行与 native-host 相对位置不变

**实测（4 个 scrollY：0 / 120 / 300 / 700）**：全部通过——
native-host 跟随 ✓ · 裁剪 ✓ · 自绘行 23/23、23/23、21/21、15/15 ✓

### 两条关键设计

| 决策 | 理由 |
|---|---|
| native-host 平移用 **`setTranslationY`** 而非重新 `layout()` | `layout()` 会触发子 View 测量（每帧重跑）；`translationY` 只影响绘制变换（RecyclerView 同款做法） |
| native-host 裁剪**必须手动做** | Android 的 `clipChildren` 只能裁到**父 View 边界**；滚动容器可能只是页面一部分 → 必须按视口显式判定。**这就是方案说「滚动同步需专门设计」的实质** |

### 实测坑

**★截图时序**：用固定 `sleep` 抓多步序列时，`exec-out screencap` 的**传输耗时**会让截图落后一步
（实测：步0 的图实际是步1 的状态，表现为「整体偏移 120px」）。正解：**等状态文件就绪再截图**。
