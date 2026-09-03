---
title: 测试与部署
order: 10
---

# 测试与部署

## 测试即架构（G-44）

Proteus 的验证体系不是"写点单测"，而是**分层 conformance**：

| 套件 | 覆盖 | 规模 |
|------|------|------|
| Render conformance | 后端渲染语义一致（RND002） | 42 项 |
| Compiler conformance | 编译器语义等价（Node/Rust Golden） | 81 用例 |
| Host conformance | 宿主接入合规（H-01~H-08） | 32 项 |
| Container conformance | 容器生命周期 / 严禁 fork | 38 项 |
| Ownership conformance | 所有权 / 借用检查 | 42 项 |
| NAT-C | 动态模块装载快检（G-45） | 8 项 |

**同一份断言（Test IR）跨后端执行**：Node / JSI / AOT / Host / Device——测试代码不绑定断言库和运行器。

## 全量验证

```bash
npm test            # 1980 单测 / 185 文件
npm run verify      # test + build:web + build:mp 一键全过
npm run check:pkg   # 38 包依赖一致性
```

## 构建产物

```bash
npm run build:web   # dist/web/（标准 Vite SPA）
npm run build:mp    # dist/mp-weixin/（Skyline 四件套，主包体积预算门禁）
proteus build --compiler rust   # 切换 Rust 编译后端
```

## CI 门禁清单

- 全量单测 + vue-tsc 类型检查
- 双端构建 + 主包体积预算（1200KB）
- `proteus audit`（module / capability / coverage / fluid / css / components）
- conformance 全套件（任一 FAIL 阻断合并）

## 部署

Web：静态产物，Vercel / Netlify / 任意静态托管。小程序：上传 `dist/mp-weixin/`。桌面 / 原生：随 G-27 后端矩阵分批落地。
