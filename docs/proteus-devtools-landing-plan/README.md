# G-55 开发者工具落地形态与性能工程

> 规划体系第 72 份 plan。G-54 的工程落地方案。

## 一句话

**宿主层可换绝不 fork，内核层唯一且常驻——高性能与不绑定 IDE 因此不冲突。**

## 核心结论

1. **不 fork VSCode**：fork 的收益（编辑器运行时状态）我们不需要，
   代价（Cursor/Windsurf 停在 VSCode 1.99.3、80+ NVD 漏洞、8+ 工程师合并）全额承担
2. **性能瓶颈在内核不在编辑器**：编辑器差异 10ms 级，
   框架知识计算才是大头 → Rust 常驻守护进程
3. **性能断言必须确定性**：计数阻断，墙钟仅 warn（否则 CI 必 flaky）
4. **架构试金石**：加第二个宿主适配器不许改内核——这是可机器验证的分层证明

## 文件导航

| 文件 | 内容 |
|------|------|
| 01-problem | 四种落地形态对比 / fork 为什么不成立 / 性能瓶颈在哪 |
| 02-architecture | 三层解耦 / 常驻守护进程 / 协议层占比 |
| 03-spi | HostAdapter / KnowledgeProvider / PerfBudget |
| 04-host-adapters | 三档宿主矩阵 / 能力对齐表 / 架构试金石 |
| 05-performance-budget | 六项预算 / 墙钟 vs 计数 / 缓存失效 / LRU 边界 |
| 06-kernel-daemon | 增量索引算法 / 缓存结构 / 并发 / 语言选型 |
| conformance | INV-PF-01~08 / CMP-163~170 / 负向用例 |
| rules | G-55.1~8 / AP-PF-01~07 |

## 验证

```bash
node reference-impl.cjs   # 自测
bash verify.sh
```

## 诚实边界

- 六项性能预算为**目标值**（公开 benchmark 对标），非本框架实测
- Zed / Neovim 适配器未实现，不得宣称"已支持"
- 能力 5 / 6 当前为接口 + Mock，依赖 G-53 / G-27 产出
