---
title: "G-19 DevTools 方案修订：接入 Vue DevTools"
---

# G-19 DevTools 方案修订

## 新增架构选型：复用 Vue DevTools

原方案中「原生视图检查器」为抽象描述，现明确为：

> **Proteus DevTools 采用「Vue DevTools 前端复用 + 自研 Backend 适配」策略：**
> - **Web target**：直接复用 Vue DevTools 浏览器扩展，Components / Timeline 原生可用；
>   Proteus 通过 `@vue/devtools-api` 注册 `proteus-native-tree` / `proteus-jsi` /
>   `proteus-style-safety` / `proteus-app-config` 四个自定义 inspector 补充原生层数据。
> - **App / Skyline target**：复用 Vue DevTools **Frontend**（Electron shell 或嵌入小程序开发者工具），
>   自研 Backend 通过 WS Bridge 把 IR 树 / JSI 调用 / Style Safety 事件 / 安全区实参推给前端，
>   编辑回写经 JSI 下发。
> - **不 fork Vue DevTools 源码**，只依赖 `@vue/devtools-api` 公共 API（保证 Vue 大版本升级不碎）。

## 修订对照

| 原方案 | 修订后 |
|--------|--------|
| 原生视图检查器（抽象） | `proteus-native-tree` 自定义 Inspector（具体、可落地） |
| 未明确前端复用 | 明确复用 Vue DevTools Frontend |
| 未明确协议 | WS Bridge + devtools-api event 名 |
| 单向查看 | 双向：`editInspectorState` → JSI 下发 |

## 对 G-19 现有文档的改动点

- 主文档（`01-devtools.md`）「原生视图检查器」章节 → 替换为第 3 节四个 Inspector 定义
- `03-runtime-inspector.md` → 明确为 `proteus-native-tree` 数据契约（`getNativeTree()` / `getNodeState()`）
- `06-integration-devtools.md` → 新增「与 Vue DevTools 协议对接」一节
- 新增严格规则 DEV001/002/003（见主文档第 8 节）

## 依赖

- Vue DevTools 6+（`@vue/devtools-api`）
- G-16 Style Safety（拦截记录数据源）
- G-20 App Config（当前值数据源）
- G-21 Compiler Plugin（DevTools 后端作为插件，开发模式注入）
