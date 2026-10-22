# Android 宿主第三方依赖（vendored）

> ★本目录是**唯一**允许放第三方运行时 jar 的位置（宿主运行时只依赖 `android.jar` 的约定由此开例外）。
> 入库理由：宿主与 CLI 生成的壳都走**手工构建链**（`aapt2 → javac → d8 → apksigner`，无 Gradle/Gradle 依赖解析），
> 因此依赖必须**随仓库分发**；否则换机/CI 无网即无法构建。

| 文件 | 版本 | 大小 | sha256 |
|---|---|---|---|
| `okhttp-3.14.9.jar` | OkHttp 3.14.9 | 430,488 B | `2570fab55515cbf881d7a4ceef49fc515490bc027057e666776a2832465aeca0` |
| `okio-1.17.2.jar` | Okio 1.17.2 | 91,980 B | `f80ce42d2ffac47ad4c47e1d6f980d604d247ceb1a886705cf4581ab0c9fe2b8` |

Maven 坐标：`com.squareup.okhttp3:okhttp:3.14.9` + `com.squareup.okio:okio:1.17.2`（Apache-2.0）。

## ★为什么是 3.14.9，不是 4.x（实测体积差 5 倍）

用本仓**同一套 d8 参数**（`--release --min-api 24 --lib android.jar`）在 2026-10-22 实测：

| 组合 | dex 未压缩 | 装进 APK（压缩后） | 结论 |
|---|---|---|---|
| 现状（无 OkHttp，`HttpURLConnection`） | 627,800 B（生产 APK 的 classes.dex） | 292,290 B | 基线 |
| **OkHttp 3.14.9 + Okio 1.17.2** | 388,392 B | **184,549 B** | **+180 KB/APK** |
| OkHttp 4.12.0 + Okio 3.6.0 + kotlin-stdlib 1.8.21 | 2,879,144 B | 951,024 B | +929 KB/APK |

4.x 用 Kotlin 重写 ⇒ 必须带 `kotlin-stdlib`（单它就 1.6 MB 未压缩）。为一个「Android 端协商 h2 + 自定义 DNS」
付 ~930 KB 不划算；3.14.9 是最后一个**纯 Java** 稳定线，功能面（`Dns` / `Protocol.HTTP_2` / `EventListener`）
对本次诉求完全够用。

★**诚实边界**：3.x 已进入停止维护线（安全修复不再回移）。若将来因 CVE 必须升 4.x，
代价是 **+929 KB 且引入 Kotlin 运行时**——届时需重新评估（体积/启动/包大小预算），不能静默升级。
**升级前先读本表重跑同一套 d8 测量**（口径见 `tests/android-okhttp-transport.test.ts` 的
「vendor 目录有 OkHttp 3.x」组：它断言版本线、README 记录 sha256、以及不得混入 4.x）。
