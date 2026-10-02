# @proteus-vue/consistency

多端一致性校验的**统一格式与判定**（单一来源，零依赖）：

| 模块 | 对应任务卡 | 内容 |
|---|---|---|
| `snapshot` | VC3-a/b | 几何/样式快照格式 · 归一化原语（唯一实现）· schema 校验器 · 确定性序列化 |
| `probes/web` | VC4-a | Web 端探针（真值基准：getBoundingClientRect + getComputedStyle） |
| `tolerance` | VC5-a | **分级容差**（按属性类；每类带依据；禁止全局阈值；caps 防全局放宽） |
| `compare` | VC5-b / VC6 | 几何与样式比对引擎（可定位差异 + 单侧失败即整体失败 + Web 基准便利函数） |

配置：容差的工程配置在 `docs/consistency-tolerance.json`（经 `resolveTolerance` 解析、`validateToleranceConfig` 校验）。

详见《Proteus_多端一致性标准方案.md》与《Proteus_一致性校验任务卡清单.md》。
