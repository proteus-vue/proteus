---
title: 组件样式与插槽
order: 18
group: 组件框架
---

# 组件样式与插槽

## 样式作用域

小程序端 WXSS 没有样式隔离——Proteus 在编译层解决：

| 写法 | 行为 |
|---|---|
| `<style>`（无标记） | **默认按 scoped 处理**（类名后缀拼接）；无标记时编译期警告 |
| `<style scoped>` | 显式局部作用域 |
| `<style global>` | **Proteus 扩展**：显式全局（不作用域化）；同文件 scoped+global 分组输出（global 在前） |

> 为什么默认 scoped：Vue 标准 `<style>` 是全局的——真机实测过无 scoped 的背景色串到其他页面（用户决策，2026-08）。跨端一致：Web 端 vite 插件同步改写 `<style> → <style scoped>`。

**已知约束**：scoped 样式无法触达 slot 子元素——全局规则按容器类切换是唯一简洁路径（`<style global>` 的典型用途，见 p-grid 降级 `.p-grid-fallback > *`）。

## 插槽

`slot` 编译规则（`slot/scoped-slot`）把标准 Vue 插槽映射为小程序插槽语法：

- 默认插槽直通（p-view 的 `<slot />` 在双端语义一致）
- 具名插槽 / scoped slot 按编译规则映射
- **已知约束**：scoped 样式触达 slot 子元素受限（见上）

## 组件属性

- props 用**对象形式 defineProps**（编译器静态提取；数组形式不支持）
- MP 端 props 类型映射为 component.json properties
- 传复杂对象/函数 props 时注意 MP 端边界（规则清单 `npx proteus rules` 有逐条说明）

## 下一步

- [语义模型](/docs/framework/11-semantic-model)：组件背后的 IR 契约
