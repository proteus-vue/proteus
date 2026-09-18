# CLI 集成

## 命令

```bash
# 扫描工作区硬编码布局问题（只读）
proteus ai scan ./src

# 迁移：硬编码 → p-* 柔性语义（默认 dry-run）
proteus ai fluidize ./src --dry-run
proteus ai fluidize ./src --apply   # 需 confirm

# 对话式生成（交互）
proteus ai chat

# 单文件快速修复
proteus ai fix src/views/Home.vue

# 审计查看
proteus ai audit [--since <session>]
```

## 行为

- 所有写命令默认 `--dry-run`，输出 Diff + 依据；
- `--apply` 触发信任分级（migrate→PR，refactor→审批）；
- 内部调用 Compiler Plugin：`scan` 用 `buildIR` 钩子，`fluidize` 用 `transform` + `post` 钩子校验。

## 与 `--strict-*` 联动

```
proteus ai fluidize .  ≡  scan + suggest + apply + verify
                            verify = --strict-css
                                   + FLD001-006 (G-22)
                                   + Style Safety (G-16)
```

CI 中 `proteus ai scan --ci` 以非零退出码报告未迁移的硬编码，作为渐进式治理门禁。

## 配置（proteus.config）

```ts
defineProteus({
  ai: {
    enabled: true,
    rules: ["FLD001", "FLD004"],  // 启用子集
    trust: "pr",                  // auto | pr | manual
    audit: true,
  },
})
```
