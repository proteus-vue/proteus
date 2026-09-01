# @proteus-vue/fluid

Proteus 柔性框架系统（fluid-system-plan）核心——**多形态设备（折叠屏/平板/车机/多窗口）的语义布局体系**。

## 核心抽象：FluidContext

响应式基准 = **容器**（非视口）——车机/多窗口/嵌入场景按容器尺寸求解：

```ts
import { createContainerQuery, createDeviceEnv } from '@proteus-vue/fluid'

const query = createContainerQuery(el, { designWidth: 375 })
const off = query.subscribe((s) => {
  console.log(s.width, s.orientation, s.breakpoint) // 容器宽度/方向/容器级断点（sm/md/lg/xl）
})

const env = createDeviceEnv() // 折叠屏形态（fold/span/expand）/ 减少动效 / 方向
env.subscribe((e) => console.log(e.displayMode, e.isDriveMode))
```

## 能力

| API | 说明 |
|-----|------|
| `createContainerQuery(el, { designWidth?, breakpoints?, resizeObserver?, readSize? })` | 容器查询：尺寸/方向/容器级断点订阅（ResizeObserver 注入可单测） |
| `deriveContainerBreakpoints(designWidth, ratios?)` / `resolveBreakpoint(width, bps)` | 容器断点推导/求解（与 fluid-layout 算法同源） |
| `createDeviceEnv({ matchMedia?, isDriveMode? })` | 设备环境：折叠形态/驾驶模式/减少动效/方向（matchMedia 注入可单测） |

零依赖纯逻辑；Web 运行时 + MP/App 求解器共用同一状态模型（App 原生求解器接口预留，B4/B5 后接）。

## 组件

`p-split` / `p-zone` 等语义组件（自适应分栏 / 容器断点分区）位于扩展组件体系 `src/components/`（薄壳引用本包），
S2 迁入包内组件目录 + mpTransform 多组件目录支持。

## 文档

`docs/proteus-fluid-system-plan/README.md`（体系蓝图 + 场景矩阵 + S1-S5 分批）
