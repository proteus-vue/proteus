# 三端启动性能优化

> 对齐：`02-strategy.md` §4、`proteus-architecture`
> 原则：**共享 SFC，各走平台最强启动路径**

---

## 1. 总览

| 端 | 启动瓶颈 | 优化策略 | 目标首帧 |
|----|---------|---------|---------|
| **Web** | JS bundle 解析 + 首屏渲染 | 流式 SSR + 组件懒加载 + Vite 预构建 | **<1.5s (FCP)** |
| **小程序 Skyline** | 初始化 + setData | 分包预下载 + 首屏静态 WXML + 按需注入 | **<1.0s** |
| **App** | JSI 绑定 + Vue 启动 | **AOT + IFR (§3-4)** | **<200ms** |

---

## 2. Web 端

### 2.1 流式 SSR

```ts
// Server (Node/Bun)
import { renderToStream } from 'vue/server'
app.use('/', async (req, res) => {
  const stream = renderToStream(App)
  stream.pipe(res)  // 流式输出 HTML, 首屏优先
})
```

### 2.2 组件级懒加载

```vue
<Suspense>
  <LazyComponent v-if="visible" />
</Suspense>

<script setup>
const LazyComponent = defineAsyncComponent(() =>
  import('./HeavyComponent.vue')
)
</script>
```

### 2.3 Vite 预构建

```ts
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['vue', '@proteus-vue/runtime'] }
      }
    }
  },
  optimizeDeps: { include: ['lodash-es'] }  // 预构建冷启动
}
```

---

## 3. 小程序 Skyline 端

对齐微信官方 Skyline 性能最佳实践：

### 3.1 分包预下载

```json
// app.json
{
  "preloadRule": {
    "pages/home": {
      "network": "all",
      "packages": ["pkgA"]  // 进入首页即预下载
    }
  }
}
```

### 3.2 首屏静态 WXML

```html
<!-- 首屏用静态 WXML + 数据占位, 避免首次 setData 大数据 -->
<view class="skeleton">...</view>
```

### 3.3 按需注入

```json
{
  "lazyCodeLoading": "requiredComponents"  // 仅注入用到的组件
}
```

### 3.4 Skyline 特性利用

- `backdrop-filter` (Glass L1) ✅
- Worklet 动画 (对齐 `05-worklet.md`) ✅
- 自定义组件 + `reuse-id` 复用节点 ✅

---

## 4. App 端

详见 `03-aot-codegen.md` + `04-ifr-static-first-frame.md`：

- **AOT 预编译**：模板编译期固化 → 运行时 <5ms
- **IFR 静态首帧**：绕过 Vue，AOT 直出 <200ms
- **JSI 预热**：启动期分摊引擎 + binding 初始化
- **Worklet 隔离**：手势/动画 UI 线程直落 Native

---

## 5. 统一性能预算（`proteus audit performance`）

```bash
proteus audit performance --all
# 输出三端启动指标 + 对比预算
```

| 指标 | Web | Skyline | App |
|------|-----|---------|-----|
| FCP / 首帧 | <1.5s | <1.0s | **<200ms** |
| TTI | <3.0s | <2.0s | <300ms |
| 长列表 fps | ≥55 | ≥58 | ≥58 |
| 包体积 | <200KB(gzip) | <2MB | <10MB |

---

## 6. 验收

- [ ] 三端均接入 `proteus audit performance`
- [ ] CI 门禁：任一端超预算 → 阻断 PR
- [ ] Blueprint 150 页包含三端启动性能验证路径
