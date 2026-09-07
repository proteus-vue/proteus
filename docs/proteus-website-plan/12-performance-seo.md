# 性能与 SEO（Performance & SEO）

## 目标

官网作为**性能标杆**（dogfooding Build + Performance 实践），要求：
- Lighthouse 性能/SEO/可访问性 ≥ 95
- Core Web Vitals 全绿
- 首屏 < 2s（含 Playground WASM 懒加载）

## 渲染策略

| 页面 | 策略 | 理由 |
|------|------|------|
| 文档 / 博客 / Showcase | **SSG**（构建期预渲染） | 内容稳定，SEO 友好 |
| 首页 | SSG + 客户端水合 | Hero 静态 + 演示动态 |
| Playground | CSR | 纯交互，无需 SEO |
| 搜索 | CSR + 预取索引 | 客户端过滤 |

对齐 `build-plan`：Vite SSR + `vite-plugin-ssg` 或 Astro 静态生成（**决策见下**）。

## 技术选型建议

**文档站用 Astro 静态生成**（快 + SEO），**Playground + 交互部分用 Proteus SPA**。

理由：
- 文档 150+ 页纯静态，Astro 零 JS 默认输出，性能极致
- 但 Playground / 实时演示需要 SPA 交互 → 用 `@astrojs/compiler` 或 islands 架构嵌入 Proteus 组件
- **核心价值保留**：Playground 仍跑真实 Proteus Compiler（透明编译的实体化），只是壳换成 Astro

> 这是务实选择：文档站不是框架本身，用成熟工具保证 SEO，把"自研证明"留给 Playground 和 Blueprint。

## Core Web Vitals 预算

| 指标 | 预算 | 措施 |
|------|------|------|
| LCP | < 2.5s | 字体内联 + 首屏图预加载 + SSG |
| INP | < 200ms | 主线程不阻塞（Worker 跑 Compiler） |
| CLS | < 0.1 | 尺寸预留（图片/代码块占位） |
| TTFB | < 600ms | CDN + 静态托管 |

## 资源优化

- 字体：subset + `font-display: swap` + 内联 woff2
- 图片：AVIF/WebP + 响应式 `srcset` + 懒加载
- JS：路由懒加载 + 按需加载（Playground WASM 交互时才拉）
- CSS：关键 CSS 内联，其余异步

## 缓存

- 静态资源 `immutable` + hash 文件名
- CDN 边缘缓存（Vercel/Netlify）
- Service Worker（可选，离线看文档）—— 对齐 `build-plan` 缓存策略

## SEO

- 每页 `title` + `description` + `og:image`
- 结构化数据：Article（博客）/ SoftwareApplication（首页）/ Breadcrumb
- sitemap.xml + robots.txt
- 规范链接（避免 trailing slash 重复）
- 语义化 HTML（`nav` `main` `article` `aside`）

## 可访问性（a11y）

- WCAG 2.1 AA
- 键盘导航（Tab/Enter/Esc）
- 焦点管理（对话框/抽屉）
- 对比度达标
- **计入 Lighthouse SEO 综合分**

## 监控

- 真实用户数据（RUM）：CWV 上报（对齐 10-analytics TraceBus）
- CI 性能预算：`--max-assets-size` + Lighthouse CI（对齐 build-plan 体积预算）
- 超标阻断 PR

## 验收

- [ ] Lighthouse 四指标 ≥ 95
- [ ] CWV 真实用户数据全绿（75 分位）
- [ ] 首屏无 FOUC / 布局偏移
- [ ] `sitemap.xml` 收录全部文档
- [ ] 构建体积预算不超标（CI 门禁）

## 依赖

- `build-plan`（SSG + 缓存 + 体积预算 + CI）
- `08-design-system.md`（尺寸预留 / 语义 HTML）
- `09-search-i18n.md`（locale URL + hreflang）
- `10-analytics-feedback.md`（RUM 上报）
- `05-playground.md`（WASM 懒加载）
