// tests/capability-granularity.test.ts
// ★能力颗粒度对齐（docs/capability-granularity-alignment.md）：蓝牙 BLE 富操作 + usePermission 小程序修复
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createCapabilityBridge, createCapabilityHooks } from '@proteus-vue/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 真·小程序环境 + 完整 BLE wx mock */
function stubMpBle() {
  const calls: string[] = []
  const wx = {
    getSystemInfoSync: () => ({ renderer: 'skyline' }),
    openBluetoothAdapter: (o: { success?: () => void }) => { calls.push('open'); o.success && o.success() },
    closeBluetoothAdapter: (o: { success?: () => void }) => { calls.push('close'); o.success && o.success() },
    getBluetoothAdapterState: (o: { success?: (r: { available: boolean; discovering: boolean }) => void }) => { calls.push('state'); o.success && o.success({ available: true, discovering: false }) },
    getBluetoothDevices: (o: { success?: (r: { devices: Array<{ name: string; deviceId: string; RSSI: number }> }) => void }) => { calls.push('devices'); o.success && o.success({ devices: [{ name: '耳机', deviceId: 'D1', RSSI: -40 }] }) },
    startBluetoothDevicesDiscovery: (o: { success?: () => void }) => { calls.push('startDiscovery'); o.success && o.success() },
    stopBluetoothDevicesDiscovery: (o: { success?: () => void }) => { calls.push('stopDiscovery'); o.success && o.success() },
    createBLEConnection: (o: { deviceId: string; success?: () => void }) => { calls.push('connect:' + o.deviceId); o.success && o.success() },
    closeBLEConnection: (o: { deviceId: string; success?: () => void }) => { calls.push('disconnect:' + o.deviceId); o.success && o.success() },
    getBLEDeviceServices: (o: { deviceId: string; success?: (r: { services: Array<{ uuid: string; isPrimary: boolean }> }) => void }) => { calls.push('services'); o.success && o.success({ services: [{ uuid: 'S1', isPrimary: true }] }) },
    getBLEDeviceCharacteristics: (o: { serviceId: string; success?: (r: { characteristics: Array<{ uuid: string; properties: { read: boolean; write: boolean } }> }) => void }) => { calls.push('chars'); o.success && o.success({ characteristics: [{ uuid: 'C1', properties: { read: true, write: true } }] }) },
    readBLECharacteristicValue: (o: { characteristicId: string; success?: (r: { value: ArrayBuffer }) => void }) => { calls.push('read'); o.success && o.success({ value: new ArrayBuffer(2) }) },
    writeBLECharacteristicValue: (o: { value: ArrayBuffer; success?: () => void }) => { calls.push('write'); o.success && o.success() },
    notifyBLECharacteristicValueChange: (o: { state: boolean; success?: () => void }) => { calls.push('notify:' + o.state); o.success && o.success() },
    getBLEDeviceRSSI: (o: { success?: (r: { RSSI: number }) => void }) => { calls.push('rssi'); o.success && o.success({ RSSI: -55 }) },
    onBluetoothDeviceFound: () => undefined,
    offBluetoothDeviceFound: () => undefined,
    onBLEConnectionStateChange: () => undefined,
    offBLEConnectionStateChange: () => undefined,
    onBLECharacteristicValueChange: () => undefined,
    offBLECharacteristicValueChange: () => undefined,
    // 权限
    getSetting: (o: { success?: (r: { authSetting: Record<string, boolean> }) => void }) => o.success && o.success({ authSetting: { 'scope.camera': true, 'scope.record': false } }),
  }
  vi.stubGlobal('window', undefined)
  vi.stubGlobal('wx', wx)
  return calls
}

describe('★C36 useBluetooth 富接口（BLE 操作）', () => {
  it('返回句柄含 supported/available/devices + 全套操作方法', async () => {
    stubMpBle()
    const bt = await createCapabilityHooks(createCapabilityBridge()).useBluetooth()
    expect(bt.ok).toBe(true)
    if (!bt.ok) return
    const api = bt.data
    // 状态字段（向后兼容）
    expect(api.supported).toBe(true)
    expect(api.available).toBe(true)
    expect(api.devices).toEqual(['耳机'])
    // 操作面
    for (const m of ['close', 'getAdapterState', 'startDiscovery', 'stopDiscovery', 'getDevices', 'getConnectedDevices', 'connect', 'disconnect', 'getServices', 'getCharacteristics', 'read', 'write', 'setNotify', 'onDeviceFound', 'onConnectionStateChange', 'onCharacteristicValueChange', 'getRSSI']) {
      expect(typeof (api as unknown as Record<string, unknown>)[m]).toBe('function')
    }
  })

  it('连接 → 服务 → 特征值 → 读 → 写 → 订阅（全链路往返 Result）', async () => {
    const calls = stubMpBle()
    const bt = await createCapabilityHooks(createCapabilityBridge()).useBluetooth()
    expect(bt.ok).toBe(true)
    if (!bt.ok) return
    const api = bt.data
    await expect(api.connect('D1')).resolves.toMatchObject({ ok: true })
    const sv = await api.getServices('D1')
    expect(sv.ok && sv.data[0].uuid).toBe('S1')
    const ch = await api.getCharacteristics('D1', 'S1')
    expect(ch.ok && ch.data[0].properties.write).toBe(true)
    const rd = await api.read('D1', 'S1', 'C1')
    expect(rd.ok).toBe(true)
    await expect(api.write('D1', 'S1', 'C1', new ArrayBuffer(4))).resolves.toMatchObject({ ok: true })
    await expect(api.setNotify('D1', 'S1', 'C1', true)).resolves.toMatchObject({ ok: true })
    const rssi = await api.getRSSI('D1')
    expect(rssi.ok && rssi.data).toBe(-55)
    // 发现 + 适配器状态 + 关闭
    await expect(api.startDiscovery()).resolves.toMatchObject({ ok: true })
    const st = await api.getAdapterState()
    expect(st.ok && st.data.available).toBe(true)
    await expect(api.close()).resolves.toMatchObject({ ok: true })
    expect(calls).toContain('connect:D1')
    expect(calls).toContain('write')
    expect(calls).toContain('notify:true')
  })

  it('订阅返回取消函数；wx 无 on* API → 空订阅不抛', async () => {
    stubMpBle()
    const bt = await createCapabilityHooks(createCapabilityBridge()).useBluetooth()
    if (!bt.ok) return
    const unsub = bt.data.onConnectionStateChange(() => {})
    expect(typeof unsub).toBe('function')
    expect(() => unsub()).not.toThrow()
  })

  it('缺 BLE API → 对应操作 Err（诚实，不虚构）', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }), openBluetoothAdapter: (o: { success?: () => void }) => o.success && o.success() })
    const bt = await createCapabilityHooks(createCapabilityBridge()).useBluetooth()
    expect(bt.ok).toBe(true)
    if (!bt.ok) return
    const r = await bt.data.connect('D1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('bluetooth.unsupported')
  })
})

describe('★C16 usePermission 小程序端修复（wxBridge 原缺失 → 恒 Err）', () => {
  it('scope.camera=true → granted；scope.record=false → denied；无记录 → prompt', async () => {
    stubMpBle()
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const g = await hooks.usePermission('camera')
    expect(g.ok && g.data.state).toBe('granted')
    const d = await hooks.usePermission('record')
    expect(d.ok && d.data.state).toBe('denied')
    const p = await hooks.usePermission('location')
    expect(p.ok && p.data.state).toBe('prompt')
  })

  it('wx.getSetting 缺失 → Err（诚实降级）', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const r = await createCapabilityHooks(createCapabilityBridge()).usePermission('camera')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('permission.unsupported')
  })
})

describe('★Web 端蓝牙降级（诚实 Err，不虚构）', () => {
  it('web 桥：状态探测 + 操作 Err', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { bluetooth: {} })
    const bt = await createCapabilityHooks(createCapabilityBridge()).useBluetooth()
    expect(bt.ok).toBe(true)
    if (!bt.ok) return
    expect(bt.data.supported).toBe(true)
    const r = await bt.data.connect('D1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('bluetooth.unsupported')
  })
})

describe('★C43 useFileSystem 富接口（Web 内存降级全量往返）', () => {
  it('异步：write/read/append/copy/rename/stat/mkdir/readdir/remove 全链路', async () => {
    vi.stubGlobal('window', {}) // Web → memoryFileSystem
    const fs = createCapabilityHooks(createCapabilityBridge()).useFileSystem()
    expect(fs.supported).toBe(true)
    expect((await fs.writeFile('/a.txt', 'hi')).ok).toBe(true)
    expect((await fs.readFile('/a.txt'))).toMatchObject({ ok: true, data: 'hi' })
    expect((await fs.appendFile('/a.txt', '!')).ok).toBe(true)
    expect((await fs.readFile('/a.txt'))).toMatchObject({ ok: true, data: 'hi!' })
    expect((await fs.copyFile('/a.txt', '/b.txt')).ok).toBe(true)
    expect((await fs.rename('/b.txt', '/c.txt')).ok).toBe(true)
    expect((await fs.stat('/c.txt'))).toMatchObject({ ok: true, data: { size: 3, isFile: true } })
    expect((await fs.mkdir('/dir', true)).ok).toBe(true)
    expect((await fs.writeFile('/dir/x.txt', 'y')).ok).toBe(true)
    const ls = await fs.readdir('/dir')
    expect(ls.ok && ls.data).toContain('x.txt')
    expect((await fs.remove('/c.txt')).ok).toBe(true)
    expect((await fs.exists('/c.txt'))).toMatchObject({ ok: true, data: false })
  })

  it('Sync：writeFileSync/readFileSync/existsSync/statSync/readdirSync/renameSync/unlinkSync', () => {
    vi.stubGlobal('window', {})
    const fs = createCapabilityHooks(createCapabilityBridge()).useFileSystem()
    expect(fs.writeFileSync('/s.txt', 'v').ok).toBe(true)
    expect(fs.readFileSync('/s.txt')).toMatchObject({ ok: true, data: 'v' })
    expect(fs.existsSync('/s.txt')).toMatchObject({ ok: true, data: true })
    expect(fs.statSync('/s.txt')).toMatchObject({ ok: true, data: { size: 1 } })
    expect(fs.renameSync('/s.txt', '/t.txt').ok).toBe(true)
    expect(fs.readFileSync('/missing')).toMatchObject({ ok: false })
    expect(fs.unlinkSync('/t.txt').ok).toBe(true)
    expect(fs.existsSync('/t.txt')).toMatchObject({ ok: true, data: false })
    expect(fs.readdirSync('/').ok).toBe(true)
  })

  it('微信桥 mock：getFileInfo/saveFile/getSavedFileList/unzip', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      getFileSystemManager: () => ({
        getFileInfo: (o: { success?: (r: { size: number; digest: string }) => void }) => o.success && o.success({ size: 10, digest: 'abc' }),
        saveFile: (o: { success?: (r: { savedFilePath: string }) => void }) => o.success && o.success({ savedFilePath: 'saved://1' }),
        getSavedFileList: (o: { success?: (r: { fileList: Array<{ filePath: string; size: number; createTime: number }> }) => void }) => o.success && o.success({ fileList: [{ filePath: 'saved://1', size: 10, createTime: 1 }] }),
        unzip: (o: { success?: () => void }) => o.success && o.success(),
      }),
    })
    const fs = createCapabilityHooks(createCapabilityBridge()).useFileSystem()
    expect((await fs.getFileInfo('/x')).data).toMatchObject({ size: 10, digest: 'abc' })
    expect((await fs.saveFile('tmp://1'))).toMatchObject({ ok: true, data: 'saved://1' })
    expect((await fs.getSavedFileList())).toMatchObject({ ok: true })
    expect((await fs.unzip('/z.zip', '/out')).ok).toBe(true)
  })
})
