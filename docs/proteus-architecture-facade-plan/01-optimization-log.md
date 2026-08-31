# 优化日志（Optimization Log）

> 记录 `proteus-architecture` 规约层的演进。每次结构性改动在此留痕，便于回滚。
> 配套：`00-architecture.md`（当前规约）、`ARCHITECTURE.md`（一页全景）、`scripts/check-consistency.js`（校验）、`.github/workflows/consistency.yml`（CI 门禁）。

## 一、改动记录（按版本）

| 版本 | 主题 | 关键改动 | 影响范围 |
|------|------|---------|---------|
| v3.0 | 全局缝合 | scope 全量统一为 `@proteus-vue/*`；新增 `proteus-architecture` 规约层；G-01~G-20 全局执行序；18 份 plan 全部锚定全局规约；落地 `scripts/check-consistency.js` 跨层校验 | 18 份 plan · 61 文件 · 120 处 scope 修正 |
| v3.1 | 规约→工程 | 跨层校验接入 GitHub Actions（`.github/workflows/consistency.yml`：scope 扫描 + 分层锁定 `tsc -b` + contracts 变更聚焦）；新增 `ARCHITECTURE.md` 一页全景（分层 / monorepo / 依赖图 / G-01~G-20 / 9 铁律 / v1.0 验收） | 规约从「文档」升级为「CI 硬门禁」 |
| v3.2 | 新 plan 追加 | 新增 10 份 plan 追加 G-21~G-30（css-compat G-21 / app-renderer G-22 / safe-area G-23 / memory-plan G-24 / memorial G-25 / skeleton G-26 / theme+fontscale G-27 / cache G-28 / glass G-29 / performance G-30）；各新 plan 声称的旧编号（G-04/G-05/G-08/G-10~G-18）一律重指向本表；`check-consistency.js` 落地（scope 扫描 + G 表跨文件一致 + 包注册表对照 + contracts 检查） | 规约表 G-01~G-30 · 10 份新 plan 文档 · 遗留 `@proteus/` scope 修正（types-plus/test-framework） |
| v3.3 | style-safety 追加 | 新增 style-safety（全端样式运行时安全）plan 并入 **G-31**；其声称的 G-16 与 blueprint 撞号 → 一律以本表为准（G-16 = blueprint B1-B5、style-safety = G-31）；依赖 G-21（CSS 矩阵 ✅）/ G-22（App Renderer patchStyle）/ G-10（Compiler IR） | 规约表 G-01~G-31 · style-safety 12 文档 G-16→G-31 重指向 |

---

## 二、G-01 ~ G-31 全局执行序（权威版）

| 序号 | 内容 | 前置 | 备注 |
|------|------|------|------|
| G-01 | types B1（Registry + Platform + contracts） | — | **地基**（types-plus B1-B2 并入） |
| G-02 | compiler B1-B3（parser/IR/后端） | G-01 | SFC → IR |
| G-03 | platform B1 + types B8（typings 整合） | G-01,G-02 | 官方 d.ts |
| G-04 | pinia/router/api B1 | G-01 | 运行时三联（并行）|
| G-05 | lifecycle + module B1 | G-04 | 生命周期 + 模块化 |
| G-06 | component B1-B3 | G-02,G-04 | p-* + WXML schema |
| G-07 | cli + testing + test-framework B1 | G-02 | CLI + Vitest + wx mock |
| G-08 | devtools B1 (TraceBus) | G-04,G-07 | 采集汇聚点 |
| G-09 | security + i18n B1 | G-01 | 加密 + ICU |
| G-10 | compiler B4-B6 + types B4-B7 | G-02,G-06 | 优化 + 校验 |
| G-11 | build B1-B5 | G-02,G-10,G-07 | Vite 插件 + 分包 |
| G-12 | router M7.1/M8.4 + module B5 + api A1-A4 | G-04,G-06 | 强类型钩子 |
| G-13 | devtools B2-B9 + build B6-B8 | G-08,G-11 | 面板 + CI + 缓存 |
| G-14 | security B2-B8 + i18n B2-B7 | G-09,G-12 | 权限 + RTL |
| G-15 | build B9-B10 + testing 全量 | G-11,G-13 | 门禁 + 快照 |
| G-16 | blueprint B1-B5（核心 30 页）| G-12,G-15 | 播放器跨 5 层 ✅ |
| G-17 | blueprint B6-B10（150 页）| G-14,G-16 | audit < 12s |
| G-18 | website B1-B5 | G-15,G-16 | 官网 dogfooding |
| G-19 | website B6-B8 + test-framework E2E | G-17,G-18 | Blueprint 成果展示 |
| G-20 | 全量回归 + changeset 发布 | 全部 | **v1.0** |
| G-21 | css-compat B1-B3（CSS 兼容矩阵 + --strict-css） | G-02/G-10 | CSS 管线（原声称 G-04，重指向） |
| G-22 | app-renderer M1-M6（Custom Renderer + JSI） | G-06,G-21 | 原生渲染后端（原声称 G-05，重指向） |
| G-23 | safe-area M1-M5（p-safe + 灵动岛） | G-22,G-21 | 安全区（原声称 G-05/G-08，重指向） |
| G-24 | memory-plan M1-M6（四层治理 + Owner） | G-06,G-22 | 内存（JSI 部分随 G-22） |
| G-25 | memorial（纪念日置灰） | G-21 | 灰度（原声称 G-11，重指向） |
| G-26 | skeleton（骨架屏） | G-10,G-25 | 骨架（原声称 G-12，重指向） |
| G-27 | theme + fontscale（主题 + 字体） | G-21,G-25 | 主题（原声称 G-13/G-14，重指向） |
| G-28 | cache（L0-L3 缓存） | G-24 | 缓存（原声称 G-15，重指向） |
| G-29 | glass（液态玻璃 L1-L3） | G-06,G-22 | 玻璃（原里程碑标号 G-04~G-18，统一为 M1-M6） |
| G-30 | performance（AOT/IFR/Worklet） | G-10,G-22 | 性能（原声称 G-10/G-05，重指向 G-30/G-22） |
| G-31 | style-safety B1-B4（样式运行时安全） | G-21,G-22,G-10 | 样式安全（原声称 G-16 与 blueprint 撞号，重指向 G-31） |

---

## 三、验收清单

- [x] scope 100% 统一为 `@proteus-vue/*`（grep 零残留）
- [x] 18 份 plan 均已锚定全局规约
- [x] `CrossLayerChecker` 跑通，零 err
- [x] G-01~G-20 执行序无环、无悬空依赖
- [x] 包名注册表覆盖全部 18 个包
- [x] CI 集成 `.github/workflows/consistency.yml`（scope 扫描 + 分层锁定 tsc -b + contracts 聚焦）
- [x] `ARCHITECTURE.md` 一页全景（L0-L5 / monorepo / 依赖图 / G-01~G-20 / 9 铁律 / v1.0 验收）
- [ ] 第三方类型边界文档（types §08-§11）已与 platform/api 对齐

---

## 四、回滚

若需回退 scope 改动：
```bash
git checkout -- 'proteus-*/**/*.md'
```
新增的 `proteus-architecture/` 与 `scripts/` 直接删除即可。

CI 工作流回滚：删除 `.github/workflows/consistency.yml` 即可，不影响业务代码。
