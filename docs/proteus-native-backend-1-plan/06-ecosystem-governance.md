# G-28 生态治理

## 1. 分层归属（防膨胀，原则 #10.8 延伸）

| 层 | 归属 | 谁写原生代码 |
|----|------|-------------|
| L1 框架内置 | 核心团队维护 | 核心团队 |
| L2 官方 Backend | **平台 SDK 维护者**（转移来源） | SDK 作者 |
| L3 社区包 | 生态贡献者 | 社区 |
| L4 自定义 | 业务方兜底 | 业务方（须封装成 Backend） |

**核心洞察：L2 把"每个业务开发者各写一遍原生插件"转移给"平台 SDK 维护者"**——他们本来就要维护三端实现。

## 2. 官方 vs 社区

- **官方**：核心团队 + 平台 SDK 官方合作，三端强制、签名发布、SLA 维护
- **社区**：开放贡献，签名审计，质量门禁后方可进默认 registry

## 3. 质量门禁（进 L3 registry 的条件）

- ✅ 三端实现齐全（或缺端需明确标注 `capabilities: { ios: 'none' }`）
- ✅ 100% 通过契约测试（接口符合 `ProteusNativeBackend`）
- ✅ 真机 CI 矩阵通过（权限/断网/拒绝权限 三场景）
- ✅ 文档齐全（权限 reason、API、降级行为）
- ✅ 签名验证通过

## 4. 发现机制

```bash
proteus capability search bluetooth   # 查找可用 Backend
proteus capability add @proteus/backend-bluetooth
```

Registry 返回匹配度（三端支持度、维护活跃度、签名状态）。

## 5. 审计与安全

- 所有 Backend 运行在**沙箱桥接层**，禁止直接访问业务 JS 全局
- 权限声明静态可分析（Compiler 生成清单供人工 review）
- 高危能力（文件/网络/串口）需显式 `unsafe: true` + 用户确认

## 6. 贡献流程

1. RFC（对齐语义接口）
2. 三端实现 + 单测
3. 契约测试 + 真机矩阵
4. 安全审计 + 签名
5. 发布到 registry（L3）→ 稳定后晋升 L2

详见 `03-capability-catalog.md`（能力分层）、`05-backend-package-spec.md`（包契约）、`07-integration-batches.md`（分批落地）。
