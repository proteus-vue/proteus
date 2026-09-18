# 搜索与国际化（Search & i18n）

## 搜索

### 索引构建
- 构建期扫描所有 Markdown → `search-index.json`
  - 标题 + 标题层级 + 摘要 + 代码块标题
- 客户端 Fuse.js 模糊搜索
- **首屏不加载索引**，用户聚焦搜索框时才懒加载

### 体验
- 快捷键（`Cmd+K` 唤起）
- 结果分组：指南 / API / 博客 / Playground preset
- 按 plan 过滤（对齐 router-plan 模块划分）
- 支持模糊容错（`creatApp` → `createApp`）

### 来源
- 对齐 `02-docs-system.md` 的搜索索引生成
- 搜索框组件：`p-search`（08 设计系统）

## 国际化（i18n）

### 语言包组织
```
content/
  docs/
    en/
    zh-CN/
    zh-TW/
  blog/...
i18n/
  en.json
  zh-CN.json
  zh-TW.json
```

### 实现（复用 i18n-plan）

- **语言包按 domain 分包**（对齐 i18n-plan M2）：导航/指南/API/博客各自独立 chunk
- Skyline 用 `loadSubPackage` 按需加载语言包
- App 端走 Native bundle

### 切换器
- `p-locale-switcher`（08）：写入 `localStorage` + URL prefix（`/zh-CN/docs/...`）
- 首屏根据 `Accept-Language` + 存储值自动选

### RTL 支持
- 阿拉伯语等：`<html dir="rtl">` + CSS `margin-inline-start` 替代 `margin-left`
- 对齐 i18n-plan M4：RTL 一等公民
- 设计系统所有组件支持 RTL（08 审计项）

### 未翻译检测
- 构建期对比各语言文件 key 覆盖率
- 缺失段落标记 `🚧 翻译进行中` + 回退英文
- `proteus audit i18n`（对齐 i18n-plan M8）：missing / unused / hardcoded / dynamic key

### llms 多语言
- 每种语言生成独立 `llms.txt`
- `llms-full.txt` 含语言标记

## 性能

- 中文/英文索引分开打包，按需加载
- 搜索 Worker 化（不阻塞主线程）
- 语言包懒加载（默认只加载浏览器首选）

## 验收

- [ ] 中文/英文文档全覆盖（≥95%）
- [ ] 切换语言 URL 正确 + 页面对应
- [ ] RTL 页面布局无破损（Lighthouse 检查）
- [ ] `proteus audit i18n` 零违规
- [ ] 搜索在 1000+ 页下响应 < 200ms

## 依赖

- `i18n-plan`（语言包分包 + audit + RTL）
- `02-docs-system.md`（索引 + frontmatter locale）
- `08-design-system.md`（`p-search` / `p-locale-switcher` / RTL）
- `11-mp-version.md`（小程序端 i18n 对齐）
