---
'@proteus-vue/slot-runtime': patch
---

修 App 文本归一化把混排（元素/文本交错）的首尾空格 trim 掉（判据 ㉑ 三端红）

背景（用户：「刚才的 iOS 21 问题能修复吗？」）：Vapor 三端门禁判据 ㉑（元素/文本混排）
在 iOS 真机失败，且是**共享实例化**的回归（Android/鸿蒙同样受影响、只是证据陈旧未暴露）。

根因：`packages/slot-runtime/src/instantiate.ts` 的 `normalizeWhiteSpace`（`a982c849` 加，
为修"案例 C：`\n` 应折叠为空格"）在 **normal 分支里对每个文本叶 `.trim()`**：

```
return text.replace(/\s+/g, ' ').trim()   // ✗ 逐叶 trim
```

混排的合成叶 `"mix "` / `" tail"` / 独立空格叶 `" "` 的**首尾空格是行内内容**（Web 里与相邻
inline 之间存在一个空格）——逐叶 trim 把它删掉 ⇒ 渲染成 `mixMIXBtail`、空格叶变空（实测同源
leaf 全部无空格、宽度变满宽 390）。

修法：**collapse-only，不 trim**——`return text.replace(/\s+/g, ' ')`。
理由：编译期已按 Vue `condense` 归一**模板**空白（并把它切成**有意保留**的合成叶）；
数据里的 `\n`/连续空格/制表在运行期**折叠**即可。Web 的"行首尾空白移除"是**行级**语义
（依赖整行 inline 上下文），不该由**逐节点**归一化承担（错误的责任层级）。★案例 C 的
`\n` 折叠**不变**，无回归。

验证（真机）：三端 `results/vapor.json` **重新真机生成**——iOS/Android/鸿蒙 ㉑ 全绿
（`mix |MIXB| tail|int=4 |MIXI|SPA| |SPB`，8/8 叶有宽度）；`check:vapor-three-end` 三端
指纹一致；`tests/whitespace-normalize.test.ts` +⑥（混排首尾空格保留）+ 全量 5620 通过。
★并更正：此前三端门禁的绿灯**倚在陈旧 iOS 证据**上（iOS 从未复跑），现为**真机新证据**。
