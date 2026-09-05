# 贡献指南（CONTRIBUTING.md）

欢迎贡献 Proteus！这是一个 **AI-native 透明跨端编译框架**——透明（规则注册表 + 自校验 + 决策 trace）既是框架卖点，也是协作方式。

## 开发前必读（顺序）

1. `PROJECT_MEMORY.md` —— 项目记忆：进度 / 64+ 条决策 / 验证状态（**新贡献者/LLM 先读**）
2. `LLM_IMPLEMENTATION_GUIDE.md` —— §0 痛点对照与设计原则（§0.5 定位宪章）
3. `proteus.config.ts` —— 当前配置
4. `src/compiler/transforms/registry.ts`（注：已随 v0.2 移至 `packages/compiler/src/transforms/`）—— 编译规则注册表

## 环境

- Node.js ≥ 18，npm ≥ 9（workspaces）
- 常用命令：`npm test` / `npm run build:web` / `npm run build:mp` / `npm run debug:mp` / `npm run verify`

## 改动编译规则（★核心约定）

所有转换规则集中在 `packages/compiler/src/transforms/` 注册表，**改规则必须同步**：

1. **改实现**：`template.ts` / `script.ts` / `style.ts` / `validate.ts`（纯函数）
2. **改 AI 说明书**：`transforms/*.ts` 中对应规则的 what/why/when/example/verify/decision 字段
3. **补英文说明**：同时填写该规则 `descriptionEn`（★#480 注册表双语——官网 EN 态 Playground 规则目录消费；`tests/transforms.test.ts` 硬卡每条规则必带，新增规则漏填会红）
4. **改映射表**：`tags.ts`（TAG_MAP/EVENT_MAP/SEMANTIC_CLASS）——`tests/transforms.test.ts` 会校验每个键都被规则覆盖
5. **跑测试**：`tests/transforms.test.ts`（防漂移）+ `tests/explain.test.ts`（trace 可解析）+ 对应单测
6. **配置演示**（如涉及）：`examples/` + `proteus.config.ts` 的 rules 段

> 规则注册表 = 能力清单 + AI 说明书 + trace 键，三处同源——改一处漏三处会被测试当场拦住；descriptionEn 必填由 transforms 测试强制。

## 文档写作规约（全端视角，★#487）

指南（`website/guides`）与框架（`website/framework`）的叙事口径是**「一套语义 → 各端产物」**：Web 与小程序是**已接线的两类形态**，iOS/Android/鸿蒙/Flutter 渲染后端直食同一份语义 IR。写文档时：

1. **C1 世界观句**：不写「双端工程/双端配置/双端 codegen」等把两端当框架完整答案的表述——写「按端 codegen（Web/小程序已接线，其余端同树语义）」并链到渲染后端/端矩阵
2. **C2 表格/示例**：产物对照表注明「以 Web/小程序两类编译形态为例；原生端不经中间形态、直食语义 IR」
3. **C3 操作收口**：不说「Web 与小程序两端同时生效」——说「所有目标端同时生效（业务代码不因端分叉）」
4. **双语同步**：zh 改动同轮改 en 镜像，行数对等 + 零中文残留收口
5. **门禁**：本地/CI 跑 `npm run check:alltarget`（模式集见 `scripts/check-all-target-wording.mjs`）；确为话题限定页（如真实双端工具流/模板）在行尾加 ` <!--all-target-ok-->` 放行并写明理由

## PR 流程

1. fork + 分支（`feat/xxx` 或 `fix/xxx`）
2. 改动 + 测试全绿（`npm test`、`vue-tsc --noEmit`、`build:web`、`build:mp`）
3. 文档同步（README / docs/ 如有涉及）
4. **归档决策**：`PROJECT_MEMORY.md` 关键决策与文档偏差追加一条（带编号）
5. 提交信息遵循 `feat:` / `fix:` / `docs:` 前缀（参考 git log）
6. PR 描述写清：改了什么 / 为什么 / 验证了什么 / 决策号

## 新增能力（路线图任务）

按 `docs/roadmap.md` 里程碑推进，每完成一项在 `PROJECT_MEMORY.md` 归档（决策号 + 落地文件 + 验证状态）。

## 行为准则

友善、就事论事。技术分歧用代码与测试说话（本项目"反黑盒"：任何决定都可验证、可回查）。
