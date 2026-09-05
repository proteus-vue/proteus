---
title: 运行与预览
order: 6
group: 开始
---

# 运行与预览

## 跑通 Web 端

```bash
npm run dev:web
```

浏览器打开 Vite 提示的地址（默认 `http://localhost:5173`），看到首页即成功。

Web 端就是标准 Vite SPA：**零转换**，Vue devtools、HMR、按路由 code-split 全部可用。

## 跑通小程序端

```bash
npm run build:mp
```

产物在 `dist/mp-weixin/`：`app.js` / `app.json` / `app.wxss` + `pages/`（每页 wxml / wxss / js / json 四件套，配置了 subPackages 时还有 `subpackages/`）。

然后在微信开发者工具：

1. 「导入项目」→ 目录选择 `dist/mp-weixin/`
2. AppID 填入 `proteus.config.ts` 中的真实 AppID（模板默认占位 `wx0000000000`，使用前必须替换）
3. 「详情 → 本地设置」勾选「调试基础库」并选择 ≥ 2.29.2
4. Skyline 所需字段无需手配：`app.json` 的 `lazyCodeLoading`、各页 `page.json` 的 `"renderer": "skyline"` 均由 gen-routes 自动生成

看到脚手架首页在模拟器里渲染出来，双端就都跑通了。

## 下一步

- [页面构成](/docs/09-page-anatomy)：读懂首页 SFC 的每一部分
- [构建与发布](/docs/07-build-release)：正式构建与全部命令速查
