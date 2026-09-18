# G-50 完整性自检（CHECKSUM）

> 静态校验（无运行时依赖，符合"plan only"）。

---

## 1. 文件清单

```
G-50-developer-platform/
├── README.md                ← 本目录入口（Status / 分册 / 依赖 / 诚实边界）
├── 01-problem.md
├── 02-architecture.md
├── 03-spi.md
├── 04-cli-pipeline.md
├── 05-project-scaffold.md
├── 06-debug-protocol.md
├── 07-component-toolkit.md
├── 08-publish-runtime.md
├── 09-developer-portal.md
├── 10-submission-review.md
├── 11-distribution-store.md
├── 12-governance-monetization.md
├── conformance.md
├── rules.md
├── architecture-update.md
├── CHECKSUM.md              ← 本份
├── CHECKSUM.sha256           ← 哈希清单（shasum -a 256 -c 校验）
└── selfcheck.cjs             ← 结构自检（node selfcheck.cjs，exit 0）
```

**预期 17 份 md**（含本份与 README.md）；核心设计文档 **12 份**（01-12；其中 A 册 A1-A5 = 04-08，B 册 B1-B4 = 09-12）；
另含校验文件 CHECKSUM.sha256 与自检脚本 selfcheck.cjs（非参考实现）。

---

## 2. 编号一致性自检

| 检查项 | 期望 | 说明 |
|--------|------|------|
| G-50.1-8 铁律 | 8 条 | rules.md §1 |
| CMP-118~131 | 14 条 | rules.md §2 |
| 原则 #13.46-50 | 5 条 | architecture-update §1 |
| 断言总数（conformance） | 核心 35（A 18 + B 17）+ 接缝 2 + 负向 2 = **39** | conformance §1-3 |

---

## 3. 交叉引用自检

| 引用 | 定义处 | 使用处 |
|------|--------|--------|
| capability-manifest | 05 | 04(audit)、07(matrix)、08(加载) |
| AppPackage | 02 §2, 03 §5 | 04-12 全文 |
| 双签名 | 10 §2 | 08 §1, rules G-50.4, CMP-121 |
| G-49 L3 硬前置 | 01 §3.3, rules G-50.8 | 02 §6, 09-12 |
| ISOLATION_BREACH | 12 §3 | 06 §2, rules G-49 复用 |
| Drop 级联（G-43） | 12 §5 | 08 §6, rules G-50.6 |

> 若某引用"使用处"无对应"定义处" → 一致性失败，须补文档。

---

## 4. 诚实边界复查

- [x] G-50 = plan only（无参考实现 / 无 verify.sh / 无 zip；selfcheck.cjs 为结构自检，非参考实现）
- [x] B 生态依赖 G-49 L3（原则 #13.44、G-50.8）
- [x] 运营/结算非机器可验证（01 §5、12 §6）
- [x] 不承诺微信级生态规模（01 §5.1）

---

*自检规则：以上任一项不匹配 → 文档须修订。本份由人工/LLM 核对，后续可由脚本自动化。*
