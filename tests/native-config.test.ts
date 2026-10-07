// tests/native-config.test.ts —— ★★★原生项目配置（`native` 段 · 决策 #635）解析 + 渲染测试
//
// 【这张测试锁什么】把 `proteus.config` 的 `native` 段（+ app.config 的 app.* 回退）解析为规范值，
//   并**字段级补丁**进三端原生工程文件（AndroidManifest.xml / Info.plist / AppScope/app.json5 /
//   entry/module.json5 / string.json）——判据：
//   ① resolveNativeConfig：native 缺值 → 回退 app.config → 内置默认；
//   ② applyNativeConfig 各端：只改身份字段、**保留**工程其余内容（幂等）；
//   ③ 端不对口不动（Android 只碰 manifest）；跳过项进报告（不静默）。
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveNativeConfig, applyNativeConfig } from '../packages/cli/src/native-config'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-native-'))
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))

function mkdir(name: string): string {
  const d = path.join(TMP, name)
  fs.mkdirSync(d, { recursive: true })
  return d
}

describe('resolveNativeConfig', () => {
  it('native 全空 + 无回退 → 内置默认', () => {
    const r = resolveNativeConfig(undefined, undefined)
    expect(r.app.name).toBe('Proteus App')
    expect(r.android.minSdk).toBe(24)
    expect(r.android.targetSdk).toBe(34)
    expect(r.ios.minimumOSVersion).toBe('15.0')
    expect(r.ios.orientations).toEqual(['portrait'])
    expect(r.harmony.compatibleSdkVersion).toBe('5.0.5(17)')
  })

  it('native 缺值 → 回退 app.config 的 app.*（name/version/buildNumber）', () => {
    const r = resolveNativeConfig({}, { name: 'MyApp', version: '2.3.4', buildNumber: 42 })
    expect(r.app).toEqual({ name: 'MyApp', version: '2.3.4', buildNumber: '42' })
    expect(r.android.label).toBe('MyApp')
    expect(r.android.versionCode).toBe(42)
    expect(r.ios.version).toBe('2.3.4')
    expect(r.harmony.versionName).toBe('2.3.4')
  })

  it('native 显式值优先于回退', () => {
    const r = resolveNativeConfig(
      { app: { name: 'Native', version: '9.0.0', buildNumber: '7' }, android: { label: 'AndroidLabel', minSdk: 26 } },
      { name: 'Fallback', version: '1.0.0', buildNumber: 1 },
    )
    expect(r.app.name).toBe('Native')
    expect(r.android.label).toBe('AndroidLabel')
    expect(r.android.minSdk).toBe(26)
    expect(r.android.versionCode).toBe(7)
  })

  it('targetSdkVersion 缺省跟随 compatibleSdkVersion', () => {
    const r = resolveNativeConfig({ harmony: { compatibleSdkVersion: '5.1.0(19)' } })
    expect(r.harmony.targetSdkVersion).toBe('5.1.0(19)')
  })
})

describe('applyNativeConfig · android', () => {
  it('补丁 package/label/version/uses-sdk/orientation + 追加 permission（保留其余内容）', () => {
    const d = mkdir('and1')
    const manifest = path.join(d, 'AndroidManifest.xml')
    fs.writeFileSync(
      manifest,
      `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="dev.proteus.layoutcore"
    android:versionCode="1"
    android:versionName="0.1.0">
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />
    <application android:label="Old" android:debuggable="true">
        <activity android:name=".AppActivity" android:exported="true" />
    </application>
</manifest>
`,
    )
    const r = resolveNativeConfig({
      app: { name: 'Demo', version: '3.1.2', buildNumber: '9' },
      android: { applicationId: 'com.acme.demo', permissions: ['android.permission.INTERNET', 'android.permission.CAMERA'], orientation: 'portrait' },
    })
    const rep = applyNativeConfig(d, 'android', r)
    const out = fs.readFileSync(manifest, 'utf-8')
    expect(rep.ok).toBe(true)
    expect(out).toContain('package="com.acme.demo"')
    expect(out).toContain('android:versionCode="9"')
    expect(out).toContain('android:versionName="3.1.2"')
    expect(out).toContain('android:minSdkVersion="24"')
    expect(out).toContain('android:label="Demo"')
    expect(out).toContain('android:screenOrientation="portrait"')
    expect(out).toContain('<uses-permission android:name="android.permission.INTERNET" />')
    expect(out).toContain('<uses-permission android:name="android.permission.CAMERA" />')
    expect(out).toContain('android:debuggable="true"')
    expect(out).toContain('<activity android:name=".AppActivity"')

    // 幂等：再跑一次 → permission 不重复、字段值不变
    const rep2 = applyNativeConfig(d, 'android', r)
    const out2 = fs.readFileSync(manifest, 'utf-8')
    expect(rep2.ok).toBe(true)
    expect((out2.match(/android.permission.INTERNET/g) ?? []).length).toBe(1)
    expect(out2.replace(/\s+/g, ' ')).toBe(out.replace(/\s+/g, ' '))
  })

  it('无 AndroidManifest → 跳过（不报错、报告不静默）', () => {
    const d = mkdir('and2')
    const rep = applyNativeConfig(d, 'android', resolveNativeConfig({}))
    expect(rep.ok).toBe(true)
    expect(rep.skipped.some((s) => s.includes('AndroidManifest'))).toBe(true)
  })
})

describe('applyNativeConfig · ios', () => {
  it('补丁 CFBundle* / MinimumOSVersion / 方向 / deviceFamily', () => {
    const d = mkdir('ios1')
    const plist = path.join(d, 'Info.plist')
    fs.writeFileSync(
      plist,
      `<?xml version="1.0"?><plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.proteus.host</string>
  <key>CFBundleName</key><string>Old</string>
  <key>CFBundleDisplayName</key><string>Old</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer></array>
  <key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string></array>
  <key>ProteusHomePage</key><string>index</string>
</dict></plist>`,
    )
    const r = resolveNativeConfig({
      app: { name: '我的应用', version: '4.0.1', buildNumber: '17' },
      ios: { bundleId: 'com.acme.app', deviceFamily: [1, 2], orientations: ['portrait', 'landscape-left'] },
    })
    const rep = applyNativeConfig(d, 'ios', r)
    const out = fs.readFileSync(plist, 'utf-8')
    expect(rep.ok).toBe(true)
    expect(out).toContain('<key>CFBundleIdentifier</key><string>com.acme.app</string>')
    expect(out).toContain('<key>CFBundleDisplayName</key><string>我的应用</string>')
    expect(out).toContain('<key>CFBundleShortVersionString</key><string>4.0.1</string>')
    expect(out).toContain('<key>CFBundleVersion</key><string>17</string>')
    expect(out).toContain('<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>')
    expect(out).toContain('UIInterfaceOrientationLandscapeLeft')
    expect(out).toContain('<key>ProteusHomePage</key><string>index</string>')
  })
})

describe('applyNativeConfig · harmony', () => {
  it('补丁 app.json5 + module.json5 + app_name 字符串', () => {
    const d = mkdir('hm1')
    fs.mkdirSync(path.join(d, 'AppScope/resources/base/element'), { recursive: true })
    fs.mkdirSync(path.join(d, 'entry/src/main'), { recursive: true })
    fs.writeFileSync(
      path.join(d, 'AppScope/app.json5'),
      `{
  "app": {
    "bundleName": "dev.proteus.host",
    "vendor": "proteus",
    "versionCode": 1000000,
    "versionName": "0.1.0",
    "icon": "$media:app_icon",
    "label": "$string:app_name"
  }
}
`,
    )
    fs.writeFileSync(
      path.join(d, 'entry/src/main/module.json5'),
      `{
  "module": {
    "name": "entry",
    "type": "entry",
    "deviceTypes": ["phone"],
    "abilities": []
  }
}
`,
    )
    fs.writeFileSync(
      path.join(d, 'AppScope/resources/base/element/string.json'),
      `{
  "string": [
    { "name": "app_name", "value": "ProteusHost" }
  ]
}
`,
    )
    const r = resolveNativeConfig({
      app: { name: '鸿蒙演示', version: '2.0.0', buildNumber: '5' },
      harmony: { bundleName: 'com.acme.hm', deviceTypes: ['phone', 'tablet'], permissions: ['ohos.permission.INTERNET'] },
    })
    const rep = applyNativeConfig(d, 'harmony', r)
    expect(rep.ok).toBe(true)
    const appJson = fs.readFileSync(path.join(d, 'AppScope/app.json5'), 'utf-8')
    expect(appJson).toContain('"bundleName": "com.acme.hm"')
    expect(appJson).toContain('"versionCode": 5')
    expect(appJson).toContain('"versionName": "2.0.0"')
    const modJson = fs.readFileSync(path.join(d, 'entry/src/main/module.json5'), 'utf-8')
    expect(modJson).toContain('"deviceTypes": ["phone", "tablet"]')
    expect(modJson).toContain('"name": "ohos.permission.INTERNET"')
    const str = fs.readFileSync(path.join(d, 'AppScope/resources/base/element/string.json'), 'utf-8')
    expect(str).toContain('"value": "鸿蒙演示"')
  })
})
