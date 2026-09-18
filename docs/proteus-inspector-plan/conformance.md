# G-57 Conformance

## 不变量（INV-INSP-01 ~ INV-INSP-08）

| ID | 命题 | 验证方式 |
|----|------|----------|
| **INV-INSP-01** | L0 始终可用，不依赖框架插桩 | probe 独立采样 |
| **INV-INSP-02** | L1/L2 失效不影响 L0 | 拓扑缺失时 L0 仍返回 |
| **INV-INSP-03** | 扩展命名符合 `ext.package.command` | 注册校验 |
| **INV-INSP-04** | 运行时指标可关联到框架结构 | 语义标注正确性 |
| **INV-INSP-05** | 三层数据可序列化、可 diff | JSON 序列化比对 |
| **INV-INSP-06** | Release 构建不提供 Inspector | 构造期即不注册 |
| **INV-INSP-07** | token 鉴权生效 | 错误 token → UNAUTHORIZED |
| **INV-INSP-08** | 宿主无关（同一数据模型） | 传输层抽象 |

## 编号映射（CMP-179 ~ CMP-186）

- CMP-179 → INV-INSP-01（L0 独立性）
- CMP-180 → INV-INSP-02（降级不减损）
- CMP-181 → INV-INSP-03（命名规范）
- CMP-182 → INV-INSP-04（语义关联）
- CMP-183 → INV-INSP-05（可序列化）
- CMP-184 → INV-INSP-06（Debug-only）
- CMP-185 → INV-INSP-07（鉴权）
- CMP-186 → INV-INSP-08（宿主无关）

## 覆盖矩阵

| 来源 | 贡献 |
|------|------|
| G-19 运行时面板 | L0 数据源（不重复造） |
| G-51 TestIRRunner | 可序列化规约 |
| G-52 跨设备 | 隔离域概念 |
| G-54 框架独占能力 | L2 语义的编码期形态 |
| G-56 Studio | 消费端 |
| G-57 本份 | 三层模型 + 扩展机制 |

## 负向自检（NEG-01 ~ NEG-06）

| ID | 用例 | 期望 |
|----|------|------|
| NEG-01 | 非 `ext.` 前缀注册 | 抛错 |
| NEG-02 | 重复注册同名扩展 | 抛错 |
| NEG-03 | 拓扑缺失时采 L1 | 降级返回，不崩溃 |
| NEG-04 | 错误 token 访问 | UNAUTHORIZED |
| NEG-05 | Release 构建列扩展 | 空列表 |
| NEG-06 | 空样本算覆盖率 | 0（不是 1，防虚报） |

## 接缝命题

**S-1**：G-19（运行时数据源）∧ G-57（协议化出口）
→ 同一份运行时数据，App 内面板与桌面工具共享，无需重复采集

**S-2**：G-54（编码期静态语义）∧ G-57（运行时动态语义）
→ 编码期能静态分析的，运行时能动态验证，形成闭环

**S-3**：G-51 INV-06（报告可序列化）∧ G-57 INV-INSP-05
→ 运行时快照与测试报告格式统一，可相互 diff

## 实测结果

```
node reference-impl.cjs  →  self-test: 64/64
bash verify.sh           →  PASS=82 FAIL=0
```

（数字为实测输出，非估算）
