# 耦合点审计模板（复制到目标项目填写）

> 填完这张表 = 完成 SPI-First 的"拆分量化"阶段，可进入"逐个攻破"。

## 项目信息

- **系统名称**：
- **审计日期**：
- **审计范围**（模块 / 排除项）：
- **代码规模**（LOC / 业务文件数）：

---

## 1. 扫描（Coupling Audit）

对每个疑似耦合点执行（计数对象 = 业务源码，排除 tests/examples/构建产物）：

```bash
# 通用：某实现名出现在几个文件
grep -rln "<具体实现名>" src/ | wc -l

# TS/JS（import 计数）
grep -rcE "from '<sdk>'|require\('<sdk>'\)" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.vue" src/ | grep -v ':0' | wc -l

# Java/Kotlin / Python / Go / Rust
grep -rc "import <vendor>" --include="*.java" src/ | grep -v ':0' | wc -l
grep -rc "^import <module>" --include="*.py" src/ | grep -v ':0' | wc -l
grep -rc "\"<pkg>\"" --include="*.go" src/ | grep -v ':0' | wc -l
grep -rc "use <crate>" --include="*.rs" src/ | grep -v ':0' | wc -l
```

附加硬编码信号：平台分支（`if (isIOS)`）/ 手写鉴权（`isAdmin`）/ 直连底层（`new S3Client()`）/ 配置与密钥散落 / 唯一实现的"接口"。

### 候选清单

| # | 耦合点 | 具体实现名 | 业务文件数 | 优先级 | 未来动因 | 备注 |
|---|--------|-----------|-----------|--------|---------|------|
| 1 | | | | | | |
| 2 | | | | | | |

**优先级**：P0 ≥ 20 文件且必换/多实现/三方扩展；P1 5–19 或明确演进计划；P2 < 5 登记观察。

---

## 2. 语义收敛审查（仅 P0/P1）

| 候选 | 当前接口/调用形态 | 是否含技术名词 | 建议语义命名 |
|------|-----------------|--------------|-------------|
| | | | |

命名对照：`SaveToS3`→`StoreArtifact`；`PublishToKafka`→`PublishEvent`；`AlipayCharge`→`PaymentProvider.charge`；`ReduxDispatch`→`StateStore.dispatch`。

---

## 3. 后端盘点

| SPI | 已有实现 | 缺失后端 | Mock/Headless 有无 | 判定 |
|-----|---------|---------|-------------------|------|
| | | | | |

判定：已有实现 = 1 且短期内不会来第二个 → 可能是过度设计，降级 P2 或不做抽象。

---

## 4. conformance 现状

| SPI | 有契约测试？ | 用例数 | 是否同一套跨后端跑 | 有负向用例？ |
|-----|------------|--------|------------------|------------|
| | | | | |

**无 = 假 SPI**：先补 conformance 再谈扩展。

---

## 5. 诚实边界登记

| SPI | 性能开销（实测 or measured:false） | 能力不齐降级策略 | 适用边界（何时不值得用） |
|-----|----------------------------------|-----------------|------------------------|

---

## 输出物

1. 耦合点优先级表（上表）
2. 分期计划：v1 改造哪些试点、P2 观察哪些
3. conformance 基线：每个已改造 SPI ≥1 语义契约用例 + 1 负向用例
4. 静态扫描规则（如可行）：禁止业务层直接 import 具体 SDK（CI 门禁）
