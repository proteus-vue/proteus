#!/usr/bin/env node
// scripts/studio-panel-device.mjs —— 机型解析（决策 #1247 从门禁拆出）
//
// 【口径】机型优先走**真实 adb 查询**（与应用内同一条命令：`getprop ro.product.model` + `wm size`），
//   查不到才回落 fixture 里记录的"采集时机型"。★两者在判据文案里必须**能分清**
//   （`adb` / `fixture（采集时机型）`）：不然 CI 上看到的机型会让人以为测试跑在那台机器上。
import { execFileSync } from 'node:child_process'

function probeDevice() {
  const get = (args) => {
    try {
      const s = execFileSync('adb', args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      return s || null
    } catch {
      return null // 没装 adb / 没设备：CI 常态，不是错误
    }
  }
  const model = get(['shell', 'getprop', 'ro.product.model'])
  if (!model) return null
  const wm = get(['shell', 'wm', 'size'])
  const size = wm?.split('Physical size:')[1]?.trim()
  return size ? `${model} · ${size}` : model
}

/**
 * @param {string|undefined} fixtureDevice fixture 里记录的采集机型
 * @returns {{ device: string|null, from: string }}
 */
export function resolveDevice(fixtureDevice) {
  const probed = probeDevice()
  return {
    device: probed ?? fixtureDevice ?? null,
    from: probed ? 'adb' : fixtureDevice ? 'fixture（采集时机型）' : '无',
  }
}
