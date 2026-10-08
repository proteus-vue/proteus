// packages/cli/src/doctor/checks/devices.ts —— §4.7 devices 组（慢，默认跳过；`--deep`/`--only devices` 开启）
import path from 'node:path'
import type { DoctorCheck } from '../types'
import { ok, fail } from './util'
import { resolveDeveloperDir } from '../../host-package'

export const DEVICES_CHECKS: DoctorCheck[] = [
  {
    id: 'devices/android',
    group: 'devices',
    title: 'Android 设备',
    level: 'warn',
    slow: true,
    appliesTo: (ctx) => ctx.targets.includes('android'),
    run(ctx) {
      const adb = process.env.ADB ?? path.join(process.env.HOME ?? '', 'Library/Android/sdk/platform-tools/adb')
      const ev = ctx.runCmd(adb, ['devices'], { timeoutMs: 8000 })
      const connected = (ev.stdout ?? '').split('\n').filter((l) => /\tdevice$/.test(l.trim())).length
      return connected > 0
        ? ok('devices/android', 'Android 设备', `${connected} 台 connected`)
        : fail({ checkId: 'devices/android', level: 'warn', code: 'PT-EE-021', title: '无 Android 设备', expected: 'adb devices 至少 1 台 connected', actual: '0 台', fix: { description: '连接设备并授权 USB 调试' }, evidence: [ev] })
    },
  },
  {
    id: 'devices/ios',
    group: 'devices',
    title: 'iOS 设备',
    level: 'warn',
    slow: true,
    appliesTo: (ctx) => ctx.targets.includes('ios'),
    run(ctx) {
      const dir = resolveDeveloperDir()
      if (!dir) return fail({ checkId: 'devices/ios', level: 'warn', code: 'PT-BE-004', title: '无可用 Xcode，无法枚举设备', expected: 'xcrun devicectl list devices', actual: '无 Xcode', evidence: [{ note: 'resolveDeveloperDir() 未命中' }] })
      const devicectl = path.join(dir, 'usr', 'bin', 'devicectl')
      const ev = ctx.runCmd(devicectl, ['list', 'devices'], { timeoutMs: 12000, env: { DEVELOPER_DIR: dir } })
      const connected = (ev.stdout ?? '').split('\n').filter((l) => /\bconnected\b/.test(l)).length
      return connected > 0
        ? ok('devices/ios', 'iOS 设备', `${connected} 台 connected`)
        : fail({ checkId: 'devices/ios', level: 'warn', code: 'PT-BE-004', title: '无 iOS 设备', expected: 'devicectl list devices 至少 1 台 connected', actual: '0 台', fix: { description: '连接设备并在设备上信任开发者证书' }, evidence: [ev] })
    },
  },
  {
    id: 'devices/harmony',
    group: 'devices',
    title: '鸿蒙设备',
    level: 'warn',
    slow: true,
    appliesTo: (ctx) => ctx.targets.includes('harmony'),
    run(ctx) {
      const ev = ctx.runCmd('hdc', ['list', 'targets'], { timeoutMs: 8000 })
      const lines = (ev.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[Empty\]/i.test(l))
      return ev.exitCode === 0 && lines.length > 0
        ? ok('devices/harmony', '鸿蒙设备', `${lines.length} 台`)
        : fail({ checkId: 'devices/harmony', level: 'warn', code: 'PT-EE-021', title: '无鸿蒙设备', expected: 'hdc list targets 有设备', actual: (ev.stdout ?? ev.note ?? '无').trim() || '0 台', fix: { description: '连接设备（hdc）' }, evidence: [ev] })
    },
  },
]
