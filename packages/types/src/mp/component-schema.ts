// packages/types/src/mp/component-schema.ts
// ★types-plus-plan B8（§9）：WXML 组件属性 Schema（Proteus 自建注册表）
// 职责划分：官方 d.ts 不覆盖 .wxml 标签属性 → 归 Proteus Compiler 自建 schema，并对齐 p-* 映射。
// 单一来源：与官方组件文档元数据同步；新增组件走注册表扩展（§10：支持声明合并/用户扩展）。
// 零依赖（不 import 官方包）——组件库/Compiler 模板校验可直接消费本模块。

/** 单个 WXML 内置组件的属性定义（源自官方文档组件元数据） */
export interface MpComponentProp {
  /** WXML 属性名（kebab-case，如 'scroll-x'；事件为 'bindscrolltolower'） */
  name: string
  type: 'string' | 'number' | 'boolean' | 'event' | 'enum'
  required?: boolean
  /** type='enum' 时的合法取值 */
  enumValues?: readonly string[]
  /** 映射到 Proteus 通用属性名（对齐 Component plan 的 p-* 语义） */
  alias?: string
}

export interface MpComponentSchema {
  /** 小程序原生标签名，如 'scroll-view' */
  tag: string
  /** 属性表：key 为 camelCase（模板/语义层使用），value 携带 WXML 名 */
  props: Record<string, MpComponentProp>
  /** 对应的 Proteus 通用组件，如 'p-scroll-list' */
  proteusAlias?: string
}

/**
 * 全局组件属性注册表（Compiler 校验 SFC 模板时查这张表；业务可扩展）
 * —— 单一来源，与官方文档元数据同步；新增组件走 registerComponentSchema
 */
export interface MpComponentRegistry {
  [tag: string]: MpComponentSchema
}

/** 内置注册表必须覆盖的标签（防漂移：新增内置组件时若漏登记 → 编译报错） */
const REQUIRED_TAGS = [
  'view',
  'text',
  'image',
  'button',
  'input',
  'textarea',
  'scroll-view',
  'picker',
  'switch',
  'slider',
  'icon',
  'progress',
  'navigator',
  'video',
  'rich-text',
  'checkbox',
  'radio',
  'form',
  'swiper',
  'canvas',
  'slot',
] as const

/** 内置组件 schema 汇总（starter 集：覆盖 Compiler TAG_MAP 发射标签 + 示例工程在用原生标签） */
export const mpComponentRegistry: MpComponentRegistry &
  Record<(typeof REQUIRED_TAGS)[number], MpComponentSchema> = {
  view: {
    tag: 'view',
    props: {
      hoverClass: { name: 'hover-class', type: 'string' },
      hoverStopPropagation: { name: 'hover-stop-propagation', type: 'boolean' },
      hoverStartTime: { name: 'hover-start-time', type: 'number' },
      hoverStayTime: { name: 'hover-stay-time', type: 'number' },
      onTap: { name: 'bindtap', type: 'event' },
      onTouchStart: { name: 'bindtouchstart', type: 'event' },
      onTouchMove: { name: 'bindtouchmove', type: 'event' },
    },
    proteusAlias: 'p-view',
  },
  text: {
    tag: 'text',
    props: {
      selectable: { name: 'selectable', type: 'boolean' },
      space: { name: 'space', type: 'enum', enumValues: ['ensp', 'emsp', 'nbsp'] },
      decode: { name: 'decode', type: 'boolean' },
      userSelect: { name: 'user-select', type: 'boolean' },
    },
    proteusAlias: 'p-text',
  },
  image: {
    tag: 'image',
    props: {
      src: { name: 'src', type: 'string' },
      mode: { name: 'mode', type: 'enum', enumValues: ['scaleToFill', 'aspectFit', 'aspectFill', 'widthFix', 'heightFix', 'top', 'bottom', 'center', 'left', 'right'] },
      lazyLoad: { name: 'lazy-load', type: 'boolean' },
      showMenuByLongpress: { name: 'show-menu-by-longpress', type: 'boolean' },
      onError: { name: 'binderror', type: 'event' },
      onLoad: { name: 'bindload', type: 'event' },
    },
    proteusAlias: 'p-image',
  },
  button: {
    tag: 'button',
    props: {
      size: { name: 'size', type: 'enum', enumValues: ['default', 'mini'] },
      type: { name: 'type', type: 'enum', enumValues: ['primary', 'default', 'warn'] },
      plain: { name: 'plain', type: 'boolean' },
      disabled: { name: 'disabled', type: 'boolean' },
      loading: { name: 'loading', type: 'boolean' },
      formType: { name: 'form-type', type: 'enum', enumValues: ['submit', 'reset'] },
      openType: { name: 'open-type', type: 'enum', enumValues: ['contact', 'share', 'getUserInfo', 'getPhoneNumber', 'launchApp', 'openSetting', 'feedback'] },
      hoverClass: { name: 'hover-class', type: 'string' },
      onTap: { name: 'bindtap', type: 'event' },
      onGetUserInfo: { name: 'bindgetuserinfo', type: 'event' },
    },
    proteusAlias: 'p-button',
  },
  input: {
    tag: 'input',
    props: {
      value: { name: 'value', type: 'string' },
      type: { name: 'type', type: 'enum', enumValues: ['text', 'number', 'idcard', 'digit', 'safe-password', 'nickname'] },
      password: { name: 'password', type: 'boolean' },
      placeholder: { name: 'placeholder', type: 'string' },
      placeholderClass: { name: 'placeholder-class', type: 'string' },
      disabled: { name: 'disabled', type: 'boolean' },
      maxlength: { name: 'maxlength', type: 'number' },
      focus: { name: 'focus', type: 'boolean' },
      confirmType: { name: 'confirm-type', type: 'enum', enumValues: ['send', 'search', 'next', 'go', 'done'] },
      onInput: { name: 'bindinput', type: 'event' },
      onConfirm: { name: 'bindconfirm', type: 'event' },
      onFocus: { name: 'bindfocus', type: 'event' },
      onBlur: { name: 'bindblur', type: 'event' },
    },
    proteusAlias: 'p-input',
  },
  textarea: {
    tag: 'textarea',
    props: {
      value: { name: 'value', type: 'string' },
      placeholder: { name: 'placeholder', type: 'string' },
      disabled: { name: 'disabled', type: 'boolean' },
      maxlength: { name: 'maxlength', type: 'number' },
      autoHeight: { name: 'auto-height', type: 'boolean' },
      focus: { name: 'focus', type: 'boolean' },
      onInput: { name: 'bindinput', type: 'event' },
      onConfirm: { name: 'bindconfirm', type: 'event' },
      onFocus: { name: 'bindfocus', type: 'event' },
      onBlur: { name: 'bindblur', type: 'event' },
    },
  },
  'scroll-view': {
    tag: 'scroll-view',
    props: {
      scrollX: { name: 'scroll-x', type: 'boolean' },
      scrollY: { name: 'scroll-y', type: 'boolean' },
      scrollTop: { name: 'scroll-top', type: 'number' },
      scrollLeft: { name: 'scroll-left', type: 'number' },
      scrollIntoView: { name: 'scroll-into-view', type: 'string' },
      scrollWithAnimation: { name: 'scroll-with-animation', type: 'boolean' },
      refresherEnabled: { name: 'refresher-enabled', type: 'boolean' },
      onScroll: { name: 'bindscroll', type: 'event' },
      onScrollToLower: { name: 'bindscrolltolower', type: 'event' },
      onScrollToUpper: { name: 'bindscrolltoupper', type: 'event' },
      onRefresherRefresh: { name: 'bindrefresherrefresh', type: 'event' },
    },
    proteusAlias: 'p-scroll-list',
  },
  picker: {
    tag: 'picker',
    props: {
      mode: { name: 'mode', type: 'enum', enumValues: ['selector', 'multiSelector', 'time', 'date', 'region'] },
      range: { name: 'range', type: 'string' },
      value: { name: 'value', type: 'string' },
      disabled: { name: 'disabled', type: 'boolean' },
      onChange: { name: 'bindchange', type: 'event' },
      onColumnChange: { name: 'bindcolumnchange', type: 'event' },
      onCancel: { name: 'bindcancel', type: 'event' },
    },
    proteusAlias: 'p-picker',
  },
  switch: {
    tag: 'switch',
    props: {
      checked: { name: 'checked', type: 'boolean' },
      disabled: { name: 'disabled', type: 'boolean' },
      color: { name: 'color', type: 'string' },
      type: { name: 'type', type: 'enum', enumValues: ['switch', 'checkbox'] },
      onChange: { name: 'bindchange', type: 'event' },
    },
    proteusAlias: 'p-switch',
  },
  slider: {
    tag: 'slider',
    props: {
      min: { name: 'min', type: 'number' },
      max: { name: 'max', type: 'number' },
      step: { name: 'step', type: 'number' },
      value: { name: 'value', type: 'number' },
      disabled: { name: 'disabled', type: 'boolean' },
      activeColor: { name: 'active-color', type: 'string' },
      backgroundColor: { name: 'background-color', type: 'string' },
      showValue: { name: 'show-value', type: 'boolean' },
      onChange: { name: 'bindchange', type: 'event' },
      onChanging: { name: 'bindchanging', type: 'event' },
    },
    proteusAlias: 'p-slider',
  },
  icon: {
    tag: 'icon',
    props: {
      type: {
        name: 'type',
        type: 'enum',
        enumValues: ['success', 'success_no_circle', 'info', 'warn', 'waiting', 'cancel', 'download', 'search', 'clear'],
      },
      size: { name: 'size', type: 'number' },
      color: { name: 'color', type: 'string' },
    },
    proteusAlias: 'p-icon',
  },
  progress: {
    tag: 'progress',
    props: {
      percent: { name: 'percent', type: 'number' },
      showInfo: { name: 'show-info', type: 'boolean' },
      strokeWidth: { name: 'stroke-width', type: 'number' },
      color: { name: 'color', type: 'string' },
      active: { name: 'active', type: 'boolean' },
      activeMode: { name: 'active-mode', type: 'enum', enumValues: ['backwards', 'forwards'] },
      borderRadius: { name: 'border-radius', type: 'number' },
      onActiveEnd: { name: 'bindactiveend', type: 'event' },
    },
  },
  navigator: {
    tag: 'navigator',
    props: {
      url: { name: 'url', type: 'string' },
      openType: { name: 'open-type', type: 'enum', enumValues: ['navigate', 'redirect', 'switchTab', 'reLaunch', 'navigateBack', 'exit'] },
      hoverClass: { name: 'hover-class', type: 'string' },
      target: { name: 'target', type: 'enum', enumValues: ['self', 'miniProgram'] },
      onTap: { name: 'bindtap', type: 'event' },
    },
  },
  video: {
    tag: 'video',
    props: {
      src: { name: 'src', type: 'string' },
      controls: { name: 'controls', type: 'boolean' },
      autoplay: { name: 'autoplay', type: 'boolean' },
      loop: { name: 'loop', type: 'boolean' },
      muted: { name: 'muted', type: 'boolean' },
      poster: { name: 'poster', type: 'string' },
      onPlay: { name: 'bindplay', type: 'event' },
      onPause: { name: 'bindpause', type: 'event' },
      onEnded: { name: 'bindended', type: 'event' },
      onError: { name: 'binderror', type: 'event' },
    },
  },
  'rich-text': {
    tag: 'rich-text',
    props: {
      nodes: { name: 'nodes', type: 'string' },
      space: { name: 'space', type: 'enum', enumValues: ['ensp', 'emsp', 'nbsp'] },
      userSelect: { name: 'user-select', type: 'boolean' },
    },
  },
  checkbox: {
    tag: 'checkbox',
    props: {
      value: { name: 'value', type: 'string' },
      checked: { name: 'checked', type: 'boolean' },
      disabled: { name: 'disabled', type: 'boolean' },
      color: { name: 'color', type: 'string' },
    },
  },
  radio: {
    tag: 'radio',
    props: {
      value: { name: 'value', type: 'string' },
      checked: { name: 'checked', type: 'boolean' },
      disabled: { name: 'disabled', type: 'boolean' },
      color: { name: 'color', type: 'string' },
    },
  },
  form: {
    tag: 'form',
    props: {
      onSubmit: { name: 'bindsubmit', type: 'event' },
      onReset: { name: 'bindreset', type: 'event' },
    },
  },
  swiper: {
    tag: 'swiper',
    props: {
      indicatorDots: { name: 'indicator-dots', type: 'boolean' },
      autoplay: { name: 'autoplay', type: 'boolean' },
      current: { name: 'current', type: 'number' },
      interval: { name: 'interval', type: 'number' },
      duration: { name: 'duration', type: 'number' },
      circular: { name: 'circular', type: 'boolean' },
      vertical: { name: 'vertical', type: 'boolean' },
      displayMultipleItems: { name: 'display-multiple-items', type: 'number' },
      onChange: { name: 'bindchange', type: 'event' },
      onTransition: { name: 'bindtransition', type: 'event' },
      onAnimationFinish: { name: 'bindanimationfinish', type: 'event' },
    },
  },
  canvas: {
    tag: 'canvas',
    props: {
      canvasId: { name: 'canvas-id', type: 'string' },
      type: { name: 'type', type: 'string' },
      id: { name: 'id', type: 'string' },
    },
  },
  slot: {
    tag: 'slot',
    props: {
      name: { name: 'name', type: 'string' },
    },
  },
}

/** 内置注册表必须覆盖的标签（防漂移：新增内置组件时若漏登记 → 编译报错） */
/** 查表：取标签 schema（未知标签返回 undefined） */
export function getComponentSchema(tag: string): MpComponentSchema | undefined {
  return mpComponentRegistry[tag]
}

/** 注册/覆盖组件 schema（§10：业务/组件库扩展入口，覆盖需显式） */
export function registerComponentSchema(schema: MpComponentSchema): void {
  mpComponentRegistry[schema.tag] = schema
}
