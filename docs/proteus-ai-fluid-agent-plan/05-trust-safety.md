# 信任与安全

## 信任分级

| 操作 | 级别 | 审批 |
|------|------|------|
| generate | 自动 | 分支内 commit（可逆） |
| migrate | PR | Diff Review |
| refactor | 人工 | 审批 |
| explain | 只读 | 无 |

## 沙箱

- 工具仅访问工作区 + 允许路径白名单；
- `apply` 写入临时副本 / Git 分支，禁止直写主工作树（G-23.1）；
- 网络访问仅限模型端点，不读 `~/.ssh` 等敏感目录。

## 审计（AI003）

每次工具调用追加 `ai-audit.json`：

```json
{
  "ts": "2026-...",
  "tool": "suggestFluidProp",
  "input": {"prop":"width","value":320},
  "output": {"replacement":"p-fluid=\"width(280,480)\""},
  "rule": "FLD004",
  "verify": {"ok": true}
}
```

## 回滚

- 每次 apply 对应一个 commit / 临时分支；
- `proteus ai undo <session-id>` 一键 reset；
- CI 门禁：verify 失败阻断合入。

## 模型角色

> 模型是**工具编排者**，不是决策者。所有写操作由工具链 + 规则引擎裁决，模型不得绕过校验（G-23.2）。
