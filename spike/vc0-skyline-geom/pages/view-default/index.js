Page({
  data: { list: [{ id: 1, w: 40, title: 'row 1' }, { id: 2, w: 88, title: 'row 2' }] },
  onReady() {
    const q = wx.createSelectorQuery()
    q.select('#rA-1').boundingClientRect()
    q.select('#chipA-1').boundingClientRect()
    q.select('#txtA-1').boundingClientRect()
    q.select('#dotA-1').boundingClientRect()
    q.select('#chipA-2').boundingClientRect()
    q.exec((rs) => {
      const f = (r) => r ? `(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})` : 'null'
      console.log('[R] row=' + f(rs[0]) + ' chip1=' + f(rs[1]) + ' txt=' + f(rs[2]) + ' dot=' + f(rs[3]) + ' chip2=' + f(rs[4]))
    })
  }
})
