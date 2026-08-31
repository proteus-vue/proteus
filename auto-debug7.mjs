process.on('unhandledRejection', (e) => console.log('UNHANDLED:', e?.message ?? String(e)))
import automator from 'miniprogram-automator'
try {
  const mini = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  console.log('CONNECTED OK')
  const page = await mini.currentPage()
  console.log('PAGE:', page.path, page.id)
  const d = await page.data()
  console.log('DATA title:', d.title)
  console.log('DATA sample:', JSON.stringify(d).slice(0, 200))
  mini.disconnect()
  console.log('DONE')
} catch (e) {
  console.log('CATCH:', e?.message ?? e?.errMsg ?? String(e))
}
