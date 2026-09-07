# M8 可观测性 & CI 审计（Compiler 层）

> 对齐整体 M8：编译产物可被审计、可被 AI 理解。

## 一、`proteus audit compile`

CLI 命令（对齐 Router/API/Module 的 `proteus audit`）：

```bash
proteus audit compile [options]
  --check-circular      检测循环依赖
  --check-size          校验体积预算
  --check-platform      校验平台 API 使用（不允许业务目录直接 wx.*）
  --report <file>       输出 JSON 报告
```

## 二、编译报告（结构化）

```json
{
  "summary": { "files": 1240, "errors": 0, "warnings": 3 },
  "dependencies": { "cycles": [] },
  "sizes": { "web": "...", "mp-main": "...", "mp-subpackages": [...] },
  "platformUsage": {
    "violations": [
      { "file": "src/views/Home.vue", "line": 20, "api": "wx.navigateTo" }
    ]
  },
  "transformTrace": { "v-for": 412, "v-if": 238, "...": "..." }
}
```

## 三、CI 门禁（ESLint 配合）

- **禁止业务目录直接调用平台 API**（已在 Platform 层定义）：`wx.*` / `window.*` / `document.*` → 阻断
- 允许清单：`packages/runtime/**`、`packages/platform-*/**`、`compilers/**`
- 实现：ESLint 规则 + 编译期 AST 扫描双重校验

```yaml
# .github/workflows/ci.yml
- run: pnpm proteus audit compile --check-circular --check-size --check-platform
- run: pnpm eslint . --ext .vue,.ts
```

## 四、产物快照审计（Snapshot）

- 每次构建产出 `dist/.manifest.json`（文件清单 + hash）
- PR 间 diff 可视化（哪些产物变了、体积增减）
- 防止意外引入大依赖

## 五、编译耗时分析

- `--profile` 输出每个 transform 耗时
- 定位慢规则（如某条 Skyline 转换 O(n²)）
- 长尾规则触发告警

## 六、AI 协作规范

- `transforms/CONVENTIONS.md`：规则编写铁律 + 禁写清单
- 每条规则 JSDoc 即 API 文档（AI 可读）
- CI 校验新规则含 JSDoc + 单测，否则拒绝合并

## 七、验收

- [ ] `proteus audit compile` 覆盖循环/体积/平台三项
- [ ] ESLint 门禁阻断 `wx.*` 直调
- [ ] manifest snapshot 可 diff
- [ ] `--profile` 定位慢规则
