import automator from 'miniprogram-automator'
try {
  const mini = await automator.launch({
    cliPath: '/Volumes/data1/work/office-applications/wechatwebdevtools.app/Contents/MacOS/cli',
    projectPath: '/Volumes/data1/work/office/debug/proteus/examples/dist/mp-weixin',
    trustProject: true,
    port: 9422,
    timeout: 60000,
  })
  console.log('LAUNCHED OK')
  const page = await mini.reLaunch('/pages/index/index')
  await page.waitFor(1000)
  const d = await page.data()
  console.log('DATA title:', d.title)
  mini.disconnect()
} catch (e) {
  console.log('ERR KEYS:', Object.keys(e ?? {}))
  console.log('ERR MSG:', e?.message ?? e)
  console.log('ERR JSON:', JSON.stringify(e, null, 1)?.slice(0, 800))
}
