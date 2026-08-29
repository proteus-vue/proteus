# 平台能力探测（PlatformCapability）

> 组件层判断“走 Web 还是走 Skyline/Worklet”的唯一入口。任何组件代码不得直接 `if (isSkyline)`，必须查询 capability。

---

## 1. 设计

```ts
// @proteus/components/runtime/capability.ts
export interface PlatformCapability {
  /** 当前渲染后端 */
  backend: 'web' | 'skyline' | 'app'
  /** 能力查询（同步，启动期确定） */
  has(name: CapabilityName): boolean
  /** 运行时动态探测（如基础库版本） */
  detect(name: DynamicCapability): Promise<boolean>
}

export type CapabilityName =
  | 'worklet-animation'   // applyAnimatedStyle
  | 'recycle-manager'     // Skyline 长列表
  | 'app-bar'             // 全局 appBar
  | 'gesture-worklet'     // Worklet 手势
  | 'native-toast'        // 原生 showToast（注意：A9 建议用自定义）
  | 'fixed-position'      // position:fixed 支持度
  | 'webp'                // 图片格式
  | 'passive-event'       // 被动事件监听
```

---

## 2. 实现策略

| Backend | 探测方式 |
|---------|----------|
| `web` | `window`、`CSS.supports`、`IntersectionObserver` |
| `skyline` | `wx.getRenderer()`、基础库版本、`__wxConfig` |
| `app` | Custom Renderer 注入的能力表（未来） |

启动时由 `@proteus/runtime` 创建 **只读** capability 对象，注入 Vue app（`app.config.globalProperties.$capability`）。

---

## 3. 降级模式

```ts
// 组件内示例（p-popup）
const showAnimation = capability.has('worklet-animation')
  ? useWorkletTransition(props)
  : useCssTransition(props)
```

规则：
- 同步能力 → `has()`，在 `setup()` 求值一次缓存。
- 异步能力 → `detect()`，`await` 后用默认值兜底。
- 降级结果必须可观测：`__PROTEUS_DEV__` 下暴露 `window.__proteus_capability__`。

---

## 4. 降级配置

```ts
// proteus.config.ts
export default defineConfig({
  components: {
    degradation: {
      warn: true,           // 是否打印降级警告
      webp: 'fallback-jpg', // 'warn' | 'fallback-jpg' | 'strict-error'
      fixedPosition: 'transform-to-absolute',
    },
  },
})
```

CI 环境默认 `strict-error`，业务开发默认 `warn`。

---

## 5. 新增能力流程
1. 在 `CapabilityName` 加字段 + 三端探测实现。
2. 在 `01-component-matrix.md` 对应组件标注。
3. 补单测：mock capability 验证两条分支。
4. 更新 `09-execution-batches.md` 对应批次。
