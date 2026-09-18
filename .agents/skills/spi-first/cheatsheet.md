# SPI-First 五步法速查卡（LLM 执行版）

> 面对任何大工程：按此单操作一遍 = 完成一次方法论应用。

## Step 1｜找耦合点（Coupling Audit）

```bash
# 某实现名出现在多少业务文件（排除 tests/examples/构建产物）
grep -rln "<具体实现名>" src/ | wc -l
```

- **≥ 2 个业务文件** → 候选耦合点
- **只有 1 个适配器文件** → 已解耦，不处理

| 候选 | 具体实现 | 业务文件数 | 优先级 |
|------|---------|-----------|--------|
| 支付 | alipay | 37 | P0 |
| 存储 | aws-sdk | 24 | P1 |
| 消息队列 | kafka | 18 | P1 |
| 鉴权 | 硬编码 isAdmin | 散落 | P0 |

P0 ≥20 文件且将来必换 / P1 5–19 / P2 <5（登记观察）。

## Step 2｜语义收敛（Define the Semantic）

接口只用业务语言，禁用技术/厂商名词：

```
❌ interface SaveToS3(bucket, key)
✅ interface StoreArtifact(id, bytes): StoredRef
```

1. 命名用领域动词：Store/Publish/Charge/Render/Send（禁 S3/Kafka/React/MySQL）
2. 参数类型用领域类型（`Uint8Array` ≠ `S3.PutObjectRequest`）
3. 错误用统一领域错误码，不用底层异常类型

自检：grep 接口文件，命中厂商/库/协议名 = 未收敛。

## Step 3｜可插拔后端（≥2 个，必须含 Mock/Headless）

```
RealProvider   ← 现有逻辑原样搬入（行为零变化）
MockProvider   ← 测试 / 降级（必须有）
AltProvider    ← 备选真实实现（可选，证明可替换）
```

**单后端 SPI = 假 SPI**。只有一个实现且不会来第二个 → 不要造抽象。

## Step 4｜conformance（The Verifier）

同一份契约测试跑**所有后端**，结果都可判定。

- 只测语义契约（幂等/重试/错误语义/边界/并发/空结果），不测实现细节
- 至少 1 个**负向用例**（坏后端必须被抓 → 套件有牙齿）
- 新后端接入 = 跑同一套 conformance 通过才注册

自检：加一个新后端，需要改业务代码吗？→ 需要 = 未解耦。

## Step 5｜诚实边界（The Honesty Layer）

每个 SPI 声明三条：
1. **性能边界**：间接开销实测值；未实测标注 `measured: false`，禁宣称
2. **能力边界**：后端不齐如何降级（Capabilities 表 / 降级后端 / 显式报错）
3. **适用边界**：什么场景不值得引入（防过度设计；后端 6+ 该拆 SPI）

## 反模式速判（假 SPI 信号）

| 信号 | 修正 | 回到 |
|------|------|------|
| 只有 1 个实现 | 加 Mock 后端 / 去掉抽象 | Step 3 |
| 接口含技术名词 | 语义重命名 | Step 2 |
| 无 conformance | 写契约测试 | Step 4 |
| 业务绕过接口直调底层 | 静态扫描禁止 + 适配器收口 | Step 4 |
| 只定义类型不定义行为 | conformance 用例化行为 | Step 4 |
| 为"可能换"而过度设计 | 适用边界判定（三动因至少一真） | 开始前 |
| 后端 ≥6 且差异巨大 | 收敛 / 拆 SPI / Capabilities 表 | Step 5 |
| 从不做性能实测 | 诚实边界补实测数据 | Step 5 |

## 不适用场景（YAGNI）

- 一次性脚本 / MVP 原型
- 实现唯一、未来不换
- 性能极度敏感热点路径
- 小团队 + 边界已清晰

**判定**："未来要替换 / 多实现并存 / 第三方扩展" 至少一项为真才引入。
