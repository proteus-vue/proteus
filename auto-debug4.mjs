process.on('unhandledRejection', (e) => console.log('UNHANDLED:', JSON.stringify(e)))
import automator from 'miniprogram-automator'
try {
  const mini = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  console.log('CONNECTED OK')
  const page = await mini.reLaunch('/pages/index/index')
  await page.waitFor(1000)
  const d = await page.data()
  console.log('DATA title:', d.title)
  mini.disconnect()
} catch (e) {
  console.log('CATCH:', e?.message ?? JSON.stringify(e))
}
