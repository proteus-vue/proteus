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

  it('缺桥 → useCameraContext/useRecorder 抛错（句柄类惯例）', () => {
    vi.stubGlobal('window', {})
    const hooks = createCapabilityHooks(createCapabilityBridge())
    // web 桥有 createCameraContext/getRecorder（返回 Err 句柄）；此处用空桥验证抛错路径
    const bare = { getLocation: async () => ({ latitude: 0, longitude: 0 }), vibrate: async () => {}, getNetwork: async () => ({ online: true, type: 'unknown' as const }), readClipboard: async () => '', setClipboard: async () => {}, getScreen: async () => ({ width: 0, height: 0, dpr: 1, orientation: 'portrait' as const }), getDevice: async () => ({ platform: 'web', model: '', os: '', version: '' }), getBattery: async () => ({ level: 1, charging: true }), getOrientation: async () => ({ type: 'portrait' as const, angle: 0 }), share: async () => {} }
    const h2 = createCapabilityHooks(bare)
    expect(() => h2.useCameraContext('x')).toThrow(/createCameraContext/)
    expect(() => h2.useRecorder()).toThrow(/getRecorder/)
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
