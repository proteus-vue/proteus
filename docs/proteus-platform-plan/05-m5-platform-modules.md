# 05 · 平台原生模块规范（M5）

## 目标

> **平台原生能力只能出现在指定目录，且必须遵循统一适配器模式。**

---

## 1. 目录结构

```
src/
  capabilities/          # 能力定义（平台无关）
    share.capability.ts
    login.capability.ts

  adapters/              # 平台实现
    share.web.ts
    share.skyline.ts
    share.app.ts

  platforms/             # 平台入口
    web/
    skyline/
    app/

  shared/                # 共享类型/工具
```

---

## 2. 一个完整能力示例：Clipboard

### 2.1 能力定义

```ts
// capabilities/clipboard.capability.ts
export default defineCapability({
  id: 'clipboard',
  tier: 1,
  adapters: {
    web: () => import('./adapters/clipboard.web'),
    skyline: () => import('./adapters/clipboard.skyline'),
    app: () => import('./adapters/clipboard.app'),
  },
})
```

### 2.2 Web Adapter

```ts
export default defineAdapter({
  capability: 'clipboard',
  platform: 'web',
  isSupported: () => typeof navigator.clipboard !== 'undefined',
  create: () => ({
    copy(text: string) {
      return navigator.clipboard.writeText(text)
    },
  }),
})
```

### 2.3 Skyline Adapter

```ts
export default defineAdapter({
  capability: 'clipboard',
  platform: 'skyline',
  isSupported: () => wx.canIUse('setClipboardData'),
  create: () => ({
    copy(text: string) {
      return new Promise((resolve, reject) => {
        wx.setClipboardData({
          data: text,
          success: resolve,
          fail: reject,
        })
      })
    },
  }),
})
```

---

## 3. 平台模块规范

每个平台目录必须包含：

- `entry.ts`：注册所有 adapter
- `runtime.ts`：平台初始化（如 `wx` 探测）
- `globals.d.ts`：平台全局类型

---

## 4. Skyline 特殊规则

- 禁止在模块顶层调用 `wx.*`
- 权限类 API 必须延迟到 `isSupported`
- 涉及 UI 的能力需标注线程模型（main / worklet）

---

## 5. 新平台接入流程

1. 创建 `platforms/<name>/`
2. 实现所需 adapter
3. 注册到 Registry
4. 补充 capability-manifest
5. 添加回归用例

> ✅ **业务代码无需修改。**

---

## 6. 禁止清单（硬规则）

- ❌ `if (platform === 'skyline')`
- ❌ 在 `src/pages/**` 使用 `wx.*`
- ❌ Adapter 内直接写业务 UI
- ❌ 动态拼接平台字符串

---

## 7. 验收

- [ ] 所有 `wx.*` 位于 `platforms/skyline`
- [ ] 所有 `window.*` 位于 `platforms/web`
- [ ] 新平台可接入且不改业务
- [ ] CLI 静态检查通过
