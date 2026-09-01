# Proteus × Vue DevTools 接入方案（G-19 补充）

> 将「Vue DevTools 接入策略」落地到 G-19 DevTools plan，并同步更新 `proteus-positioning.md` 第 5 章。

## 文件清单

| 文件 | 说明 |
|------|------|
| 01-vue-devtools-integration.md | ★ Vue DevTools 接入策略主文档（分层结论 / 4 个自定义 Inspector / Backend 适配层 / 边界 / 编辑回写） |
| 02-g19-revision.md | G-19 主文档修订：抽象「原生视图检查器」→ 具体自定义 Inspector |
| 03-positioning-update.md | positioning.md 第 5 章补充：杀手特性⑦ + 对标矩阵行 |
| pack.sh | 打包脚本（双通道 + SHA256） |

## 核心结论

- **UI 面板复用 Vue DevTools 现成的**（Components + 自定义 Inspector 标签页）
- **后端数据通过 `@vue/devtools-api` 的 `setupDevtoolsPlugin` 接入**
- **Web 端零成本；App / 小程序端复用 Frontend + 自研 WS Backend**
- **不 fork Vue DevTools 源码**，只依赖公共 API
