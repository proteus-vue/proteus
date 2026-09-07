# 运行时 Style Validator

> 只在"编译期无法推导的动态值"上触发——最后一道闸门。

---

## 1. 职责

1. 属性名白名单检查
2. 值类型守卫（Length / Color / Opacity）
3. 逐平台类型收窄
4. 降级 + warn / 上报

---

## 2. 核心实现

```typescript
// runtime/style-safety/validator.ts
import { ALLOWED_STYLE_PROPS, PROP_TYPES } from './whitelist'
import { narrowValue } from './platform-narrowing'
import { Platform } from '../platform'

export interface ValidationResult {
  valid: boolean
  nativeProp?: string
  nativeValue?: unknown
  reason?: string
}

export function validateStyle(
  style: Record<string, unknown>,
  platform: Platform
): Record<string, unknown> {
  const validated: Record<string, unknown> = {}
  const rejections: string[] = []

  for (const [prop, value] of Object.entries(style)) {
    const result = validateProp(prop, value, platform)
    if (result.valid) {
      validated[result.nativeProp ?? prop] = result.nativeValue
    } else {
      rejections.push(`${prop}: ${value} → ${result.reason}`)
      // 降级到默认值（见 01 §5）
      const fallback = getFallback(prop)
      if (fallback !== undefined) validated[prop] = fallback
    }
  }

  // 开发模式：warn；生产 debug：上报
  if (rejections.length > 0) {
    if (__DEV__) {
      console.warn(`[Proteus StyleSafety] ${rejections.length} 条样式被拒绝:\n` +
        rejections.join('\n'))
    } else if (import.meta.env?.PROTEUS_STYLE_REPORT) {
      reportStyleRejections(rejections)
    }
  }

  return validated
}

function validateProp(
  prop: string,
  value: unknown,
  platform: Platform
): ValidationResult {
  // 1. 白名单检查
  const kind = (ALLOWED_STYLE_PROPS as any)[prop]
  if (!kind) {
    return { valid: false, reason: `属性 ${prop} 不在白名单（STS001）` }
  }
  if (kind === 'FORBIDDEN') {
    return { valid: false, reason: `${prop} 已禁用（CSS001）` }
  }
  if (kind === 'SEMANTIC_ONLY') {
    return { valid: false, reason: `${prop} 必须用语义组件（STS003）` }
  }

  // 2. 类型守卫
  const guard = (PROP_TYPES as any)[prop]
  if (guard && !guard(value)) {
    return { valid: false, reason: `${prop} 值类型非法: ${value}` }
  }

  // 3. 逐平台收窄
  return narrowValue(prop, value, platform)
}
```

---

## 3. 集成点：Custom Renderer 的 `patchStyle`

```typescript
// App Renderer / nodeOps.ts
import { validateStyle } from '@proteus-vue/runtime/style-safety'

function patchStyle(el: NativeView, prev: any, next: any) {
  if (!next) return

  // ★ 关键拦截：校验后才调 JSI
  const platform = getCurrentPlatform()
  const validated = validateStyle(next, platform)

  el.applyStyle(validated)  // JSI 只收到已验证的值
}
```

**`patchStyle` 是 Vue Reconciler 的标准钩子**——接入点零侵入。

---

## 4. 性能预算

| 指标 | 预算 | 实测目标 |
|------|------|---------|
| 单次 `validateStyle` | < 0.1ms | O(n) 属性数，n 通常 ≤ 10 |
| 首屏额外开销 | < 3% | 静态推导覆盖 > 80% |
| 滚动帧 | < 0.5ms | Worklet 隔离 |

**优化手段：**
- 白名单用 `Object.hasOwn` 查表（O(1)）
- 类型守卫内联
- 生产模式 `__DEV__` 分支 tree-shake

详见 `10-benchmark-budgets.md`。

---

## 5. 降级策略

| 场景 | 开发模式 | 生产模式 |
|------|---------|---------|
| 未知属性名 | 报错 | 静默丢弃 |
| 白名单属性 + 非法值 | warn + 降级 | 静默丢弃 + 可选上报 |
| 语义组件属性 | 报错 + 引导 | 静默丢弃 |
| 类型错误 | warn + 降级 | 静默丢弃 + 上报 |

**降级默认值**（01 §5）：`width/height → 0`、`opacity → 1`、`color → inherit`、`borderRadius → 0`。

---

## 6. 上报（生产 debug 模式）

```typescript
// 灰度阶段开启，收集线上真实非法样式
function reportStyleRejections(rejections: string[]) {
  // 去重 + 采样 + 上报到监控
  telemetry.report('style_rejection', {
    route: currentRoute,
    count: rejections.length,
    samples: rejections.slice(0, 5),
  })
}
```

**用途：** 发现第三方组件库 / 遗留代码的样式问题。

---

## 7. 与 Memory Plan 的协同

- Validator 内部对象**短生命周期**（每帧创建后即弃）
- 走 `Owner` 作用域，页面销毁时自动释放
- 不持有原生引用 → 无 JSI 循环引用风险

详见 `proteus-memory-plan` 04-resource-owner-model.md。
