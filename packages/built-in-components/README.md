# @proteus-vue/built-in-components

**Proteus 框架内置组件**——以**微信小程序内置组件为基准**的跨端组件本体。

## 与扩展组件的区分（★拆包动机）

| | 内置组件（本包） | 扩展组件（`@proteus-vue/components`） |
|---|---|---|
| 基准 | 微信小程序内置组件（`view`/`text`/`button`/…） | 生态/业务 `p-*` 组件 |
| 控制方 | 框架（与编译管线/模板语义对齐） | 用户/生态 |
| 端实现 | Web：本包 Vue 实现（`proteus-*`）；Skyline：原生（`usingComponents` 自动解析）；App：v0.6 | 应用侧组件 |
| 类型契约 | `MpComponentSchema`（`@proteus-vue/types/mp`） | `defineProps` 自行声明 |

## 内容

- **13 个微信内置组件的 Vue 实现**：`view` / `text` / `button` / `input` / `image` / `scroll-view` / `textarea` / `switch` / `slider` / `icon` / `progress` / `navigator` / `picker`（`WebView`/`WebButton`/…）
- **install**：`installBuiltInComponents(app)` 注册 `proteus-*` 全局组件（Vue 编译器只 resolve 带连字符标签，故不能注册单字 `view`）
- **类型**：`global-components.ts`（GlobalComponents 声明）+ `schemas.ts`（与 `MpComponentSchema` 对照，防漂移）
- **开放能力**：`open-type` 降级事件（share/contact/… Web 端自定义处理）

## 使用

```ts
import { installBuiltInComponents } from '@proteus-vue/built-in-components'
import '@proteus-vue/built-in-components/style.css'

installBuiltInComponents(app)
// 模板里写小程序语义标签（Web 端映射 proteus-*；MP 端编译为原生标签）
```

> 通常经 `@proteus-vue/web` 的 `installWebPlatform`（本包 + wx API 模拟层聚合）安装。
