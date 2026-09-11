// tests/gen-content-interfaces.test.ts
// ★官网漏修回归（2026-09-11）：能力页生成器的 TS 接口解析必须覆盖三类形态
//   ① extends（BluetoothAPI extends BluetoothInfo）——子接口含父属性
//   ② 单行接口（MapPolyline/MapCircle `{ ... }` 同行，且不吞掉紧随的 MapController）
//   ③ 句柄方法表（MapController/BluetoothAPI/FSAdapter 的 method 行）
//   并断言「扩展接口」段（额外 hook：useCameraContext/useRecorder/useSensorStream/useCalendarAPI…）已渲染。
//   方式：对生成产物（website/content/capabilities/*.md）做产物契约断言——与 check:content / en-drift 同源。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const CAP_DIR = path.resolve('website/content/capabilities')
const read = (slug: string): string => fs.readFileSync(path.join(CAP_DIR, `${slug}.md`), 'utf-8')

describe('★能力页生成器：接口解析（extends / 单行 / 泛型）', () => {
  it('bluetooth：BluetoothAPI extends BluetoothInfo → 属性表含继承字段 + 方法表', () => {
    const md = read('bluetooth')
    // extends 合并：父接口 BluetoothInfo 的 supported/available/devices 出现在属性表
    expect(md).toContain('| `supported` | `boolean` |')
    expect(md).toContain('| `available` | `boolean` |')
    expect(md).toContain('| `devices` | `string[]` |')
    // 方法表（富接口）
    expect(md).toContain('#### `data`（`BluetoothAPI`）的方法')
    expect(md).toContain('`write`')
    expect(md).toContain('`setNotify`')
  })

  it('map：MapController 方法表存在（单行接口 MapPolyline/MapCircle 不吞掉它）', () => {
    const md = read('map')
    expect(md).toContain('#### `data`（`MapController`）的方法')
    for (const m of ['getRegion', 'includePoints', 'addMarkers', 'translateMarker']) {
      expect(md).toContain(`| \`${m}\` |`)
    }
  })

  it('nfc：NFCAPI extends NfcInfo → 属性 + HCE 方法表', () => {
    const md = read('nfc')
    expect(md).toContain('| `supported` | `boolean` |')
    expect(md).toContain('startHCE')
    expect(md).toContain('sendHCEMessage')
  })

  it('file-system：FSAdapter 方法异步 + Sync 均在案（无截断）', () => {
    const md = read('file-system')
    expect(md).toContain('readdir')
    expect(md).toContain('readFileSync')
    // 属性表为 3 列（属性|类型|说明）——方法碎片（含 `(`）不得进属性表
    const propsSection = md.slice(md.indexOf('`FSAdapter` 的属性'), md.indexOf('`FSAdapter` 的方法'))
    expect(propsSection).not.toContain('(')
  })
})

describe('★官网漏修：能力扩展接口段（额外 hook 可见）', () => {
  const cases: Array<[string, string, string[]]> = [
    ['camera', 'useCameraContext', ['takePhoto', 'startRecord', 'stopRecord']],
    ['microphone', 'useRecorder', ['start', 'stop', 'pause', 'resume']],
    ['sensor', 'useSensorStream', ['start', 'stop', 'on']],
    ['calendar', 'useCalendarAPI', ['add', 'remove', 'list']],
    ['notification', 'useDeviceNotification', []],
  ]
  for (const [slug, hook, methods] of cases) {
    it(`${slug}：含「扩展接口」段 + ${hook}`, () => {
      const md = read(slug)
      expect(md).toContain('## 扩展接口')
      expect(md).toContain(hook)
      for (const m of methods) expect(md).toContain(`| \`${m}\` |`)
    })
  }

  it('EN 镜像对称（Extension interfaces 段存在）', () => {
    const en = fs.readFileSync(path.resolve('website/en/capabilities/camera.md'), 'utf-8')
    expect(en).toContain('## Extension interfaces')
    expect(en).toContain('useCameraContext')
  })
})
