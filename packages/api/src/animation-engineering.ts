// packages/api/src/animation-engineering.ts
// ★G-32 B5 续二（proteus-semantic-primitives-plus-plan §8 ③）：E21-E23 动画语义面——injectable 设计
//   E21 useAnimation（wx.createAnimation 语义——声明式关键帧构建器）/ E22 useGestureAnimation（手势驱动：增量累积）
//   E23 useScrollAnimation（滚动驱动：进度 → 插值关键帧）；组件形态 E19 p-transition / E20 p-animate 在 src/components
//   注入式：reactivity（vue 或 mock）+ driver（Web WAAPI / MP 宿主 wx.createAnimation / 测试录制）——同
//   createEngineering / createRouterEngineering 零运行时依赖 vue 族；缺 driver 时 play 安全 no-op
//   MP 产物安全（决策 #32/#36）：无 ?. / ??；无数组解构
import type { Reactivity } from './engineering'

/** 动画属性子集（transform/opacity 语义——wx.createAnimation 兼容面） */
export interface AnimationProps {
  /** translateX（px） */
  x?: number
  /** translateY（px） */
  y?: number
  /** scale 缩放系数 */
  scale?: number
  /** rotate 旋转（deg） */
  rotate?: number
  /** opacity 透明度 */
  opacity?: number
}

/** 一步关键帧（offset 0..1） */
export interface AnimationKeyframe {
  offset: number
  props: AnimationProps
  easing?: string
}

/** 导出动画描述（消费方交给 host 驱动：Web WAAPI / MP wx.createAnimation / 测试断言） */
export interface AnimationDescriptor {
  keyframes: AnimationKeyframe[]
  duration: number
  timingFunction: string
  delay: number
  iterations: number
}

/** 步骤级选项（wx.step 语义：每个关键帧可覆盖时长/缓动/延迟） */
export interface AnimationStepOptions {
  duration?: number
  timingFunction?: string
  delay?: number
}

/** 运行句柄（E21 play——driver 注入；缺省 no-op 安全） */
export interface AnimationRun {
  play(): void
  pause(): void
  reverse(): void
  cancel(): void
  finish(): void
  seek(offsetMs: number): void
  onFinish(cb: () => void): void
}

/** 动画驱动（注入——Web：Element.animate；MP：宿主桥 wx.createAnimation；测试：录制调用） */
export interface AnimationDriver {
  run(target: unknown, descriptor: AnimationDescriptor): AnimationRun
}

/** 播放状态（reactivity 注入 → 响应式） */
export type AnimationState = 'idle' | 'running' | 'finished'

/** E21 useAnimation 控制器（声明式构建器——wx.createAnimation 语义） */
export interface AnimationController {
  /** 链式合并属性到当前帧（同 .translate().opacity() 连续追加） */
  set(props: AnimationProps): AnimationController
  /** 提交当前帧为一步关键帧（wx.step 语义） */
  step(options?: AnimationStepOptions): AnimationController
  /** 清空累积与关键帧 */
  reset(): AnimationController
  /** 导出关键帧描述（offset 按时长占比分布） */
  export(): AnimationDescriptor
  /** 播放（driver 注入 → 运行句柄；缺 driver → undefined 安全 no-op） */
  play(target?: unknown): AnimationRun | undefined
  /** 播放状态（响应式） */
  state: { value: AnimationState }
}

/** E22 useGestureAnimation 句柄（手势驱动：增量累积 → 提交帧） */
export interface GestureAnimationHandle {
  /** 手势增量累积（pan dx/dy、pinch scale、旋转 deg——合并到当前帧） */
  apply(props: AnimationProps): void
  /** 提交当前帧（手势抬离——step 语义） */
  commit(options?: AnimationStepOptions): void
  /** 重置累积（新手势会话） */
  reset(): void
  /** 导出动画描述 */
  export(): AnimationDescriptor
  /** 播放状态（响应式） */
  state: { value: AnimationState }
}

/** E23 useScrollAnimation 句柄（滚动驱动：进度 → 插值关键帧） */
export interface ScrollAnimationRange {
  from: AnimationProps
  to: AnimationProps
}

export interface ScrollAnimationHandle {
  /** 设置滚动进度（0..1，越界钳制）→ 插值当前属性 */
  setProgress(p: number): void
  /** 当前插值属性（可直接应用/读取） */
  value(): AnimationProps
  /** 导出区间关键帧描述（from@0 → to@1） */
  export(): AnimationDescriptor
}

/** createAnimationEngineering 注入项 */
export interface AnimationEngineeringOptions {
  /** reactivity（注入——与 createEngineering 同族） */
  reactivity: Reactivity
  /** 动画驱动（缺省 undefined——play 安全 no-op；Web 可注入 WAAPI、MP 由宿主桥承接） */
  driver?: AnimationDriver
}

/** G-32 §8 ③ 动画语义（E21-E23 Hook 形态；E19/E20 组件形态在 src/components） */
export interface AnimationEngineering {
  /** E21 useAnimation：wx.createAnimation 语义构建器 */
  useAnimation(options?: AnimationStepOptions): AnimationController
  /** E22 useGestureAnimation：手势驱动动画（增量累积 → 提交帧） */
  useGestureAnimation(): GestureAnimationHandle
  /** E23 useScrollAnimation：滚动驱动动画（进度 → 插值关键帧） */
  useScrollAnimation(range: ScrollAnimationRange): ScrollAnimationHandle
}

/** 钳制 0..1 */
function clamp01(p: number): number {
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

/**
 * 纯函数：动画属性线性插值（E23 底座——from + (to - from) × t，缺失侧从 0 插）
 * 用法：p=0 → from；p=1 → to；中间线性过渡
 */
export function interpolateAnimationProps(from: AnimationProps, to: AnimationProps, p: number): AnimationProps {
  const t = clamp01(p)
  const out: AnimationProps = {}
  const keys = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]))
  for (const key of keys) {
    const k = key as keyof AnimationProps
    const a = from[k]
    const b = to[k]
    const hasA = typeof a === 'number'
    const hasB = typeof b === 'number'
    if (!hasA && !hasB) continue
    const aNum = hasA ? (a as number) : 0
    const bNum = hasB ? (b as number) : 0
    out[k] = aNum + (bNum - aNum) * t
  }
  return out
}

/**
 * ★createAnimationEngineering：动画语义实例（注入式——reactivity + driver）
 * 用法：const ax = createAnimationEngineering({ reactivity: { ref, computed, watch }, driver })
 * 设计：E21-E23 为「语义面」——构建器/句柄产出 AnimationDescriptor，host 驱动（Web WAAPI / MP 宿主桥）
 *      负责实际播放；组件形态 E19/E20（p-transition/p-animate）为纯 CSS 声明，与 Hook 互补
 */
export function createAnimationEngineering(options: AnimationEngineeringOptions): AnimationEngineering {
  const { reactivity, driver } = options

  /** 内部构建器（E21 控制器 / E22 手势句柄共享） */
  function createBuilder(base: AnimationStepOptions = {}): AnimationController {
    const state = reactivity.ref<AnimationState>('idle')
    let current: AnimationProps = {}
    const steps: Array<{ props: AnimationProps; options: AnimationStepOptions }> = []
    let accDuration = 0

    function pushStep(props: AnimationProps, stepOpt?: AnimationStepOptions): void {
      const d = stepOpt && stepOpt.duration !== undefined ? stepOpt.duration : base.duration !== undefined ? base.duration : 300
      const delay = stepOpt && stepOpt.delay !== undefined ? stepOpt.delay : base.delay !== undefined ? base.delay : 0
      const easing = stepOpt && stepOpt.timingFunction !== undefined ? stepOpt.timingFunction : base.timingFunction !== undefined ? base.timingFunction : 'ease'
      steps.push({ props: { ...props }, options: { duration: d, delay, timingFunction: easing } })
      accDuration += d + delay
    }

    const controller: AnimationController = {
      set(props) {
        current = { ...current, ...props }
        return controller
      },
      step(stepOpt) {
        pushStep(current, stepOpt)
        current = {}
        return controller
      },
      reset() {
        current = {}
        steps.length = 0
        accDuration = 0
        state.value = 'idle'
        return controller
      },
      export() {
        const total = accDuration > 0 ? accDuration : 1
        const keyframes: AnimationKeyframe[] = []
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]
          const before = steps.slice(0, i).reduce((sum, s) => sum + (s.options.duration !== undefined ? s.options.duration : 300) + (s.options.delay !== undefined ? s.options.delay : 0), 0)
          const self = (step.options.duration !== undefined ? step.options.duration : 300) + (step.options.delay !== undefined ? step.options.delay : 0)
          const offset = i === steps.length - 1 ? 1 : clamp01((before + self) / total)
          keyframes.push({ offset, props: step.props, easing: step.options.timingFunction })
        }
        return {
          keyframes,
          duration: accDuration,
          timingFunction: base.timingFunction !== undefined ? base.timingFunction : 'ease',
          delay: base.delay !== undefined ? base.delay : 0,
          iterations: 1,
        }
      },
      play(target) {
        if (!driver) return undefined
        const run = driver.run(target, controller.export())
        state.value = 'running'
        run.onFinish(() => {
          state.value = 'finished'
        })
        return run
      },
      state,
    }
    return controller
  }

  return {
    useAnimation(options) {
      return createBuilder(options)
    },
    useGestureAnimation() {
      const builder = createBuilder({})
      const handle: GestureAnimationHandle = {
        apply(props) {
          builder.set(props)
        },
        commit(stepOpt) {
          builder.step(stepOpt)
        },
        reset() {
          builder.reset()
        },
        export() {
          return builder.export()
        },
        state: builder.state,
      }
      return handle
    },
    useScrollAnimation(range) {
      const state = reactivity.ref<AnimationProps>({ ...range.from })
      let progress = 0
      return {
        setProgress(p) {
          progress = clamp01(p)
          state.value = interpolateAnimationProps(range.from, range.to, progress)
        },
        value() {
          return state.value
        },
        export() {
          return {
            keyframes: [
              { offset: 0, props: { ...range.from } },
              { offset: 1, props: { ...range.to } },
            ],
            duration: 0,
            timingFunction: 'linear',
            delay: 0,
            iterations: 1,
          }
        },
      }
    },
  }
}