# 03 · 编译期平台分叉（M3）

## 目标

> **把“平台差异”在编译期消灭，而不是在运行时 if/else。**

---

## 1. 设计原则

- 源码统一
- 构建按平台输出
- 产物只包含当前平台 adapter
- 不允许运行时 `if (platform === 'mp')`

---

## 2. 文件命名约定（明确边界）

| 文件 | 含义 |
|------|------|
| `*.web.ts` | Web 实现 |
| `*.skyline.ts` | Skyline 实现 |
| `*.app.ts` | App 实现 |
| `*.platform.ts` | 高阶例外（需审批） |

---

## 3. Vite/Rollup 配置

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        web: 'src/platforms/web/entry.ts',
        skyline: 'src/platforms/skyline/entry.ts',
        app: 'src/platforms/app/entry.ts',
      },
    },
  },
})
```

---

## 4. 自动 Adapter 选择（编译期）

### 4.1 capability-manifest.json

```json
{
  "share": {
    "web": "share.web.ts",
    "skyline": "share.skyline.ts",
    "app": "share.app.ts",
    "fallback": "clipboard"
  }
}
```

### 4.2 编译替换

```ts
useCapability('share')
```

编译为：

```ts
// skyline
import share from './adapters/share.skyline'
```

```ts
// web
import share from './adapters/share.web'
```

> ✅ **业务代码不变，产物已分叉。**

---

## 5. Tree-shaking

- 未使用的 adapter 不进入 bundle
- `manualChunks` 按 capability 拆分
- Skyline 不支持的能力直接剔除

---

## 6. 类型收窄（关键）

```ts
// 编译期保证：当前平台不存在的能力 → 类型上不可用
declare module '@proteus/capabilities' {
  interface CapabilityMap {
    'share': ShareAPI | UnsupportedAPI
  }
}
```

业务代码中：

```ts
const share = useCapability('share')

if (!share.isSupported()) {
  // 此处 TS 收窄为 UnsupportedAPI
}
```

---

## 7. Skyline 额外约束

- 不支持的 API 在 `app.json` / capability-manifest 中标红
- CLI 输出“能力缺失报告”
- 编译期直接报错（可配置为 warning）

---

## 8. 验收

- [ ] 三端产物无交叉 adapter
- [ ] 未使用能力不打包
- [ ] 缺失能力编译期可见
- [ ] `--trace-capability` 可复现映射
