// website/src/playground/share.ts —— Playground 分享链接（B3 验收：分享链接可复现）
// 源码 → UTF-8 bytes → base64 → URL query（encodeURIComponent 兜底 +/= 字符）

export function encodeSource(src: string): string {
  const bytes = new TextEncoder().encode(src)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function decodeSource(enc: string): string {
  const bin = atob(enc)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 生成可复现的分享 URL（route path + ?code=） */
export function playgroundUrl(origin: string, path: string, src: string): string {
  return `${origin}${path}?code=${encodeURIComponent(encodeSource(src))}`
}
