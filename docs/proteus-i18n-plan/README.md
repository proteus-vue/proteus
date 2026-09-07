# Proteus i18n Plan

> 跨端国际化：Web / 微信小程序 Skyline / App(Native) 三端统一的国际化方案。
> 对齐框架透明编译哲学：消息清单编译期生成、按需分包加载、产物可审计。

## 定位

`proteus-i18n` 是业务层基础设施，依赖 Compiler（编译消息清单）、Module（语言包分包）、Build（产物分析）。

## 文件结构

```
README.md
00-overview.md         架构 + 铁律 + 里程碑 + 依赖图
01-m1-message-catalog.md   B1 ICU MessageFormat + 清单定义 + 类型安全
02-m2-loader-bundling.md   B2 按需加载 + 小程序语言包分包 + lazy
03-m3-runtime.md           B3 useI18n / $t / 复数/日期/货币/ RTL
04-m4-codegen-audit.md     B4 编译期提取 + 死代码检测 + audit missing
05-m5-m7-performance.md    B5 占位符/RTL + M7 预加载/缓存/体积预算
06-m8-devtools-observability.md B8 DevTools 语言面板 + trace + 伪本地化
07-testing-migration-batches.md  测试 + codemod + B1-B7 分批
```

## 与其他 plan 的关系

| 层 | 对接点 |
|----|--------|
| Compiler | transform 提取 `$t()` 调用 → messages 清单 |
| Module | 语言包按 domain 分包（对齐 chunk 字段） |
| Build | 产物体积分析 / 语言包大小门禁 |
| Component | `<i18n>` 组件 + RTL 样式切换 |
| DevTools | 语言面板 / 伪本地化 / missing 高亮 |
| Security | 翻译内容经 DOMPurify（防注入型翻译） |

## 防撑爆规则

- 每份 `.md` ≤ 1200 行；单批 LLM 输入 ≤ 3 文件
- LLM 只加载 `00-overview + 当前文件 + Compiler/types`

## 进度

> ★v2 批次（落地评估 `03-landing-evaluation.md`）：B1-B3 为当前可落地批次，已全部完成（2026-08）；Draft 的 M1-M8 中依赖基建的部分（分包加载/完整 ICU/Intl/RTL 自动应用/AST 提取）标后续。

- [x] **B1 @proteus-vue/i18n 包**（catalog + ICU 子集 + 类型安全）——2026-08，11 用例
- [x] **B2 CLI i18n:check**（缺失/多余/注释豁免）——2026-08，4 用例
- [x] **B3 demo + CI**（双端共享模块链路验证 + i18n:check 门禁）——2026-08
- [ ] M2 分包加载 / M3 Intl 日期货币 / 完整 ICU / RTL 自动应用 / AST 提取（标后续批次，见 03-landing-evaluation §2）
- [ ] B4 编译期提取 + audit
- [ ] B5/M7 性能
- [ ] B8 可观测
- [ ] 测试 + 迁移
