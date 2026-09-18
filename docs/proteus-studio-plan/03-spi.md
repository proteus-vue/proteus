# G-56 SPI

> 设计原则：**本份新增类型极少，绝大部分复用既有 SPI。**
> 这是 SPI-First 复利的体现——第 19 次泛化只新增 3 个类型。

---

## 1. 新增类型清单（仅 3 个）

| 类型 | 用途 | 复用关系 |
|------|------|---------|
| `StudioShell` | 宿主壳生命周期 | 实现 G-55 `HostAdapter` |
| `EmbedStrategy` | 模拟器嵌入策略 | 扩展 G-53 `DeviceBridge` |
| `PlatformRisk` | 平台风险探测 | 新增 |

**其余全部复用**：`FrameworkKnowledgeProvider`（G-55）、`DeviceBridge`（G-53/54）、`TestSuite`/`TestReport`（G-44/51）。

---

## 2. StudioShell

```typescript
interface StudioShell extends HostAdapter {
  readonly id: 'studio'

  // 生命周期
  boot(config: StudioConfig): Promise<ShellHandle>
  shutdown(handle: ShellHandle): Promise<void>

  // 面板编排
  mountPanel(panel: PanelSpec): Promise<PanelHandle>
  layout(spec: LayoutSpec): Promise<void>

  // 平台探测
  detectPlatform(): PlatformRisk
}

interface StudioConfig {
  workspace: string
  kernelEndpoint: string        // G-55 内核地址
  panels: PanelSpec[]
  fallbackChain: EmbedStrategy[] // 降级链
}

type PanelSpec =
  | { kind: 'editor';    path: string }              // CodeMirror 6
  | { kind: 'terminal';  command: string }           // xterm.js + pty
  | { kind: 'device';    bridge: DeviceBridge }      // libmpv
  | { kind: 'knowledge'; view: KnowledgeView }       // G-54 六项能力
  | { kind: 'assertions'; suiteId: string }          // G-54 conformance
```

---

## 3. EmbedStrategy（模拟器嵌入）

```typescript
type EmbedStrategy =
  | { mode: 'mpv-wid';     wid: number }   // Windows HWND / Linux Xlib / macOS NSView
  | { mode: 'mpv-offscreen'; fbo: number } // 离屏 FBO，真嵌入
  | { mode: 'window';      }               // 独立窗口
  | { mode: 'web';         url: string }   // 浏览器
  | { mode: 'headless';    }               // 无画面

interface EmbedResolver {
  resolve(env: PlatformRisk): EmbedStrategy
}

// 降级链：每一档都可回退，永不崩溃
function resolve(env: PlatformRisk): EmbedStrategy {
  if (env.displayServer === 'wayland') return { mode: 'window' }
  if (env.gpu === 'nvidia-linux')      return { mode: 'web' }
  if (env.headless)                    return { mode: 'headless' }
  return { mode: 'mpv-wid', wid: env.windowId }
}
```

### 3.1 归一化坐标（复用 G-53 规约）

serve-sim 强制坐标 **0..1**，`(0,0)` 左上角。**传像素坐标在换分辨率后全错。**

```typescript
interface DeviceInput {
  // 必须归一化；DeviceBridge 适配层负责转换
  tap(x: number, y: number): Promise<void>      // x,y ∈ [0,1]
  swipe(from: Point, to: Point, steps: number): Promise<void>
}
```

> **G-56.3**：DeviceBridge 适配层**必须**做归一化校验，拒绝像素坐标输入。

---

## 4. PlatformRisk

```typescript
interface PlatformRisk {
  os: 'macos' | 'linux' | 'windows' | 'ios' | 'android'
  displayServer?: 'x11' | 'wayland' | 'quartz'
  gpu?: 'nvidia-linux' | 'apple-silicon' | 'other'
  webkitVersion?: string
  headless: boolean
  risks: RiskFlag[]
}

type RiskFlag =
  | 'WEBKITGTK_WHITE_SCREEN'   // NVIDIA + WebKitGTK → 全白
  | 'WEBKITGTK_VERSION_MISMATCH' // Ubuntu 20.04/22.04/24.04 互不兼容
  | 'WEBGL_SILENT_FALLBACK'    // 软件光栅化且 renderer 被伪装成 Apple GPU
  | 'WAYLAND_EMBED_UNSUPPORTED' // Wayland 下 --wid 嵌入失效
  | 'MPV_MISSING'
```

### 4.1 ⚠️ WebGL 静默降级是最危险的

WebKitGTK 为防指纹追踪，把 renderer string 伪装成 `"Apple GPU"`。
**这意味着无法通过常规手段检测真实渲染后端。**

**缓解**（非根治）：

```typescript
// 用帧率实测间接推断，而非信任 renderer 字符串
async function probeRenderBackend(canvas): Promise<'hw' | 'sw' | 'unknown'> {
  const fps = await measureFps(canvas, durationMs = 1000)
  if (fps > 50) return 'hw'
  if (fps < 20) return 'sw'
  return 'unknown'   // ★ 诚实标注 unknown，不猜
}
```

> **G-56.5**：`unknown` 必须如实上报，**禁止默认当作 'hw'**。
> 这是 G-37「未实测不宣称」在平台探测上的应用。

---

## 5. DeviceBridge 双通道扩展

G-53 的 `DeviceBridge` 只有控制通道。G-56 补上视频通道：

```typescript
interface DeviceBridge {
  // 既有（G-53）
  runtime: RuntimeKind
  boot(profile: DeviceProfile): Promise<Handle>
  runIsolated(suite: TestSuite): Promise<Report>

  // ★ 新增：画面通道
  videoStream(handle: Handle): Promise<StreamEndpoint>
  input(handle: Handle, input: DeviceInput): Promise<void>

  // ★ 新增：就绪探针（复用 serve-sim /healthz /readyz）
  waitReady(handle: Handle, timeoutMs: number): Promise<ReadyState>

  // ★ 新增：语义断言（替代截图比对）
  accessibilityTree(handle: Handle): Promise<AXNode[]>
}
```

### 5.1 无障碍树替代截图比对

**这是解决跨设备视觉测试 flaky 的正解。** 截图比对在字体渲染、暗色模式、折叠屏下必然误报；无障碍树是语义级，跨设备稳定。

```typescript
interface AXNode {
  role: string
  label?: string
  value?: string
  frame: NormalizedRect   // 0..1
  children: AXNode[]
}
```

---

## 6. 移动端伴侣 SPI

```typescript
interface CompanionBridge {
  // 手机上的 App 直连 Studio
  attach(target: AppTarget): Promise<CompanionHandle>

  // 真机上查看自己的运行时状态（三个宿主做不到）
  inspectSPI(handle: CompanionHandle): Promise<SPIState>
  inspectIsolation(handle: CompanionHandle): Promise<IsolationState>  // G-49
  runConformance(handle: CompanionHandle, suite: TestSuite): Promise<Report>
}
```

**独特价值**：装在手机上的 App，在一个界面里看到它自己的 SPI 后端、隔离状态、conformance 结果。

> **VSCode / IntelliJ / Zed 都没有移动端形态**——不是"没做"，是"结构上做不了"。

---

## 7. 错误模型（延续 G-50 三级）

| 级别 | 场景 | 处理 |
|------|------|------|
| **User** | 工作区路径错误 | 提示修正 |
| **Environment** | mpv 缺失 / WebKitGTK 白屏 | **降级，不崩溃** |
| **Internal** | 内核 RPC 失败 | 上报 + 降级 |

**Environment 级一律降级**——这是 G-51 INV-02「能力缺失 → 降级 ≠ 崩溃」的延续。
