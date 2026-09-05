# G-57 Proteus Inspector

三层可观测性叠加：**L0 通用运行时 + L1 语义增强 + L2 框架语义**。

## 核心思想

> **叠加，不替代。**

运行时探针（内存/CPU/帧率）用宿主已有的（Dart VM Service / Flipper / CDP），
框架只做两件事：

1. **给每个指标打上框架标签**（L1）—— 这是核心增量
2. **补齐只有框架知道的语义数据**（L2）—— SPI 拓扑 / 分层违规 / 隔离域 / conformance

## 快速验证

```bash
node reference-impl.cjs    # → self-test: 64/64
bash verify.sh              # → PASS=83 FAIL=0
```

## 文件导航

| 文件 | 内容 |
|------|------|
| 01-problem.md | 问题：看得见数字，看不见结构 |
| **02-architecture.md** | **三层数据模型 + 协议扩展机制** |
| 03-spi.md | InspectorService / 拓扑 / 扩展注册接口 |
| **04-integration.md** | **四种宿主接入路径（Flutter/Flipper/自起服务/CDP）** |
| **05-security.md** | **Debug-only / token / localhost / 绝不采集用户数据** |
| 06-implementation-gates.md | 四阶段路线与风险 |
| conformance.md | INV-INSP-01~08 + CMP-179~186 + 负向用例 |
| rules.md | 八条铁律 + 七个反模式 |
| architecture-update.md | 第 20 次泛化 |
| reference-impl.cjs | 零依赖参考实现 |

## 三条最值得记住的

1. **L1 是差异化所在**：别人看到"内存涨了 50MB"，你看到"这 50MB 来自 `mp-sandbox-7` 隔离域的 `render-skia` 后端"
2. **协议扩展不是野路子**：Flutter 的 Hot Reload 本身就是 VM Service extension
3. **Release 必须编译期剔除**：运行时 if 关闭的代码仍在包里，可被逆向触发

## 诚实边界

- 参考实现的 L0 是**模拟数据**，真实探针需按 04 章对接
- 真实宿主接入（阶段 2）**未实现**
- Release 包扫描断言**未落地 CI**
