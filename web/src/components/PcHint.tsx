import { useEffect, useState } from 'react'

/**
 * PlaceCal is made for phones. On a wide (PC) screen the app is shown phone-sized, and this
 * panel offers a QR code to open the same page on the phone. Hidden by CSS below 900px.
 */
export function PcHint() {
  const [qr, setQr] = useState('')
  const url = location.origin + location.pathname

  useEffect(() => {
    if (!window.matchMedia('(min-width: 900px)').matches) return
    // loaded only on PCs, so phones never download the QR library
    import('qrcode')
      .then((QR) => QR.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }))
      .then(setQr)
      .catch(() => {})
  }, [url])

  return (
    <aside className="pc-hint" aria-label="スマートフォンで開く">
      <h2>スマートフォンで使うアプリです</h2>
      {qr && <img src={qr} alt="このページを開くQRコード" />}
      <p>iPhone のカメラで読み取って Safari で開き、共有ボタン →「ホーム画面に追加」すると、アプリとして使えます。</p>
      <code>{url}</code>
    </aside>
  )
}
