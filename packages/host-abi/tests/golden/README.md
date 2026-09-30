# host-abi 跨语言 golden

本目录的夹具由**另一侧（TS/CLI）真实产出**，冻结于此供 Rust 侧消费——
两侧都改不了而另一边没跟时，判据会红。

## `capability-manifest.json`

- **来源**：`scanCapabilities('./examples')`（`@proteus-vue/capabilities`，即 CLI
  `proteus capabilities:manifest` 调用的**同一个函数**）的真实产物。
- **消费方**：`packages/host-abi/src/lib.rs` 的 `capability_manifest_golden_is_accepted` 单测
  —— 证明 ABI 接受的清单形态与 TS 侧产出的**是同一份**（不另立第二套字段定义）。
- **重新生成**（改了 `examples/capabilities/*.capability.ts` 或 `scan.ts` 的 manifest 形状后）：

  ```bash
  npx tsx -e "
  import { scanCapabilities } from './packages/capabilities/src/scan.ts'
  import fs from 'node:fs'
  scanCapabilities('./examples').then(({ manifest }) => {
    fs.writeFileSync('packages/host-abi/tests/golden/capability-manifest.json',
      JSON.stringify(manifest, null, 2) + '\n')
  })"
  ```
