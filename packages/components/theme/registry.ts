// src/components/theme/registry.ts —— 框架主题皮肤注册表（单一事实源）
//
// 定位：跨端「主题皮肤包」的**语义层**。与小程序的 `theme.json` darkmode（仅 light/dark、App 级）
// 不同，这里定义的是**任意命名的本地皮肤**（brand/success/danger/ghost…），供组件通过 `theme` 属性消费。
//
// ★为什么需要编译器通道（不是纯 CSS 皮肤包）：
//   微信自定义组件默认 styleIsolation: apply-shared，但**页面 wxss 无法可靠作用于组件内部**——
//   纯 CSS 皮肤包从「外面往里推」会被样式隔离挡住（真机实测：<p-view class="box"> 外层样式失效，
//   即使 apply-shared）。因此主题必须**在组件自己的 wxss 内定义**，由编译器把 theme 值落成
//   组件根节点上的**单类变体**（.p-button--brand-<scopeId>），一切发生在组件边界内 → 隔离不相关。
//
// ★Skyline 约束：glass-easel **不支持复合类选择器 `.a.b`**（真机实测：组件自身 wxss 匹配自身根节点
//   都失效）。故变体一律**单类选择器**，且只**重定义局部 CSS 变量**（--p-button-bg/color/border）——
//   基类已经消费这些变量，变体无需重复声明属性，天然兼容现有变量换肤路径。
//
// ★与组件的关系：本表是「主题键 + 缺省色值」的 SSOT；每个组件在自己的 <style scoped> 里为
//   自己支持的皮肤写单类变体规则。`tests/component-theme.test.ts` 锁「注册表 ↔ 组件变体 CSS」一致，
//   防止漂移。后续泛化到全组件集时，可由编译器按本表生成各组件变体样式（本文件即其输入）。

/** 一套主题皮肤：键 + 缺省色值（组件可选择性消费） */
export interface ThemeSkin {
  /** 主题键：编译期落成单类变体，如 `brand` → `.p-button--brand` */
  key: string
  /** 中文显示名（演示/文档用） */
  label: string
  /** 缺省背景色（映射到组件的 --p-<component>-bg） */
  bg: string
  /** 缺省前景色（映射到组件的 --p-<component>-color） */
  color: string
  /** 可选边框（ghost/outline 类皮肤用） */
  border?: string
}

/** 框架内置主题皮肤（★新增皮肤请同步组件变体 CSS + 一致性测试） */
export const THEME_SKINS: Record<string, ThemeSkin> = {
  brand: { key: 'brand', label: '品牌紫', bg: '#7c5cff', color: '#ffffff' },
  success: { key: 'success', label: '成功绿', bg: '#22b573', color: '#ffffff' },
  danger: { key: 'danger', label: '危险红', bg: '#ef4d4d', color: '#ffffff' },
  ghost: { key: 'ghost', label: '幽灵（描边）', bg: 'transparent', color: '#7c5cff', border: '1px solid #7c5cff' },
}

/** 主题键联合类型（供 TS 使用方类型提示；MP 端 defineProps 需运行时声明故用 string） */
export type ThemeName = keyof typeof THEME_SKINS

/** 全部主题键（顺序稳定，供演示页遍历） */
export const THEME_NAMES = Object.keys(THEME_SKINS) as ThemeName[]

/** 生成组件的主题变体类名（编译期静态可达——勿在模板里动态拼接，见组件模板注释） */
export function themeClass(skin: ThemeName): string {
  return `p-theme--${skin}`
}
