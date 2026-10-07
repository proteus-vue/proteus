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

  it('★扩充字段：launchPage / theme / 应用标志（set-or-add 到 <application>）', () => {
    const d = mkdir('and3')
    const manifest = path.join(d, 'AndroidManifest.xml')
    fs.writeFileSync(
      manifest,
      `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.proteus.layoutcore">
    <application android:label="Old">
        <meta-data android:name="ProteusHomePage" android:value="index" />
    </application>
</manifest>
`,
    )
    const r = resolveNativeConfig({
      android: {
        launchPage: 'home',
        theme: '@android:style/Theme.NoTitleBar.Fullscreen',
        largeHeap: true,
        supportsRtl: false,
        usesCleartextTraffic: true,
        networkSecurityConfig: '@xml/network_security_config',
        appCategory: 'game',
      },
    })
    const rep = applyNativeConfig(d, 'android', r)
    const out = fs.readFileSync(manifest, 'utf-8')
    expect(rep.ok).toBe(true)
    expect(out).toContain('android:name="ProteusHomePage" android:value="home"')
    expect(out).toContain('android:theme="@android:style/Theme.NoTitleBar.Fullscreen"')
    expect(out).toContain('android:largeHeap="true"')
    expect(out).toContain('android:supportsRtl="false"')
    expect(out).toContain('android:usesCleartextTraffic="true"')
    expect(out).toContain('android:networkSecurityConfig="@xml/network_security_config"')
    expect(out).toContain('android:appCategory="game"')
    expect(out).toContain('android:label="Old"') // 未声明 label → 不覆盖手改值
  })

  it('★结构化权限/特性：permissions 带 maxSdkVersion + usesFeatures + queries（字符串简写仍可用）', () => {
    const d = mkdir('and4')
    const manifest = path.join(d, 'AndroidManifest.xml')
    fs.writeFileSync(
      manifest,
      `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.proteus.layoutcore">
    <application android:label="Old" />
</manifest>
`,
    )
    const r = resolveNativeConfig({
      android: {
        permissions: ['android.permission.INTERNET', { name: 'android.permission.WRITE_EXTERNAL_STORAGE', maxSdkVersion: 32 }],
        usesFeatures: ['android.hardware.camera', { name: 'android.hardware.location.gps', required: false }],
        queryPackages: ['com.tencent.mm', 'com.alipay.android.app'],
      },
    })
    const rep = applyNativeConfig(d, 'android', r)
    const out = fs.readFileSync(manifest, 'utf-8')
    expect(rep.ok).toBe(true)
    expect(out).toContain('<uses-permission android:name="android.permission.INTERNET" />')
    expect(out).toContain('<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="32" />')
    expect(out).toContain('<uses-feature android:name="android.hardware.camera" android:required="true" />')
    expect(out).toContain('<uses-feature android:name="android.hardware.location.gps" android:required="false" />')
    expect(out).toContain('<queries>')
    expect(out).toContain('<package android:name="com.tencent.mm" />')
    expect(out).toContain('<package android:name="com.alipay.android.app" />')
    // 幂等
    applyNativeConfig(d, 'android', r)
    const out2 = fs.readFileSync(manifest, 'utf-8')
    expect((out2.match(/android.permission.INTERNET/g) ?? []).length).toBe(1)
    expect((out2.match(/<queries>/g) ?? []).length).toBe(1)
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

  it('★扩充字段：launchPage / 界面风格 / 状态栏 / 深链 scheme / 隐私说明 / 类别（set-or-add）', () => {
    const d = mkdir('ios2')
    const plist = path.join(d, 'Info.plist')
    fs.writeFileSync(
      plist,
      `<?xml version="1.0"?><plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.proteus.host</string>
  <key>ProteusHomePage</key><string>index</string>
</dict></plist>`,
    )
    const r = resolveNativeConfig({
      ios: {
        launchPage: 'home',
        userInterfaceStyle: 'dark',
        statusBarStyle: 'UIStatusBarStyleLightContent',
        statusBarHidden: true,
        urlSchemes: ['myapp', 'myapp-dev'],
        privacyUsageDescriptions: { NSCameraUsageDescription: '拍照上传头像', NSLocationWhenInUseUsageDescription: '附近门店' },
        appCategory: 'public.app-category.utilities',
        developmentRegion: 'zh_CN',
      },
    })
    const rep = applyNativeConfig(d, 'ios', r)
    const out = fs.readFileSync(plist, 'utf-8')
    expect(rep.ok).toBe(true)
    expect(out).toContain('<key>ProteusHomePage</key><string>home</string>') // 改已有
    expect(out).toContain('<key>UIUserInterfaceStyle</key><string>dark</string>') // 插入
    expect(out).toContain('<key>UIStatusBarStyle</key><string>UIStatusBarStyleLightContent</string>')
    expect(out).toContain('<key>UIStatusBarHidden</key><true/>')
    expect(out).toContain('<key>CFBundleURLTypes</key><array>')
    expect(out).toContain('<string>myapp</string>')
    expect(out).toContain('<string>myapp-dev</string>')
    expect(out).toContain('<key>NSCameraUsageDescription</key><string>拍照上传头像</string>')
    expect(out).toContain('<key>NSLocationWhenInUseUsageDescription</key><string>附近门店</string>')
    expect(out).toContain('<key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>')
    expect(out).toContain('<key>CFBundleDevelopmentRegion</key><string>zh_CN</string>')
    // 幂等：再跑结果一致
    applyNativeConfig(d, 'ios', r)
    expect(fs.readFileSync(plist, 'utf-8')).toBe(out)
  })

  it('★App Transport Security：NSAppTransportSecurity 放宽（allowArbitraryLoads / allowLocalNetworking）', () => {
    const d = mkdir('ios3')
    const plist = path.join(d, 'Info.plist')
    fs.writeFileSync(plist, `<?xml version="1.0"?><plist version="1.0"><dict>\n  <key>CFBundleIdentifier</key><string>dev.proteus.host</string>\n</dict></plist>`)
    const r = resolveNativeConfig({ ios: { appTransportSecurity: { allowArbitraryLoads: true, allowLocalNetworking: true } } })
    const rep = applyNativeConfig(d, 'ios', r)
    const out = fs.readFileSync(plist, 'utf-8')
    expect(rep.ok).toBe(true)
    expect(out).toContain('<key>NSAppTransportSecurity</key>')
    expect(out).toContain('<key>NSAllowsArbitraryLoads</key><true/>')
    expect(out).toContain('<key>NSAllowsLocalNetworking</key><true/>')
    applyNativeConfig(d, 'ios', r)
    expect(fs.readFileSync(plist, 'utf-8')).toBe(out)
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

  it('★扩充字段：icon / appCategory（app.json5）+ 入口 Ability orientation（module.json5）', () => {
    const d = mkdir('hm2')
    fs.mkdirSync(path.join(d, 'AppScope'), { recursive: true })
    fs.mkdirSync(path.join(d, 'entry/src/main'), { recursive: true })
    fs.writeFileSync(
      path.join(d, 'AppScope/app.json5'),
      `{
  "app": {
    "bundleName": "dev.proteus.host",
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
    "abilities": [
      { "name": "EntryAbility", "srcEntry": "./ets/shell/EntryAbility.ets", "exported": true }
    ]
  }
}
`,
    )
    const r = resolveNativeConfig({
      harmony: { icon: '$media:brand_icon', appCategory: 'game', orientation: 'portrait' },
    })
    const rep = applyNativeConfig(d, 'harmony', r)
    expect(rep.ok).toBe(true)
    const appJson = fs.readFileSync(path.join(d, 'AppScope/app.json5'), 'utf-8')
    expect(appJson).toContain('"icon": "$media:brand_icon"') // 改已有
    expect(appJson).toContain('"appCategory": "game"') // 插入
    const modJson = fs.readFileSync(path.join(d, 'entry/src/main/module.json5'), 'utf-8')
    expect(modJson).toContain('"orientation": "portrait"') // 插入到 abilities[0]
    // 幂等
    applyNativeConfig(d, 'harmony', r)
    expect(fs.readFileSync(path.join(d, 'AppScope/app.json5'), 'utf-8')).toBe(appJson)
    expect(fs.readFileSync(path.join(d, 'entry/src/main/module.json5'), 'utf-8')).toBe(modJson)
  })

  it('★结构化权限：reason 普通文案 → 自动生成 $string: 资源（写入 entry 三语言 string.json）+ usedScene', () => {
    const d = mkdir('hm3')
    fs.mkdirSync(path.join(d, 'entry/src/main/resources/base/element'), { recursive: true })
    fs.mkdirSync(path.join(d, 'entry/src/main/resources/zh_CN/element'), { recursive: true })
    fs.writeFileSync(
      path.join(d, 'entry/src/main/module.json5'),
      `{
  "module": {
    "name": "entry",
    "type": "entry",
    "deviceTypes": ["phone"],
    "abilities": [{ "name": "EntryAbility" }]
  }
}
`,
    )
    for (const lang of ['base', 'zh_CN']) {
      fs.writeFileSync(
        path.join(d, `entry/src/main/resources/${lang}/element/string.json`),
        `{\n  "string": [\n    { "name": "module_desc", "value": "desc" }\n  ]\n}\n`,
      )
    }
    const r = resolveNativeConfig({
      harmony: {
        permissions: [
          { name: 'ohos.permission.LOCATION', reason: '用于展示附近门店', usedScene: { when: 'inuse' } },
          'ohos.permission.INTERNET',
          { name: 'ohos.permission.CAMERA', reason: '$string:my_camera_reason' },
        ],
      },
    })
    const rep = applyNativeConfig(d, 'harmony', r)
    expect(rep.ok).toBe(true)
    const modJson = fs.readFileSync(path.join(d, 'entry/src/main/module.json5'), 'utf-8')
    expect(modJson).toContain('"name": "ohos.permission.LOCATION"')
    expect(modJson).toContain('"reason": "$string:permission_ohos_permission_LOCATION_reason"') // 自动资源键
    expect(modJson).toContain('"usedScene": { "abilities": ["EntryAbility"], "when": "inuse" }')
    expect(modJson).toContain('{ "name": "ohos.permission.INTERNET" }') // 字符串简写
    expect(modJson).toContain('"reason": "$string:my_camera_reason"') // 已有 $string: 原样
    const baseStr = fs.readFileSync(path.join(d, 'entry/src/main/resources/base/element/string.json'), 'utf-8')
    expect(baseStr).toContain('"name": "permission_ohos_permission_LOCATION_reason", "value": "用于展示附近门店"')
    // 幂等（reason 资源不重复）
    applyNativeConfig(d, 'harmony', r)
    const baseStr2 = fs.readFileSync(path.join(d, 'entry/src/main/resources/base/element/string.json'), 'utf-8')
    expect((baseStr2.match(/permission_ohos_permission_LOCATION_reason/g) ?? []).length).toBe(1)
  })
})
