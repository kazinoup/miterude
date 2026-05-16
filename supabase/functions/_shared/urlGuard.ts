// 送信先 URL の SSRF ガード（通知系 Edge Function 共通）
//
// テナント設定 / リクエスト由来の任意 URL を service_role 権限の Edge Function
// から fetch する前に検証する。クラウドメタデータ（169.254.169.254 等）や
// 内部ネットワーク（RFC1918 / localhost）への到達を防ぐ。
// 完全な DNS rebinding 対策ではないが、主要な SSRF ベクトルを塞ぐ。

function isPrivateOrReservedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true
  }
  if (h === 'metadata.google.internal') return true
  // IPv6
  if (h === '::1') return true
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h)) return true // unique local fc00::/7
  if (/^fe80:/i.test(h)) return true // link-local
  // IPv4 リテラル
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const o = m.slice(1).map(Number)
    if (o.some((n) => n > 255)) return true
    const [a, b] = o
    if (a === 10) return true // 10.0.0.0/8
    if (a === 127) return true // loopback
    if (a === 0) return true // 0.0.0.0/8
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  }
  return false
}

/**
 * 外部送信先 URL を検証する。問題があれば throw（呼び出し側で catch して
 * delivery を failed にする想定）。
 * @param raw  検証する URL 文字列
 * @param opts.allowHosts 指定時はこのホスト（またはサブドメイン）のみ許可
 */
export function assertSafeOutboundUrl(
  raw: string,
  opts: { allowHosts?: string[] } = {},
): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('invalid-url')
  }
  if (u.protocol !== 'https:') {
    throw new Error('url-must-be-https')
  }
  const host = u.hostname.toLowerCase()
  if (opts.allowHosts && opts.allowHosts.length > 0) {
    const ok = opts.allowHosts.some(
      (allowed) => host === allowed || host.endsWith('.' + allowed),
    )
    if (!ok) throw new Error('host-not-allowed')
  }
  if (isPrivateOrReservedHost(host)) {
    throw new Error('host-is-private-or-reserved')
  }
  return u
}
