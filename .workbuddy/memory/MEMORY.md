# Proteus 项目长期记忆

## ★操作纪律（最高优先级）
- **没有用户明确指令，严禁直接修改项目源文件**（含 wgsl/reference/宿主代码/生成物）。
  调研、像素取证、跑门禁、写日志/文档允许；改源码必须先请示。（2026-10-14 越界事故固化：
  glass.wgsl 正被并发 ZCode 会话使用，被擅自修改后取证回滚。）
- **git push 前必须用户明确批准**。
- 撤销未提交改动**严禁 `git checkout --`**；本仓并发会话多，回滚用
  「git diff 确认归属 → Edit 精确反向替换 → 重跑生成」的可逆流程。
- 本仓常驻多个并发 AI 会话（ZCode/wb 等）：改文件前必须先确认无并发占用；取证下结论，
  禁外推。
- **★★并发会话的 `git commit` 会带走你已 stage 的一切**（2026-10-22 实测：Studio 出门的
  46 个 rename 被 `da02a1a3` 带走、15 个内容改动被 `a06b46e0` 带走，内容正确但归属全乱，已 push 无法回退）。
  ⇒ 想保住提交归属：**改完立刻 commit，或最后一次性 add+commit**；别把改动长时间留在 index 里。

## ★调研纪律（2026-10-16 用户批评「前后反复推翻结论、白白浪费时间」后固化）
**症状**：一下午玻璃调研里，我先后推翻自己 4 次结论（折射带位置 / 手画描边当光学 /
外凸归属 / α 恒定↔分档），每次都因为「基准没先钉死就先下机制结论」。
**强制顺序（违反即视为缺陷）**：
1. **先钉几何基准**：条/胶囊/前景/背景的**精确像素边界**（用「整宽 1px 暗缝 + 紧邻亮脊」
   这类与内容无关的静态特征定位），而不是靠肉眼看缩略图认字。
2. **先做区域分类**：把像素分成「前景（画在玻璃上、锐利）」与「透射（玻璃下、被处理）」
   两类，分开统计；混在一起统计必然得出错误结论。
3. **只做同源对比**：不同内容之间禁止直接比梯度/对比度（苹果对橘子）。
   没有同源样本时明说「无法定量」，不猜、不外推。
4. **先测后判**：先出数据与可视化，再给机制解释；禁止先想机制再找证据佐证。
5. **每个结论标注置信度 + 证伪条件**；被推翻时**先修正旧结论再给新结论**，并说明推翻了哪一条。
6. **不确定就给图**：拿不准的区域直接裁剪放大给用户看，而不是自己先下判断再被纠正。
**关键教训**：面纱 α 与模糊 σ 都曾各自被当成「唯一根因」，结果都是**局部正确、整体跑偏**——
真正的问题要从「几何基准 → 区域分离 → 同源测量」这条链推，不能跳步。

## 环境要点
- 工作区：`/Volumes/data1/work/office/debug/proteus`，分支 main，远端 origin
  (github.com:proteus-vue/proteus.git)。
- 玻璃 shader 真源：`packages/shader-codegen-rust/src/materials/glass.wgsl`（改它=改全端，
  需重跑 `npm run gen:shaders` 同步四端生成物）。CPU oracle：
  `packages/shader-codegen-rust/src/reference.rs`，两处必须同步改。
- 门禁：check:shader-generated / shader-capability / glass-audit / glass-capability /
  no-json-wire / invoke-wire-parity / ai-tasks。
- ZCode artifact 快照机制（恢复被删文件用）：`~/.zcode/cli/artifacts/sess_*/`
  下 `kind: workspace_file_before_change` 的 `files[].afterContent` 含变更后全文，
  详见 skill `recover-deleted-files`。
