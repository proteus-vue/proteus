# AGENTS.md —— 本工程对 AI 会话的约定

> 由 create-proteus 生成；接入 Proteus 框架共建机制。

<!-- proteus-cobuild:start -->
## ★ 参与 Proteus 框架共建

本工程使用 **Proteus 框架**。撞到**框架**问题（编译报错 / 静默失败 / 发布物缺件 / 文档与实际不符）时，
**先挂载 \`Skill(proteus-cobuild)\`**（等价于读 \`.agents/skills/proteus-cobuild/SKILL.md\`）——它讲清：该不该报、报到哪、什么格式、什么时候算修好。

```
① 撞到框架问题 → docs/实战报告_proteus接入.md 追加一节（标题必带版本号 + 最小复现）
                → docs/框架问题台账.json 加一条（id 延续编号）
② 框架修复发布 → git pull 框架仓库，看台账里你那条的 fix_state/fixed_in
③ 复测新版     → 台账回写 verification=passed + verified_by=external
```

> **你的复测是唯一能把"框架自测通过"升级为"独立验证通过"的证据**——这是共建里你的核心价值。
> 自检：\`proteus cobuild check\` + \`node scripts/ledger_check.mjs --check\`
<!-- proteus-cobuild:end -->
