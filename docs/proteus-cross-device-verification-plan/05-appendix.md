# G-52 附录

## A. 等价类划分示例

| 等价类 | 代表设备 | 覆盖 |
|--------|----------|------|
| phones (Android) | Pixel 6 | 主流手机 |
| foldables | Mate X | 折叠屏 |
| tablets | iPad | 大屏 |
| low-end | 旧机型 | 低端 API |

## B. 四维指纹对照

```
phone-A: { screen:'392r_3dpi', os:'v8_api33', input:'touch', env:'zh_+8' }
tablet:  { screen:'1281r_2dpi', ... }
         → 首个分歧维度 = screen → 归因 screen
```

## C. 与 G-51 接缝命题

**G-51 INV-06（报告可序列化）∧ G-52 INV-D4（归一化可 diff）**
→ 跨设备报告可序列化 + 可 diff = CI 可消费

> 该式即接缝命题 **①（CMP-146 登记式）**，统一登记见 conformance.md「接缝命题（统一登记）」；接缝命题 **②**（隔离泄漏跨设备归因，承 G-51 INV-08）亦见该节。

## D. 反模式

- **AP-22** 穷举所有设备 → 组合爆炸
- **AP-23** 用 === 比较浮点结果 → 误报（应用 ε）
- **AP-24** 强制联网才能验证 → 违背本地优先
- **AP-25** 无代表采样 → 等价类退化成单点
