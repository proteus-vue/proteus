# G-54 IDE 适配层

## 1. 五档适配器

| 档 | 目标 | 形态 | 优先级 |
|----|------|------|--------|
| **LSP** | VSCode / JetBrains / Neovim / Zed | 标准语言服务 | 10 |
| **RPC** | 框架自研面板（Web） | WebSocket | 20 |
| **DAP** | 调试器接入 | 标准调试协议 | 30 |
| **CLI** | 无 IDE 环境 / CI | 命令行 | 40 |
| **raw** | 兜底（内核直调） | 进程内函数调用 | 99 |

## 2. 关键设计：适配器是"薄"的

**纪律：适配器只做协议翻译，零业务逻辑。**

```typescript
class LspAdapter implements ProtocolAdapter {
  dispatch(req) {
    const r = kernel.query(req)      // ← 全部逻辑在内核
    return toLspShape(r)             // ← 这里只做形状转换
  }
}
```

**若适配器里出现 `if (isLayeringViolation)`，就是设计错误**——分层判定属于内核。

这条纪律保证：换 IDE 时只需写 ~100 行翻译层，内核零改动。

## 3. 为什么 LSP 是首选

- **一次实现，覆盖全部主流编辑器**（VSCode/JetBrains/Neovim/Emacs/Zed 均支持）
- 标准协议，无 vendor lock-in → **契合原则 #0**
- 社区有成熟 SDK（vscode-languageserver / vscode-languageserver-protocol）

**代价**：LSP 无"SPI 依赖图""设备影响面"概念 → 这 3 项走自研 RPC。

## 4. 降级语义（沿用 G-53/G-51 纪律）

```
请求 → LSP？
  ├─ 可用 → 返回
  ├─ 不支持此能力（CAP_UNSUPPORTED）→ 降级 RPC
  └─ 不可用 → 降级 CLI → raw
```

**SKIP ≠ FAIL**：协议不支持某能力是**预期内**的，报告里标 `degraded: true` 即可。

## 5. 与 G-19 的关系

G-19 是运行时诊断面板（trace/timeline/perf）。
G-54 **不重新实现**，只在 IDE 内嵌入口：

```
IDE 侧边栏
  ├─ Proteus: 分层守护      ← G-54 提供
  ├─ Proteus: 断言内联      ← G-54 提供
  └─ Proteus: 运行时诊断    ← 点击跳转/嵌入 G-19 面板
```

## 6. 诚实边界

- **MVP 只交付 VSCode 参考适配** + CLI；JetBrains/Neovim 由 LSP 天然支持但**不做官方质保**
- 自研 RPC 面板不在 MVP（先用 CLI 承载）
- 不承诺插件市场上架（运营行为）
