# 构建 · 性能 · SEO（M4 + M5）

## 目标

官网是框架的**性能门面**，必须 dogfooding Build plan + Performance 实践，达到：
- 文档站 LCP < 2s、TTI < 1.5s、CWV 全绿
- SEO 满分（sitemap / structured-data / SSG）
- Skyline 小程序版可访问、可分享
- 所有指标可复现、可审计（对齐 `--trace-transform` 精神）

## 技术选型（务实决定）

**文档站用 Astro 静态生成，Playground 与交互部分用 Proteus SPA（islands 架构嵌入）。**

理由：
- 150+ 页文档纯静态 → Astro 默认零 JS，SSG 极致快、SEO 原生友好
- Playground / 实时演示需 SPA 交互 → 用 `@astrojs/compiler` 或 islands 嵌入 Proteus 组件
- **自研证明不丢**：Playground 仍跑真实 Proteus Compiler（透明编译实体化），只是壳用成熟工具保证 SEO

## M4 构建流水线

### 1. 阶段（对齐 build-plan）
```
MD/MDC ──parse──→ AST/JSON ──render──→ HTML ──optimize──→ dist/
                                      └──emit──→ llms.txt
```

- `docs-loader`：frontmatter + AST + 提取 code/组件调用
- `api-codegen`：`.d.ts` → reference JSON（types-plan 03）
- `llms-gen`：每个 `.md` → 结构化 JSON + 汇总 `llms-full.txt`

### 2. SSG 策略（对齐 12-performance-seo）
| 页面 | 策略 | 理由 |
|------|------|------|
| 文档 / 博客 / Showcase | **SSG** | 内容稳定、SEO 友好 |
| 首页 | SSG + 水合 | Hero 静态 + 演示动态 |
| Playground | CSR | 纯交互、无需 SEO |
| 搜索 | CSR + 预取索引 | 客户端过滤 |

### 3. 产物结构
```
dist/
  index.html
  docs/guide/...html
  reference/...html
  playground/index.html
  showcase/index.html
  assets/*.js|css|woff2
  llms.txt / llms-full.txt
  sitemap.xml / robots.txt
```

### 4. CI（build-plan 矩阵）
```
lint → typecheck → unit → contract(docs/api) → e2e-web → e2e-mp → a11y → deploy
```
- 文档契约测试**阻断发布**（内容错误 = 阻塞）
- 体积预算：`maxAssetsSize` + Lighthouse CI（超标阻断 PR）

## M5 性能

### Core Web Vitals 预算
| 指标 | 预算 | 措施 |
|------|------|------|
| LCP | < 2.5s | 字体内联 + 首屏图预加载 + SSG |
| INP | < 200ms | Worker 跑 Compiler（不阻塞主线程） |
| CLS | < 0.1 | 图片/代码块尺寸预留 |
| TTFB | < 600ms | CDN + 静态托管 |

### 优化手段
- 字体：subset + `font-display: swap` + 内联 woff2
- 图片：AVIF/WebP + `srcset` + 懒加载
- JS：路由懒加载；**Playground WASM 交互时才拉**（首屏不加载）
- CSS：关键 CSS 内联，其余异步
- 缓存：`immutable` + hash 文件名 + CDN 边缘 + 可选 SW（离线看文档）

### 渲染约束（Skyline 对齐）
- 长文档虚拟滚动（component-plan `p-list-view`）
- 图片懒加载 + 纹理压缩
- `disableScroll:true` + `scroll-view` 包内容（router-plan 全局滚动约束）

## SEO
- 每页 `title` / `description` / `og:image`
- 结构化数据：Article（博客）/ SoftwareApplication（首页）/ Breadcrumb
- `sitemap.xml` + `robots.txt` + canonical
- `hreflang`（对齐 i18n locale）
- 语义化 HTML（`nav`/`main`/`article`/`aside`）

## 验收
- [ ] Lighthouse 性能/SEO/a11y ≥ 95
- [ ] CWV 真实用户数据全绿（75 分位）
- [ ] SSG 150 页构建 < 60s（增量 < 5s）
- [ ] 首屏无 FOUC / 布局偏移
- [ ] `sitemap.xml` 收录全部页
- [ ] 小程序分享卡片正确跳转

## 依赖
- build-plan（SSG / 缓存 / 体积预算 / CI）
- 08 设计系统（尺寸预留 / 语义 HTML）
- 09 search-i18n（locale URL + hreflang）
- 10 analytics（RUM CWV 上报）
- 05 playground（WASM 懒加载）
- 11 mp-version（小程序渲染约束）
