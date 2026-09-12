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

describe('★C4 useMap 富接口（覆盖物/视野/坐标/移动标记）', () => {
  it('控制器含全套方法；调用往返 Result', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createMapContext: () => ({
        getRegion: (o: { success?: (r: { latitude: number; longitude: number; scale: number }) => void }) => { calls.push('getRegion'); o.success && o.success({ latitude: 30, longitude: 120, scale: 16 }) },
        moveTo: (o: { success?: () => void }) => { calls.push('moveTo'); o.success && o.success() },
        includePoints: (o: { points: unknown[]; success?: () => void }) => { calls.push('includePoints:' + o.points.length); o.success && o.success() },
        addMarkers: (o: { markers: unknown[]; success?: () => void }) => { calls.push('addMarkers:' + o.markers.length); o.success && o.success() },
        translateMarker: (o: { markerId: number; success?: () => void }) => { calls.push('translate:' + o.markerId); o.success && o.success() },
        getScale: (o: { success?: (r: { scale: number }) => void }) => { calls.push('getScale'); o.success && o.success({ scale: 18 }) },
      }),
    })
    const r = await createCapabilityHooks(createCapabilityBridge()).useMap('m')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const map = r.data
    for (const m of ['getRegion', 'moveTo', 'moveToLocation', 'includePoints', 'translateMarker', 'addMarkers', 'removeMarkers', 'addPolylines', 'removePolylines', 'addCircles', 'removeCircles', 'getScale', 'openMapApp', 'on']) {
      expect(typeof (map as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    expect((await map.getRegion()).ok).toBe(true)
    expect((await map.includePoints([{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }])).ok).toBe(true)
    expect((await map.addMarkers([{ id: 1, latitude: 1, longitude: 2 }])).ok).toBe(true)
    expect((await map.translateMarker({ markerId: 7, destination: { latitude: 1, longitude: 2 } })).ok).toBe(true)
    const sc = await map.getScale()
    expect(sc.ok && sc.data).toBe(18)
    expect(calls).toContain('includePoints:2')
    expect(calls).toContain('translate:7')
  })

  it('缺 ctx 方法 → 对应操作 Err（诚实，不虚构）', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }), createMapContext: () => ({}) })
    const r = await createCapabilityHooks(createCapabilityBridge()).useMap('m')
    if (!r.ok) return
    const incl = await r.data.includePoints([])
    expect(incl.ok).toBe(false)
    if (!incl.ok) expect(incl.error.code).toBe('map.unsupported')
  })
})

describe('★C1/C2 相机 + 录音操作控制器', () => {
  it('useCameraContext：takePhoto/startRecord/stopRecord/setZoom 往返', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createCameraContext: () => ({
        takePhoto: (o: { quality?: string; success?: (r: { tempImagePath: string; width: number; height: number }) => void }) => o.success && o.success({ tempImagePath: '/p.jpg', width: 100, height: 200 }),
        startRecord: (o: { success?: () => void }) => o.success && o.success(),
        stopRecord: (o: { success?: (r: { tempVideoPath: string; duration: number; size: number }) => void }) => o.success && o.success({ tempVideoPath: '/v.mp4', duration: 3, size: 999 }),
        setZoom: (o: { zoom: number; success?: () => void }) => o.success && o.success(),
      }),
    })
    const cam = createCapabilityHooks(createCapabilityBridge()).useCameraContext('c1')
    expect(cam.ok).toBe(true)
    if (!cam.ok) return
    const photo = await cam.data.takePhoto('high')
    expect(photo).toMatchObject({ ok: true, data: { tempImagePath: '/p.jpg', width: 100, height: 200 } })
    expect((await cam.data.startRecord()).ok).toBe(true)
    expect((await cam.data.stopRecord())).toMatchObject({ ok: true, data: { duration: 3, size: 999 } })
    expect((await cam.data.setZoom(2)).ok).toBe(true)
    expect(typeof cam.data.onCameraFrame(() => {})).toBe('function')
  })

  it('useRecorder：start/stop/pause/resume + 事件订阅', () => {
    let stopped = false
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      getRecorderManager: () => ({ start: () => {}, stop: () => { stopped = true }, pause: () => {}, resume: () => {}, onStop: (cb: (r: unknown) => void) => cb({}), onFrameRecorded: () => {} }),
    })
    const rec = createCapabilityHooks(createCapabilityBridge()).useRecorder()
    expect(rec.ok).toBe(true)
    if (!rec.ok) return
    for (const m of ['start', 'stop', 'pause', 'resume', 'on', 'onFrameRecorded']) {
      expect(typeof (rec.data as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    expect(typeof rec.data.on('stop', () => {})).toBe('function')
  })

  it('缺桥 → useCameraContext/useRecorder 返回 Err（handle 型统一契约）', () => {
    vi.stubGlobal('window', {})
    const bare = { getLocation: async () => ({ latitude: 0, longitude: 0 }), vibrate: async () => {}, getNetwork: async () => ({ online: true, type: 'unknown' as const }), readClipboard: async () => '', setClipboard: async () => {}, getScreen: async () => ({ width: 0, height: 0, dpr: 1, orientation: 'portrait' as const }), getDevice: async () => ({ platform: 'web', model: '', os: '', version: '' }), getBattery: async () => ({ level: 1, charging: true }), getOrientation: async () => ({ type: 'portrait' as const, angle: 0 }), share: async () => {} }
    const h2 = createCapabilityHooks(bare)
    expect(h2.useCameraContext('x').ok).toBe(false)
    expect(h2.useRecorder().ok).toBe(false)
  })
})

describe('★C5 传感器流 useSensorStream（启停 + 多订阅 + 泄漏修复）', () => {
  it('start 挂接推送 → on 订阅收到帧；stop 取消订阅', async () => {
    let frame: ((r: { x: number; y: number; z: number }) => void) | null = null
    let offCalled = false
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      startAccelerometer: (o: { success?: () => void }) => o.success && o.success(),
      stopAccelerometer: (o: { success?: () => void }) => o.success && o.success(),
      onAccelerometerChange: (cb: (r: { x: number; y: number; z: number }) => void) => { frame = cb },
      offAccelerometerChange: () => { offCalled = true },
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useSensorStream('accelerometer')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const stream = r.data
    const seen: number[] = []
    stream.on((s) => seen.push(s.x as number))
    expect(stream.active()).toBe(false)
    await stream.start()
    expect(stream.active()).toBe(true)
    // 模拟传感器推送
    frame!({ x: 1, y: 2, z: 3 })
    expect(seen).toEqual([1])
    await stream.stop()
    expect(stream.active()).toBe(false)
    expect(offCalled).toBe(true)
  })

  it('readSensor 一次性读取后解除监听（修泄漏）', async () => {
    let off = false
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      onCompassChange: (cb: (r: { direction: number }) => void) => setTimeout(() => cb({ direction: 90 }), 0),
      offCompassChange: () => { off = true },
    })
    const s = await createCapabilityHooks(createCapabilityBridge()).useSensor('compass')
    expect(s.ok && s.data.heading).toBe(90)
    expect(off).toBe(true) // 读到即解除监听
  })
})

describe('★C15 存储异步/批量/info（useStorage）', () => {
  it('web（内存降级）setAsync/getAsync/removeAsync/info/batch', async () => {
    vi.stubGlobal('window', {})
    const st = createCapabilityHooks(createCapabilityBridge()).useStorage()
    expect((await st.setAsync('a', { n: 1 })).ok).toBe(true)
    expect(await st.getAsync('a')).toMatchObject({ ok: true, data: { n: 1 } })
    expect((await st.batchSet([{ key: 'x', value: 1 }, { key: 'y', value: 2 }])).ok).toBe(true)
    const bg = await st.batchGet(['x', 'y'])
    expect(bg.ok && bg.data[0].value).toBe(1)
    const info = await st.info()
    expect(info.ok && info.data.keys).toContain('a')
    expect((await st.removeAsync('a')).ok).toBe(true)
    expect((await st.getAsync('a')).data).toBeUndefined()
  })
})

describe('★C37 NFC 富接口（HCE 卡模拟 + 消息）', () => {
  it('startHCE/stopHCE/sendHCEMessage + onHCEMessage', async () => {
    const calls: string[] = []
    let msgCb: ((r: { messageType: number; data?: ArrayBuffer }) => void) | null = null
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      getHCEState: (o: { success?: () => void }) => { calls.push('state'); o.success && o.success() },
      startHCE: (o: { aidList: string[]; success?: () => void }) => { calls.push('start:' + o.aidList.length); o.success && o.success() },
      stopHCE: (o?: { success?: () => void }) => { calls.push('stop'); o && o.success && o.success() },
      sendHCEMessage: (o: { success?: () => void }) => { calls.push('send'); o.success && o.success() },
      onHCEMessage: (cb: (r: { messageType: number }) => void) => { msgCb = cb },
      offHCEMessage: () => undefined,
      onHCEStateChange: () => undefined,
    })
    const r = await createCapabilityHooks(createCapabilityBridge()).useNFC()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const nfc = r.data
    expect(nfc.available).toBe(true)
    for (const m of ['startHCE', 'stopHCE', 'sendHCEMessage', 'onHCEMessage', 'onHCEStateChange']) {
      expect(typeof (nfc as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    expect((await nfc.startHCE(['A0000002471001'])).ok).toBe(true)
    expect((await nfc.sendHCEMessage(new ArrayBuffer(4))).ok).toBe(true)
    expect((await nfc.stopHCE()).ok).toBe(true)
    let got: number | null = null
    nfc.onHCEMessage((m) => { got = m.messageType })
    msgCb!({ messageType: 1 })
    expect(got).toBe(1)
    expect(calls).toContain('start:1')
  })
})

describe('★C17 通知扩展（设备订阅 + 客服）', () => {
  it('MP：subscribeDeviceMessage + openCustomerService', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      requestSubscribeDeviceMessage: (o: { tmplIds: string[]; success?: (r: Record<string, string>) => void }) => o.success && o.success({ T1: 'accept' }),
      openCustomerServiceChat: (o: { success?: () => void }) => o.success && o.success(),
    })
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const d = await hooks.useDeviceNotification('T1')
    expect(d.ok && d.data.granted).toBe(true)
    expect((await hooks.useCustomerService('corp', 'https://x')).ok).toBe(true)
  })

  it('web：设备订阅/客服诚实 Err', async () => {
    vi.stubGlobal('window', {})
    const hooks = createCapabilityHooks(createCapabilityBridge())
    expect((await hooks.useDeviceNotification('T1')).ok).toBe(false)
    expect((await hooks.useCustomerService('c', 'u')).ok).toBe(false)
  })
})

describe('★C25 后台生命周期扩展 + C20 日历 API', () => {
  it('BackgroundAPI：onMemoryWarning/onThemeChange/onWindowResize + 启动参数', async () => {
    const fired: string[] = []
    let memCb: ((r: { level: number }) => void) | null = null
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      onAppHide: () => undefined,
      onAppShow: () => undefined,
      onMemoryWarning: (cb: (r: { level: number }) => void) => { memCb = cb },
      onThemeChange: () => undefined,
      onWindowResize: (cb: (r: { size: { windowWidth: number; windowHeight: number } }) => void) => setTimeout(() => cb({ size: { windowWidth: 375, windowHeight: 667 } }), 0),
      getLaunchOptionsSync: () => ({ path: 'pages/index', scene: 1001 }),
      getEnterOptionsSync: () => ({ scene: 1001 }),
    })
    const bgR = await createCapabilityHooks(createCapabilityBridge()).useBackground()
    expect(bgR.ok).toBe(true)
    if (!bgR.ok) return
    const bg = bgR.data
    for (const m of ['onEvent', 'onMemoryWarning', 'onThemeChange', 'onWindowResize', 'onError', 'onUnhandledRejection', 'onNetworkStatusChange', 'getLaunchOptions', 'getEnterOptions']) {
      expect(typeof (bg as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    bg.onMemoryWarning((l) => fired.push('mem:' + l))
    memCb!({ level: 10 })
    expect(fired).toContain('mem:10')
    const lo = await bg.getLaunchOptions()
    expect(lo.ok && lo.data.scene).toBe(1001)
    let size: { windowWidth: number } | null = null
    bg.onWindowResize((s) => { size = s })
    await new Promise((r) => setTimeout(r, 5))
    expect(size && size.windowWidth).toBe(375)
  })

  it('CalendarAPI（MP）：add/remove 走 wx，list 诚实 Err', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      addPhoneCalendar: (o: { success?: () => void }) => o.success && o.success(),
      removePhoneCalendar: (o: { success?: () => void }) => o.success && o.success(),
    })
    const cal = createCapabilityHooks(createCapabilityBridge()).useCalendarAPI()
    expect(cal.ok).toBe(true)
    if (!cal.ok) return
    expect((await cal.data.add({ title: 'x', startTime: 1 })).ok).toBe(true)
    expect((await cal.data.remove('e1')).ok).toBe(true)
    const list = await cal.data.list()
    expect(list.ok).toBe(false)
    if (!list.ok) expect(list.error.code).toBe('calendar.unsupported')
  })

  it('CalendarAPI（web）：全操作诚实 Err', async () => {
    vi.stubGlobal('window', {})
    const cal = createCapabilityHooks(createCapabilityBridge()).useCalendarAPI()
    if (!cal.ok) return
    expect((await cal.data.add({ title: 'x', startTime: 1 })).ok).toBe(false)
    expect((await cal.data.list()).ok).toBe(false)
  })
})

describe('★C49 直播 LiveRoom 富接口（观看端播放控制）', () => {
  it('play/pause/resume/stop/mute/snapshot/全屏 + onStateChange', async () => {
    let onPlay: (() => void) | null = null
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createLivePlayerContext: () => ({
        play: (o: { success?: () => void }) => { calls.push('play'); o.success && o.success() },
        pause: (o: { success?: () => void }) => { calls.push('pause'); o.success && o.success() },
        resume: (o: { success?: () => void }) => { o.success && o.success() },
        stop: (o: { success?: () => void }) => { calls.push('stop'); o.success && o.success() },
        mute: () => { calls.push('mute') },
        snapshot: (o: { success?: (r: { tempImagePath: string }) => void }) => o.success && o.success({ tempImagePath: '/live.jpg' }),
        requestFullScreen: (o: { success?: () => void }) => o.success && o.success(),
        exitFullScreen: (o: { success?: () => void }) => o.success && o.success(),
        onPlay: (cb: () => void) => { onPlay = cb },
        onError: () => undefined,
      }),
    })
    const r = await createCapabilityHooks(createCapabilityBridge()).useLive({ roomId: 'room-1' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const live = r.data
    for (const m of ['play', 'pause', 'resume', 'stop', 'mute', 'snapshot', 'requestFullScreen', 'exitFullScreen', 'status', 'onStateChange', 'leave']) {
      expect(typeof (live as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    let state: string | null = null
    live.onStateChange((s) => { state = s })
    expect((await live.play()).ok).toBe(true)
    onPlay!() // 组件回调驱动状态
    expect(state).toBe('playing')
    expect(live.status()).toBe('playing')
    expect((await live.snapshot())).toMatchObject({ ok: true, data: '/live.jpg' })
    live.mute()
    expect((await live.leave()).ok).toBe(true)
    expect(calls).toContain('mute')
  })

  it('缺 createLivePlayerContext → useLive Err（诚实降级）', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const r = await createCapabilityHooks(createCapabilityBridge()).useLive({ roomId: 'x' })
    // 句柄构造成功（无 live-player 上下文 → play 等操作返回 Err）
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const play = await r.data.play()
    expect(play.ok).toBe(false)
    if (!play.ok) expect(play.error.code).toBe('live.unsupported')
  })

  it('web：直播句柄操作诚实 Err', async () => {
    vi.stubGlobal('window', {})
    const r = await createCapabilityHooks(createCapabilityBridge()).useLive({ roomId: 'x' })
    expect(r.ok).toBe(true) // 句柄返回成功（方法级 Err）
    if (!r.ok) return
    const play = await r.data.play()
    expect(play.ok).toBe(false)
    if (!play.ok) expect(play.error.code).toBe('live.unsupported')
  })
})

describe('★C37 NFC 读卡模式（NFCAdapter：发现 + 各技术类型连接）', () => {
  it('getAdapter → startDiscovery/onDiscovered/connectNdef(writeNdefMessage)', async () => {
    let discCb: ((r: { id: ArrayBuffer; techs: string[] }) => void) | null = null
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      getHCEState: (o: { success?: () => void }) => o.success && o.success(),
      getNFCAdapter: () => ({
        startDiscovery: (o?: { success?: () => void }) => { calls.push('startDiscovery'); o && o.success && o.success() },
        stopDiscovery: (o?: { success?: () => void }) => { o && o.success && o.success() },
        onDiscovered: (cb: (r: { id: ArrayBuffer; techs: string[] }) => void) => { discCb = cb },
        offDiscovered: () => undefined,
        getNdef: () => ({
          connect: (o?: { success?: () => void }) => o && o.success && o.success(),
          close: (o?: { success?: () => void }) => o && o.success && o.success(),
          isConnected: () => true,
          setTimeout: (o: { success?: () => void }) => o.success && o.success(),
          transceive: (o: { success?: (r: { data: ArrayBuffer }) => void }) => o.success && o.success({ data: new ArrayBuffer(2) }),
          writeNdefMessage: (o: { success?: () => void }) => { calls.push('writeNdef'); o.success && o.success() },
          onNdefMessage: () => undefined,
          offNdefMessage: () => undefined,
        }),
        getNfcA: () => ({ connect: (o?: { success?: () => void }) => o && o.success && o.success(), isConnected: () => false, transceive: (o: { success?: (r: { data: ArrayBuffer }) => void }) => o.success && o.success({ data: new ArrayBuffer(1) }) }),
      }),
    })
    const r = await createCapabilityHooks(createCapabilityBridge()).useNFC()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const adapter = r.data.getAdapter()
    let tag: { techs: string[] } | null = null
    adapter.onDiscovered((t) => { tag = t })
    expect((await adapter.startDiscovery()).ok).toBe(true)
    discCb!({ id: new ArrayBuffer(4), techs: ['ndef'] })
    expect(tag && tag.techs).toEqual(['ndef'])
    // 连接 NDEF + 写消息
    const ndef = await adapter.connectNdef()
    expect(ndef.ok).toBe(true)
    if (ndef.ok) {
      expect(ndef.data.isConnected()).toBe(true)
      expect((await ndef.data.writeNdefMessage({ records: [] })).ok).toBe(true)
      expect((await ndef.data.transceive(new ArrayBuffer(1))).ok).toBe(true)
    }
    // NfcA
    const a = await adapter.connectNfcA()
    expect(a.ok).toBe(true)
    expect(calls).toContain('startDiscovery')
    expect(calls).toContain('writeNdef')
  })

  it('缺 getNFCAdapter → 读卡操作 Err（诚实降级）', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }), getHCEState: (o: { success?: () => void }) => o.success && o.success() })
    const r = await createCapabilityHooks(createCapabilityBridge()).useNFC()
    if (!r.ok) return
    const adapter = r.data.getAdapter()
    expect((await adapter.startDiscovery()).ok).toBe(false)
    const ndef = await adapter.connectNdef()
    expect(ndef.ok).toBe(false)
    if (!ndef.ok) expect(ndef.error.code).toBe('nfc.unsupported')
  })
})

describe('★C4 地图剩余方法（查询/视野/覆盖物/图层）', () => {
  it('getCenterLocation/getRotate/fromScreenLocation/setBoundary/addVisualLayer 往返', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createMapContext: () => ({
        getCenterLocation: (o: { success?: (r: { latitude: number; longitude: number }) => void }) => { calls.push('center'); o.success && o.success({ latitude: 30, longitude: 120 }) },
        getRotate: (o: { success?: (r: { rotate: number }) => void }) => o.success && o.success({ rotate: 45 }),
        getSkew: (o: { success?: (r: { skew: number }) => void }) => o.success && o.success({ skew: 0 }),
        fromScreenLocation: (o: { success?: (r: { latitude: number; longitude: number }) => void }) => o.success && o.success({ latitude: 1, longitude: 2 }),
        toScreenLocation: (o: { success?: (r: { x: number; y: number }) => void }) => o.success && o.success({ x: 10, y: 20 }),
        setBoundary: (o: { success?: () => void }) => { calls.push('boundary'); o.success && o.success() },
        addVisualLayer: (o: { success?: () => void }) => { calls.push('visual'); o.success && o.success() },
        executeVisualLayerCommand: (o: { success?: (r: { result: string }) => void }) => o.success && o.success({ result: 'ok' }),
      }),
    })
    const r = await createCapabilityHooks(createCapabilityBridge()).useMap('m')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const map = r.data
    for (const m of ['getCenterLocation', 'getRotate', 'getSkew', 'fromScreenLocation', 'toScreenLocation', 'setBoundary', 'moveAlong', 'addArc', 'eraseLines', 'initMarkerCluster', 'setLocMarkerIcon', 'addCustomLayer', 'removeCustomLayer', 'addVisualLayer', 'removeVisualLayer', 'executeVisualLayerCommand', 'addGroundOverlay', 'updateGroundOverlay', 'removeGroundOverlay']) {
      expect(typeof (map as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    expect((await map.getCenterLocation()).data).toMatchObject({ latitude: 30, longitude: 120 })
    const rot = await map.getRotate()
    expect(rot.ok && rot.data).toBe(45)
    expect((await map.fromScreenLocation(5, 6)).ok).toBe(true)
    expect((await map.setBoundary([{ latitude: 1, longitude: 2 }])).ok).toBe(true)
    expect((await map.addVisualLayer({ id: 'v1', type: 'marker' })).ok).toBe(true)
    const cmd = await map.executeVisualLayerCommand({ layerId: 'v1', command: 'update' })
    expect(cmd.ok && cmd.data).toBe('ok')
    expect(calls).toContain('boundary')
  })
})

describe('★C3 颗粒度对齐：C52 相册 / C53 Worker', () => {
  it('useAlbum：picker 选择 + saveImage 保存 + preview（wx 桥归一为 Result）', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      chooseMedia: (o: { mediaType: string[]; success?: (r: { tempFiles: Array<{ tempFilePath: string; size: number; width: number; height: number }> }) => void }) => {
        calls.push('pick:' + o.mediaType.join(','))
        o.success && o.success({ tempFiles: [{ tempFilePath: '/tmp/a.jpg', size: 1024, width: 100, height: 80 }] })
      },
      saveImageToPhotosAlbum: (o: { filePath: string; success?: () => void }) => { calls.push('save:' + o.filePath); o.success && o.success() },
      previewMedia: (o: { urls: string[]; success?: () => void }) => { calls.push('preview:' + o.urls.length); o.success && o.success() },
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useAlbum()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const album = r.data
    const picked = await album.pick({ count: 3, mediaType: 'image' })
    expect(picked.ok).toBe(true)
    if (picked.ok) expect(picked.data[0]).toMatchObject({ tempFilePath: '/tmp/a.jpg', type: 'image', size: 1024 })
    expect((await album.saveImage('/tmp/a.jpg')).ok).toBe(true)
    expect((await album.preview(['/tmp/a.jpg'])).ok).toBe(true)
    expect(calls).toEqual(['pick:image', 'save:/tmp/a.jpg', 'preview:1'])
  })

  it('useAlbum：无 wx.chooseMedia → Err(album.unsupported) 诚实降级', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const r = createCapabilityHooks(createCapabilityBridge()).useAlbum()
    // 桥存在（getAlbum 常在）→ 句柄可建；pick 调用时才缺 wx.chooseMedia → Err
    expect(r.ok).toBe(true)
    if (r.ok) return expect(r.data.pick()).resolves.toMatchObject({ ok: false, error: { code: 'album.unsupported' } })
  })

  it('useWorker：postMessage/onMessage/terminate 往返（wx.createWorker）', () => {
    const calls: string[] = []
    let onMsg: ((m: unknown) => void) | null = null
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createWorker: () => ({
        postMessage: (m: unknown) => calls.push('post:' + String(m)),
        onMessage: (cb: (m: unknown) => void) => { onMsg = cb },
        terminate: () => calls.push('terminate'),
      }),
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useWorker('workers/sum.js')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const w = r.data
    w.postMessage({ n: 3 })
    const got: unknown[] = []
    w.onMessage((m) => got.push(m))
    expect(onMsg).not.toBeNull()
    ;(onMsg as unknown as (m: unknown) => void)({ sum: 6 })
    expect(got).toEqual([{ sum: 6 }])
    w.terminate()
    expect(calls).toEqual(['post:[object Object]', 'terminate'])
  })

  it('useWorker：无 wx.createWorker → Err(worker.unsupported)', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const r = createCapabilityHooks(createCapabilityBridge()).useWorker('w.js')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('worker.unsupported')
  })

  it('probe：album / worker 维度反映桥方法存在（调用期再判平台支持——同既有权能约定）', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    return createCapabilityHooks(createCapabilityBridge()).probe().then((p) => {
      // probe 语义 = 桥方法是否注册（wx 桥恒注册 getAlbum/createWorker，缺平台 API 在调用期抛 → Err）
      expect(p.album).toBe(true)
      expect(p.worker).toBe(true)
    })
  })
})

describe('★C3 批 2 颗粒度对齐：C54 收货地址 / C55 WiFi / C56 微信运动', () => {
  it('useAddress：wx.chooseAddress 归一（含 optional 字段）', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      chooseAddress: (o: { success: (r: Record<string, string>) => void }) =>
        o.success({ userName: '张三', provinceName: '浙江省', cityName: '杭州市', countyName: '西湖区', detailInfo: '文三路 1 号', telNumber: '13800000000' }),
    })
    const r = await createCapabilityHooks(createCapabilityBridge()).useAddress()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ userName: '张三', cityName: '杭州市', telNumber: '13800000000' })
  })

  it('useAddress：无 wx.chooseAddress → Err(address.unsupported)', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const r = await createCapabilityHooks(createCapabilityBridge()).useAddress()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('address.unsupported')
  })

  it('useWifi：getConnected + list + connect（wx 桥归一）', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      getConnectedWifi: (o: { success: (r: unknown) => void }) => o.success({ wifi: { SSID: 'Home', BSSID: 'aa', secure: true, signalStrength: -50, frequency: 5180 } }),
      startWifi: () => { calls.push('start') },
      getWifiList: () => { calls.push('getList') },
      onGetWifiList: (cb: (r: unknown) => void) => cb({ wifiList: [{ SSID: 'A', BSSID: 'a', secure: false, signalStrength: -30 }] }),
      connectWifi: (o: { SSID: string; success?: () => void }) => { calls.push('connect:' + o.SSID); o.success && o.success() },
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useWifi()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const wifi = r.data
    const conn = await wifi.getConnected()
    expect(conn.ok && conn.data.SSID).toBe('Home')
    const list = await wifi.list()
    expect(list.ok && list.data[0].SSID).toBe('A')
    expect((await wifi.connect('A', 'pw')).ok).toBe(true)
    expect(calls).toContain('connect:A')
  })

  it('useWifi：无 wx.getConnectedWifi → 句柄 pick 时 Err(wifi.unsupported)', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const r = createCapabilityHooks(createCapabilityBridge()).useWifi()
    expect(r.ok).toBe(true)
    if (r.ok) expect((await r.data.getConnected()).ok).toBe(false)
  })

  it('useWeRun：wx.getWeRunData → encryptedData/iv', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      getWeRunData: (o: { success: (r: { encryptedData: string; iv: string }) => void }) => o.success({ encryptedData: 'ENC', iv: 'IV' }),
    })
    const r = await createCapabilityHooks(createCapabilityBridge()).useWeRun()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ encryptedData: 'ENC', iv: 'IV' })
  })

  it('probe：address/wifi/weRun 维度反映桥方法', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const p = await createCapabilityHooks(createCapabilityBridge()).probe()
    expect(p.address).toBe(true)
    expect(p.wifi).toBe(true)
    expect(p.weRun).toBe(true)
  })
})

describe('★组件实例 API 对齐（2026-09-12）· C57 useCanvas', () => {
  /** 真·小程序环境 + Canvas 组件实例 wx mock（记录调用） */
  function stubMpCanvas() {
    const calls: string[] = []
    const drawCalls: string[] = []
    const ctxLike: Record<string, unknown> = {
      setFillStyle: (c: string) => drawCalls.push('fill:' + c),
      setFontSize: (s: number) => drawCalls.push('font:' + s),
      beginPath: () => drawCalls.push('beginPath'),
      arc: (...a: number[]) => drawCalls.push('arc:' + a.length),
      fill: () => drawCalls.push('fill'),
      measureText: (t: string) => ({ width: t.length * 6 }),
      draw: (reserve?: boolean | (() => void), cb?: () => void) => { calls.push('draw'); const d = typeof reserve === 'function' ? reserve : cb; d && d() },
    }
    const node = { width: 300, height: 150, getContext: () => ctxLike, requestAnimationFrame: (cb: (t: number) => void) => { cb(1); return 1 } }
    const wx = {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createCanvasContext: (id: string) => { calls.push('ctx:' + id); return ctxLike },
      createSelectorQuery: () => ({
        select: () => ({ fields: () => {} }),
        exec: (cb: (res: unknown) => void) => { calls.push('exec'); cb([{ node }]) },
      }),
      canvasToTempFilePath: (opt: { success: (r: { tempFilePath: string }) => void }) => { calls.push('toTemp'); opt.success({ tempFilePath: 'wxfile://tmp/a.png' }) },
      getFileSystemManager: () => ({ readFile: (opt: { success: (r: { data: string }) => void }) => opt.success({ data: 'BASE64' }) }),
      createOffscreenCanvas: (o: { width: number; height: number }) => ({ width: o.width, height: o.height, getContext: () => ctxLike }),
    }
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', wx)
    return { calls, drawCalls }
  }

  it('返回句柄含 id/createContext/node/toTempFilePath/toDataURL/offscreen', () => {
    stubMpCanvas()
    const r = createCapabilityHooks(createCapabilityBridge()).useCanvas('myCanvas')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const c = r.data
    expect(c.id).toBe('myCanvas')
    for (const m of ['createContext', 'node', 'toTempFilePath', 'toDataURL', 'offscreen']) {
      expect(typeof (c as unknown as Record<string, unknown>)[m]).toBe('function')
    }
  })

  it('createContext：绘图方法逐一对齐官方 CanvasContext（可调用）', () => {
    stubMpCanvas()
    const r = createCapabilityHooks(createCapabilityBridge()).useCanvas('c1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const ctx = r.data.createContext()
    expect(ctx.ok).toBe(true)
    if (!ctx.ok) return
    for (const m of ['setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setGlobalAlpha', 'setShadow', 'setLineDash', 'setFontSize', 'setTextAlign', 'save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'measureText', 'drawImage', 'createLinearGradient', 'createCircularGradient', 'createPattern', 'draw']) {
      expect(typeof (ctx.data as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    // 真实往返：设置样式 + 画弧 + 提交
    ctx.data.setFillStyle('#f00')
    ctx.data.arc(10, 10, 5, 0, Math.PI * 2)
    ctx.data.fill()
    expect(ctx.data.measureText('abcd').width).toBe(24)
    let drawn = false
    ctx.data.draw(() => { drawn = true })
    expect(drawn).toBe(true)
  })

  it('node()：SelectorQuery fields({node}) → CanvasNode（宽高/取上下文）', async () => {
    stubMpCanvas()
    const r = createCapabilityHooks(createCapabilityBridge()).useCanvas('c2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const n = await r.data.node()
    expect(n.ok).toBe(true)
    if (n.ok) {
      expect(n.data.width).toBe(300)
      expect(n.data.height).toBe(150)
      expect(typeof n.data.getContext).toBe('function')
    }
  })

  it('toTempFilePath / toDataURL：导出临时文件 + base64 data URL', async () => {
    stubMpCanvas()
    const r = createCapabilityHooks(createCapabilityBridge()).useCanvas('c3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const t = await r.data.toTempFilePath({ fileType: 'png' })
    expect(t.ok && t.data).toBe('wxfile://tmp/a.png')
    const d = await r.data.toDataURL()
    expect(d.ok && d.data.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('offscreen：离屏画布尺寸与上下文', () => {
    stubMpCanvas()
    const r = createCapabilityHooks(createCapabilityBridge()).useCanvas('c4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const off = r.data.offscreen(128, 64)
    expect(off.ok).toBe(true)
    if (off.ok) {
      expect(off.data.width).toBe(128)
      expect(off.data.height).toBe(64)
      expect(off.data.getContext('2d')).toBeTruthy()
    }
  })

  it('无 wx.createCanvasContext → createContext Err（诚实降级）', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const r = createCapabilityHooks(createCapabilityBridge()).useCanvas('c5')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.createContext().ok).toBe(false)
  })

  it('probe：canvas 维度反映桥方法', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const p = await createCapabilityHooks(createCapabilityBridge()).probe()
    expect(p.canvas).toBe(true)
  })
})

describe('★组件实例 API 对齐（2026-09-12）· C58/C59/C60 元素查询 / 交叉观察 / 媒体查询', () => {
  it('useElement：selectorQuery 几何查询（wx 桥归一）', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createSelectorQuery: () => ({
        select: (sel: string) => {
          calls.push(sel)
          return {
            boundingClientRect: () => {},
            scrollOffset: () => {},
            fields: (o: Record<string, unknown>) => { calls.push('fields:' + Object.keys(o).join(',')) },
          }
        },
        exec: (cb: (res: unknown) => void) => cb([{ id: 'box', width: 120, height: 40, top: 10, left: 5, right: 125, bottom: 50 }]),
      }),
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useElement('box')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rect = await r.data.boundingClientRect()
    expect(rect.ok && rect.data.width).toBe(120)
    const size = await r.data.size()
    expect(size.ok && size.data.height).toBe(40)
    const fields = await r.data.fields({ node: true, rect: true })
    expect(fields.ok).toBe(true)
    expect(calls).toContain('#box')
    expect(calls.some((c) => c.startsWith('fields:node,rect'))).toBe(true)
  })

  it('useIntersection：observe → 相交回调（wx 桥归一）', () => {
    let captured: ((res: unknown) => void) | undefined
    const observed: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createIntersectionObserver: () => ({
        relativeToViewport: () => undefined,
        observe: (targetSelector: string, cb: (res: unknown) => void) => { observed.push(targetSelector); captured = cb },
        disconnect: () => { observed.push('disconnect') },
      }),
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useIntersection({ thresholds: [0.5] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    let hit: unknown
    r.data.relativeToViewport().observe('.item', (res) => { hit = res })
    expect(observed).toContain('.item')
    captured!({ intersectionRatio: 0.8, time: 123 })
    expect(hit).toMatchObject({ intersectionRatio: 0.8, time: 123 })
    r.data.disconnect()
    expect(observed).toContain('disconnect')
  })

  it('useMediaQuery：observe 宽高条件 → matches（wx 桥归一）', () => {
    let cb: ((res: { matches: boolean }) => void) | undefined
    let seenCond: Record<string, unknown> | undefined
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createMediaQueryObserver: () => ({
        observe: (cond: Record<string, unknown>, c: (res: { matches: boolean }) => void) => { seenCond = cond; cb = c },
        disconnect: () => undefined,
      }),
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useMediaQuery()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    let matched: boolean | undefined
    r.data.observe({ minWidth: 600, orientation: 'landscape' }, (res) => { matched = res.matches })
    expect(seenCond).toMatchObject({ minWidth: 600, orientation: 'landscape' })
    cb!({ matches: true })
    expect(matched).toBe(true)
  })

  it('无 wx 组件实例 API → 三件套句柄方法级 Err（诚实降级）', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const hooks = createCapabilityHooks(createCapabilityBridge())
    const el = hooks.useElement('x')
    expect(el.ok).toBe(true)
    if (el.ok) expect((await el.data.boundingClientRect()).ok).toBe(false)
    const io = hooks.useIntersection()
    expect(io.ok).toBe(true) // 句柄构造成功但 observe 无回调
    const mq = hooks.useMediaQuery()
    expect(mq.ok).toBe(true)
    if (mq.ok) {
      let matched: boolean | undefined
      mq.data.observe({ minWidth: 100 }, (res) => { matched = res.matches })
      expect(matched).toBe(false)
    }
  })

  it('probe：element/intersection/mediaQuery 维度反映桥方法', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const p = await createCapabilityHooks(createCapabilityBridge()).probe()
    expect(p.element).toBe(true)
    expect(p.intersection).toBe(true)
    expect(p.mediaQuery).toBe(true)
  })
})

describe('★组件实例 API 对齐（2026-09-12）· C61/C62/C63 媒体组件实例 + C64 广告', () => {
  it('useVideo：play/pause/seek/倍速/全屏/弹幕 + 事件（wx 桥归一）', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createVideoContext: () => ({
        play: () => calls.push('play'),
        pause: () => calls.push('pause'),
        seek: (p: number) => calls.push('seek:' + p),
        playbackRate: (r: number) => calls.push('rate:' + r),
        requestFullScreen: (o: { direction?: string }) => calls.push('fs:' + (o?.direction ?? '')),
        sendDanmu: (d: { text: string }) => calls.push('danmu:' + d.text),
        onPlay: () => undefined,
      }),
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useVideo('v1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await expect(r.data.play()).resolves.toMatchObject({ ok: true })
    await expect(r.data.seek(12)).resolves.toMatchObject({ ok: true })
    await expect(r.data.playbackRate(1.5)).resolves.toMatchObject({ ok: true })
    await expect(r.data.requestFullScreen({ direction: 'horizontal' })).resolves.toMatchObject({ ok: true })
    await expect(r.data.sendDanmu({ text: 'hi' })).resolves.toMatchObject({ ok: true })
    expect(calls).toEqual(['play', 'seek:12', 'rate:1.5', 'fs:horizontal', 'danmu:hi'])
  })

  it('useAudio：play/pause/seek/音量/循环 + 时长（wx 桥归一）', async () => {
    const ac: Record<string, unknown> = { duration: 30, currentTime: 3, paused: true }
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createInnerAudioContext: () => ({
        play: () => calls.push('play'),
        pause: () => calls.push('pause'),
        seek: (p: number) => calls.push('seek:' + p),
        destroy: () => calls.push('destroy'),
        get duration() { return ac.duration },
        get currentTime() { return ac.currentTime },
        get paused() { return ac.paused },
        set volume(v: number) { ac.volume = v; calls.push('vol:' + v) },
        set loop(v: boolean) { ac.loop = v; calls.push('loop:' + v) },
      }),
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useAudio('a.mp3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.duration).toBe(30)
    expect(r.data.paused).toBe(true)
    await expect(r.data.play()).resolves.toMatchObject({ ok: true })
    await expect(r.data.seek(5)).resolves.toMatchObject({ ok: true })
    r.data.setVolume(0.5)
    r.data.setLoop(true)
    r.data.destroy()
    expect(calls).toEqual(['play', 'seek:5', 'vol:0.5', 'loop:true', 'destroy'])
  })

  it('useLivePusher：start/stop/snapshot/SEI + 事件（wx 桥归一）', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createLivePusherContext: () => ({
        start: (o: { success?: () => void }) => { calls.push('start'); o.success && o.success() },
        stop: (o: { success?: () => void }) => { calls.push('stop'); o.success && o.success() },
        snapshot: (o: { success: (r: { tempImagePath: string }) => void }) => { calls.push('snap'); o.success({ tempImagePath: 'wxfile://tmp/p.png' }) },
        sendMessage: (o: { msg: string; success?: () => void }) => { calls.push('sei:' + o.msg); o.success && o.success() },
      }),
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useLivePusher('pusher')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await expect(r.data.start()).resolves.toMatchObject({ ok: true })
    const snap = await r.data.snapshot()
    expect(snap.ok && snap.data).toBe('wxfile://tmp/p.png')
    await expect(r.data.sendMessage('hello')).resolves.toMatchObject({ ok: true })
    await expect(r.data.stop()).resolves.toMatchObject({ ok: true })
    expect(calls).toEqual(['start', 'snap', 'sei:hello', 'stop'])
  })

  it('useAd：激励视频 load/show/onClose 激励判定（wx 桥归一 + 同 id 复用）', async () => {
    let closeCb: ((res: { isEnded: boolean }) => void) | undefined
    const calls: string[] = []
    let created = 0
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      createRewardedVideoAd: () => { created++; return {
        load: () => { calls.push('load'); return Promise.resolve() },
        show: () => { calls.push('show'); return Promise.resolve() },
        onClose: (cb: (res: { isEnded: boolean }) => void) => { closeCb = cb },
        destroy: () => calls.push('destroy'),
      } },
    })
    const r = createCapabilityHooks(createCapabilityBridge()).useAd()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const ad = r.data.rewardedVideo('adunit-1')
    const adAgain = r.data.rewardedVideo('adunit-1')
    expect(created).toBe(1) // 同 id 复用
    expect(ad).toBe(adAgain)
    let ended: boolean | undefined
    ad.onClose((res) => { ended = res.isEnded })
    await expect(ad.load()).resolves.toMatchObject({ ok: true })
    await expect(ad.show()).resolves.toMatchObject({ ok: true })
    closeCb!({ isEnded: true })
    expect(ended).toBe(true)
    expect(calls).toContain('show')
  })

  it('web 端 useAd：无广告联盟 → 创建时 throw（诚实降级）', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('wx', undefined)
    const r = createCapabilityHooks(createCapabilityBridge()).useAd()
    expect(r.ok).toBe(true)
    if (r.ok) expect(() => r.data.rewardedVideo('x')).toThrow()
  })

  it('web 端 useLivePusher：无标准推流 → 各方法 Err', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('wx', undefined)
    const r = createCapabilityHooks(createCapabilityBridge()).useLivePusher('p')
    expect(r.ok).toBe(true)
    if (r.ok) expect((await r.data.start()).ok).toBe(false)
  })

  it('probe：video/audio/livePusher/ad 维度反映桥方法', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    const p = await createCapabilityHooks(createCapabilityBridge()).probe()
    expect(p.video).toBe(true)
    expect(p.audio).toBe(true)
    expect(p.livePusher).toBe(true)
    expect(p.ad).toBe(true)
  })
})
