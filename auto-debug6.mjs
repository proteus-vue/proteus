process.on('unhandledRejection', (e) => console.log('UNHANDLED:', e?.message ?? String(e)))
import automator from 'miniprogram-automator'
try {
  const mini = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  console.log('CONNECTED OK')
  const page = await mini.reLaunch('/pages/index')
  await page.waitFor(1500)
  const d = await page.data()
  console.log('DATA title:', d.title, '| keys:', Object.keys(d).slice(0, 8).join(','))
  mini.disconnect()
  console.log('DONE')
} catch (e) {
  console.log('CATCH:', e?.message ?? e?.errMsg ?? String(e))
}
