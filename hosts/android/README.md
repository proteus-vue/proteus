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

## 三个已实测的坑（脚本已处理）

| # | 坑 | 正解 |
|---|---|---|
| 1 | **必须用 rustup 的 toolchain** | 本机 PATH 上 `rustc` 来自 Homebrew，而 Android target 装在 `~/.cargo` → 脚本显式前置并校验 |
| 2 | **NDK clang 必须显式传给 cargo** | 不设 `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` 会用系统 clang，链接阶段失败 |
| 3 | **sdkmanager 需要 JDK 17+** | Android Studio 自带的是 JDK 11（`UnsupportedClassVersionError`）→ 本仓自带 JDK 17 于 `.tools/jdk17` |
