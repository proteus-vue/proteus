# M5 · 小程序 E2E（miniprogram-automator）

## 澄清
**miniprogram-automator 就是"小程序官方自动化测试 SDK"**——通过 WebSocket 驱动真实小程序运行时。
配套：miniprogram-ci（上传/打包）+ devtools `--auto`（启动 IDE + 远程调试端口）。

## 前置：启动 IDE

```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto \
  --project "/abs/path/dist/mp" \
  --auto-port 9420
```

## 用例

```ts
import automator from 'miniprogram-automator'

let mini

beforeAll(async () => {
  mini = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
})

it('首页加载并跳转搜索', async () => {
  const page = await mini.redirectTo('/pages/index/index')
  await page.waitFor(300)
  const text = await page.$('view.title')!.text()
  expect(text).toBe('Proteus Music')
})

afterAll(() => mini.disconnect())
```

## 常用 API
- `mini.redirectTo` / `navigateTo` — 路由
- `page.$` / `page.$$` — 选择器（仅类小程序语法）
- `page.callMethod` — 调用页面方法
- `page.data` — 取 data 快照
- `page.waitFor` — 等待

## ⚠️ 硬伤：需要 GUI 环境
automator **不能 headless**，必须启动微信开发者工具。

### CI 降级策略（§08 详述，此处仅骨架）
- **本地 + 专用 Mac runner** 跑 automator E2E
- **CI 通用节点**：只跑 L1-L3 + 编译快照，**跳过 L4 小程序**
- CI 流水线：
  ```
  vitest (L1-L3 + 快照)  →  playwright (Web E2E)  →  [Mac runner] automator
  ```
- 官方云测（MP 云端真机）作为可选后端，接入方式 §08 占位

## 铁律
- 小程序 E2E **只用 automator**，禁止自己 WebSocket 协议
- 用例文件放 `e2e/mp/`，与 Web E2E 平级
- 每个用例必须可独立运行（不依赖上一个用例的页面栈）

---
