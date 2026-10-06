# 把 Proteus 嵌进你的 Android App（Host ABI v1）

> **这份文档面向"已有 Android App、想试用 Proteus 渲染某个页面"的开发者**。
> 目标：**你不需要装 Proteus 工具链**，把 AAR 放进 `libs/` 即可（方案 §8.2 的二进制集成）。

## 0. 30 秒开始

```java
// ① App 启动时预热（可选，但强烈建议：避免首屏白屏，见 §4）
ProteusEngine.prewarm();

// ② 实现两个回调（就这两个，见 §2）
public class MyActivity extends Activity implements ProteusHost {
    @Override public long measureText(String text, float fontSize, int fontWeight, String fontFamily) { … }
    @Override public void requestFrame() { Choreographer.getInstance().postFrameCallback(…); }
}

// ③ 建引擎 → 装树 → 每帧推进
ProteusEngine engine = ProteusEngine.create(this);
engine.loadTree(treeJson);
// 每帧（在 Choreographer 回调里）：
engine.frame(System.nanoTime());
byte[] updates = engine.frameUpdates();   // 24B/条，直接套到你的视图上
```

可运行的完整例子：`hosts/android/embed-demo/`（**独立包名**的第三方 App，只依赖 AAR）。

## 1. 引入 AAR

```bash
# 产出（本仓）
bash platform/android/build-aar.sh        # → platform/android/build/proteus-sdk.aar
```

客户侧（Gradle）：

```groovy
// app/build.gradle
android {
    // ★必须：Android 15+ 要求 .so 16 KB 对齐（AAR 已对齐，此处是打包侧的对应处理）
    packagingOptions { jniLibs { useLegacyPackaging = false } }
}
dependencies {
    implementation files('libs/proteus-sdk.aar')
}
```

**AAR 里有什么**（`unzip -l` 可自查）：

| 文件 | 作用 |
|---|---|
| `AndroidManifest.xml` | 清单（`minSdk 24`） |
| `classes.jar` | Java 门面：`dev.proteus.sdk.ProteusEngine` / `ProteusHost` |
| `jni/arm64-v8a/libproteus_jni.so` | native 库（内核 + Host ABI，**已 16 KB 对齐**） |
| `R.txt` | 空资源表（本 SDK 无资源） |

## 2. 实现宿主回调（只有两个是必需的）

```java
public interface ProteusHost {
    long measureText(String text, float fontSize, int fontWeight, String fontFamily);
    void requestFrame();
}
```

**为什么是这两个**：

- `measureText`——内核**不自研文本**（Profile §L4）：文本尺寸必须由平台给（Android 用 `Paint`，
  iOS 用 CoreText）。⚠️ **必须调 `paint.setTextSize(fontSize)`**——内核把字号交给你，
  忽略它会让"量的尺寸"与"画的尺寸"分叉（表现为文字被裁/间距错乱）。
- `requestFrame`——内核**不自建线程**（方案 §5.1）：帧调度权归宿主（Android 用 `Choreographer`）。

**返回值约定**：`measureText` 返回**打包的两个 float**（宽、高）——
低 32 位放 `Float.floatToRawIntBits(width)`，高 32 位放高度：

```java
return (Float.floatToRawIntBits(w) & 0xFFFFFFFFL) | (((long) Float.floatToRawIntBits(h)) << 32);
```

> 为什么不用 `float[]`：本方法**每棵树每个文本节点调一次**；返回数组 = 每次一个临时对象（GC 压力）。
> 两个 f32 恰好塞进一个 i64 ⇒ 零分配。

**线程契约**（方案 §5.2）：所有引擎调用必须在**同一线程**（你的主线程）；
这两个回调也由引擎在**同一线程内同步调用**——不会从别的线程打回来。

### 2.1 原生组件（可选 · 引擎驱动生命周期）

树里 `nativeHost: true` 的节点（地图 / 视频 / web-view / 第三方 SDK）需要**真原生 View**。
你只需实现三个**可选**回调，**引擎会替你编排生命周期**（你不必维护"IR ↔ 原生对象"的对应）：

```java
// 默认实现返回 null / 空操作 ⇒ 不实现就是"不支持原生组件"（引擎在树里遇到 nativeHost **明确报错**，不静默）
@Override public Object nativeViewCreate(String kind, float x, float y, float w, float h) { … }
@Override public void   nativeViewUpdate(Object handle, float x, float y, float w, float h) { … }  // 仅几何真变时调
@Override public void   nativeViewDestroy(Object handle) { … }
```

- 三个方法都有**缺省实现**（opt-in）：不支持某个 `kind` ⇒ `nativeViewCreate` **返回 null**，
  引擎记为"宿主拒绝创建"（`stats().native_view_create_failed` + `last_error`）——业务侧应走降级，**不要假设可用**。
- 引擎负责：`loadTree` 建新树 ⇒ 调 `create`；`submitFrame`（布局变了）⇒ 调 `update`；
  节点消失 / 换树 / `close()` ⇒ 调 `destroy`。**滚动 / 动画帧**后调一次 `engine.syncNativeViews()`。
- **z-order 由你决定**：原生 View 与自绘内容的层序是平台成本（Android 后加的 View 在上；
  iOS 子视图天然在上）——内核只给几何，不抽象层序。
- 几何单位与 `measureText` 的 `fontSize` 一致（v1 = 逻辑像素/px）。

## 3. 驱动一帧（批处理红线）

```java
// 一帧的全部指令，一次提交（引擎**没有**逐节点入口——这是设计，不是遗漏）
engine.submitFrame(opsBytes);
engine.frame(System.nanoTime());
byte[] updates = engine.frameUpdates();
```

- `updates` 是 **24B/条**：`id u32 + tx/ty/scale/rotate/opacity f32`（小端）。
  用 `ByteBuffer.order(LITTLE_ENDIAN)` 直读，**无 JSON 解析**。
- 平移/缩放/旋转的语义：**先平移，再以元素中心为锚做缩放/旋转**（与内核一致）。
- 指令流（`opsBytes`）的格式见 `docs/generated/instruction-spec.md`（magic + 版本 + 计数 + 池 + 指令体）；
  通常由 Proteus 编译器产出，你不必手写。

**自检**：`engine.stats()` 里 `submit_frame_calls` 应等于**帧数**（不是节点变更数）——
如果它随变更数增长，说明你在循环里逐次调用了。

## 4. 预热（避免首屏白屏）

Flutter Add-to-App 的已知问题：引擎初始化 100–200ms，若只在用户点击时才初始化会白屏闪烁；
官方解法是**预热**。Proteus 同理：

```java
// Application.onCreate：
ProteusEngine.prewarm();
```

⚠️ **诚实边界**：`prewarm()` 目前只做初始化（注册表等）；**真正的重活**是首次 `loadTree`
的解析 + 建树。想要"真热"，在启动阶段先 `loadTree` 一个**空树**（几毫秒）：

```java
// 需要宿主实例（引擎要回调量文本/排帧——即使空树也需要，因为契约要求两者齐备）
ProteusEngine.warm(this);
```

`warm(host)` 就是"建引擎 → 装空树 → 销毁"的便捷封装（已在本 SDK 中提供）。
它复用的是 **JIT 热码与分配器状态**，而不是某个引擎对象（引擎与树生命周期绑定）。

## 5. 能力与产物匹配（HA3）

产物可以声明它**需要哪些能力**（`requiredCapabilities`），壳声明它**提供哪些能力**：

```java
// 壳侧（你的 App 有什么）——**接受 Proteus CLI 产出的 capability-manifest.json 的同形**
engine.setShellCapabilities("{\"capabilities\":[{\"id\":\"network.request\",\"tier\":1}]}");

// 校验（通常由产物自带的 requiredCapabilities 自动触发；也可显式调）
int rc = engine.checkCapabilities("[\"network.request\"]");
if (rc == ProteusEngine.ERR_CAPABILITY_UNREGISTERED) {
    // 缺失：读 stats().last_error 拿到**可操作**报告（点名缺失项 / 列出已提供 / 指向扩展壳）
}
```

引擎在 `loadTree` 时会**自动**校验产物里的 `requiredCapabilities`——不满足就**拒绝加载**
（而不是跑到一半崩）。缺失报告在 `stats()` 的 `last_error` 里，也可读 logcat（`[proteus]` 前缀）。

## 6. 输入

```java
// 一帧的所有指针事件，一次提交（同样有批处理要求）
long hit = engine.dispatchPointers(xs, ys, types, timestampsNs);
// types: 0=DOWN 1=MOVE 2=UP 3=CANCEL；timestampsNs 用 System.nanoTime()
// 返回命中的节点 id；0 = 未命中
```

⚠️ **时间戳必须带**（方案 §2.4）：输入延迟指标依赖它；没有它，手势延迟测不准。

## 7. 排查（出问题时先看这里）

| 现象 | 先看 |
|---|---|
| 引擎创建失败（抛 `IllegalStateException`） | logcat 里 `[proteus]` 前缀的提示 |
| 文本尺寸不对 / 文字被裁 | `measureText` 里**有没有** `paint.setTextSize(fontSize)` |
| 界面无更新 | `stats()` 的 `frames` / `submit_frame_calls`；以及**有没有动画在跑**（`frameUpdates()` 的数据来自动画——静态树没有逐帧更新） |
| 能力校验一直接失败 | `stats().last_error`（有可操作报告） |
| 症状像崩溃但没栈 | `UnsatisfiedLinkError` ⇒ AAR 的 `jni/` 没进包（Gradle 的 `useLegacyPackaging`） |

`engine.stats()` 返回 JSON，关键字段：
`frames` · `submit_frame_calls` · `submitted_ops`（批处理） · `measure_calls`（回调活性） ·
`native_view_*`（原生组件） · `last_error`（最近一次失败原因）。

## 8. 运行/更新产物

- **树 JSON**（`loadTree` 的参数）由 Proteus 编译器产出（本地或 CDN 下发均可）。
- 更新用同一个入口（`loadTree` 会**替换**整棵树：先销毁旧的原生组件、再建新的）。
- 增量更新走 `submitFrame(opsBytes)`——那是 Vapor IR 的二进制指令流。

## 9. 边界（如实说明）

- **单一 ABI**：AAR 目前只含 `arm64-v8a`（本仓验证设备形态）。32 位/模拟器需另加成。
- **引擎侧不做原生 View 的可见性裁剪**：虚拟化场景下的预载策略属另一批次。
- **z-order**：原生组件与自绘内容的层序由平台决定（Android 需显式处理）——内核只给几何。
- **`AnimOp` 走指令流**：动画目前经 `engine.animStart(JSON)` 直调（语义与内核一致）；
  走 ops 流是后续工作。
- 更细的契约以 `packages/host-abi/include/proteus_host_abi.h` 为准（那是**单一来源**）。
