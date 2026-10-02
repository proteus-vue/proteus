// VC0 装置：全局结果账本（页面写、automation_evaluate 读——同一逻辑层上下文）
App({
  globalData: {
    __VC0__: {
      env: null,
      runs: []
    }
  },
  onLaunch() {
    try {
      const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
      // 记录环境（平台/基础库/渲染器判定）
      this.globalData.__VC0__.env = {
        platform: info.platform,
        system: info.system,
        SDKVersion: info.SDKVersion,
        version: info.version,
        renderer: info.renderer,           // 页面渲染模式（skyline / webview）
        isDevtools: !!(info.platform && String(info.platform).toLowerCase().indexOf('devtools') >= 0),
        deviceOrientation: info.deviceOrientation,
        screen: info.screenWidth + 'x' + info.screenHeight,
        windowSize: info.windowWidth + 'x' + info.windowHeight,
        pixelRatio: info.pixelRatio
      }
      console.log('[VC0-ENV] ' + JSON.stringify(this.globalData.__VC0__.env))
    } catch (e) {
      console.log('[VC0-ENV-ERR] ' + String(e))
    }
  }
})
