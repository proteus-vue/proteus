# SPI-First 试点改造报告

> 每完成一个耦合点的五步改造，输出本报告（可直接作为 PR/commit 描述与评审材料）。

## 0. 本次试点

- **耦合点**：
- **具体实现名**：
- **改造前业务文件数**：`grep -rln "<实现名>" | wc -l` = ___
- **未来动因**（替换 / 多实现并存 / 三方扩展——至少一项）：
- **选择理由**（为何是它而非其它 P0/P1）：

## 1. 改动清单

- 新建（语义接口 / 各后端 / conformance / 接线）：
  ```
  src/payments/contract.ts        语义接口 PaymentProvider
  src/payments/real/alipay.ts     RealProvider（原逻辑搬入，行为零变化）
  src/payments/mock/mock.ts       MockProvider（测试/降级）
  src/payments/factory.ts         注入与配置入口
  tests/conformance/payment.test.* 契约测试（同一套跑所有后端）
  docs/honesty-boundaries.md      诚实边界
  ```
- 修改（业务层改引用点，数量应 ≪ 原耦合数）：
- 删除：
- **红线外未动**：

## 2. 语义接口（Step 1）

```ts
interface PaymentProvider {
  charge(order: Order): ChargeResult      // 禁出现 alipay/wechat/金额渠道名
  refund(refundReq: RefundRequest): RefundResult
  query(tradeRef: TradeRef): PaymentStatus // 错误用领域错误码
}
```
- 命名收敛自检：grep 接口文件命中厂商词数 = 0 ✅

## 3. 后端清单（Step 2）

| 后端 | 类型 | 用途 | 状态 |
|------|------|------|------|
| AlipayProvider | Real（原逻辑搬入） | 生产默认 | 行为等价验证 ✅ |
| MockProvider | Mock | 测试 / 降级 | 新增 |
| （可选）WechatProvider | Real#2 | 证明可替换 | 新增/计划 |

## 4. conformance（Step 3）

- 位置：`tests/conformance/...`
- 用例清单（只测语义契约）：幂等 / 部分退款 / 网络中断重试 / 金额边界 / 错误码映射 / **负向用例**（某后端错误实现必须被抓）
- 执行结果：全部后端 __/__ PASS（附真实命令输出）
- 负向用例有效性：故意破坏一个后端 → 套件 FAIL（证明有牙齿）✅

## 5. 守界（Step 4）

- 业务层改造后 `grep -rln "<实现名>" src/` = ___（应趋近 0，仅剩适配器目录）
- 静态扫描规则：`禁止业务层 import <sdk>`（CI 门禁）— 已加 / 建议加（需用户确认）

## 6. 诚实边界（Step 5）

| 维度 | 声明 |
|------|------|
| 性能 | 间接调用开销实测 ___（或 `measured: false`，未实测禁宣称） |
| 能力 | 后端能力不齐时：Capabilities 表 + 降级后端 / 显式报错（不静默） |
| 适用 | 本 SPI 不解决 ___（如渠道合规差异由各 Provider 自行负责）；何时**不值得**用本抽象 |

## 7. 反模式自检

- AP-01 单后端：有 Mock ✅ / AP-02 技术名词：grep=0 ✅ / AP-03 无契约：已补 ✅
- AP-04 业务绕过：回归 grep 干净 ✅ / AP-05 类型-only：行为已用例化 ✅
- AP-06 过度设计：三动因判定通过 ✅ / AP-07 后端爆炸：n=2-3 ✅ / AP-08 成本透明：见 §6 ✅

## 8. 剩余候选与下一步

| # | 耦合点 | 优先级 | 建议 |
|---|--------|--------|------|
| 1 | ___ | P0 | 下一试点（理由） |
| 2 | ___ | P1 | … |
| 3 | ___ | P2 | 观察，暂不处理 |

## 9. 未做与风险

- （例）接口仍含历史语义 `tradeNo` 字符串格式约定，待渠道统一后收紧；
- （例）真实渠道的异步回调验签未纳入 conformance（属渠道合规，由 Provider 自管）；
- 任何未实测/未验证项如实列出，不隐藏。
