// PlaceCal ウィジェット for Scriptable (iOS)
//
// 使い方
//  1. iPhone に「Scriptable」(無料) を入れる
//  2. このスクリプトを Scriptable に新規スクリプトとして貼り付けて保存（名前: PlaceCal）
//  3. ホーム画面を長押し →「＋」→ Scriptable → 小/中/大 を追加
//  4. 追加したウィジェットを長押し →「ウィジェットを編集」→ Script: PlaceCal
//     （PCのアドレスが変わったときは Parameter に http://<PCのIP>:3001 を入れると上書きできます）
//
// サーバーに届く必要があります（公開サーバー、または同じ Wi-Fi / テザリング中で PC が起動中）。
// ログインありのサーバーでは、アプリのアカウントメニュー「iPhoneウィジェット」からこのスクリプトを開いてください。
// 届かないときは、最後に取得した内容を「最終更新」付きで表示します。

const SERVER = (args.widgetParameter || '__SERVER__').trim().replace(/\/$/, '')
// Read-only widget token (embedded when downloaded from the app's account menu). Keep this script private.
const TOKEN = '__TOKEN__'
const REFRESH_MIN = 15

// ---------- colors (light / dark) ----------
const dyn = (l, d) => Color.dynamic(new Color(l), new Color(d))
const C = {
  bg: dyn('#f6f6f3', '#141414'),
  card: dyn('#ffffff', '#1e1e1f'),
  ink: dyn('#1d1d1f', '#f1f1ef'),
  ink2: dyn('#55565b', '#b4b4b0'),
  ink3: dyn('#8a8b90', '#85857f'),
  today: dyn('#d9480f', '#ff8a4c'),
}

// ---------- helpers ----------
const WD = ['日', '月', '火', '水', '木', '金', '土']
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const md = (s) => { const x = parse(s); return `${x.getMonth() + 1}/${x.getDate()}(${WD[x.getDay()]})` }
function dayLabel(date, today) {
  if (date === today) return '今日'
  const diff = Math.round((parse(date) - parse(today)) / 86400000)
  if (diff === 1) return '明日'
  return md(date)
}
const yen = (n) => '¥' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const hours = (min) => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}時間${m}分` : `${h}時間` }
const timeOf = (e) => (e.startTime ? `${e.startTime}〜${e.endTime}` : '終日')
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// ---------- data (with offline cache) ----------
const fm = FileManager.local()
const cachePath = fm.joinPath(fm.documentsDirectory(), 'placecal-widget.json')

async function load() {
  try {
    const req = new Request(SERVER + '/api/widget')
    req.timeoutInterval = 8
    if (TOKEN && !TOKEN.startsWith('__')) req.headers = { Authorization: 'Bearer ' + TOKEN }
    const data = await req.loadJSON()
    if (!data || !data.days) throw new Error((data && data.error && data.error.message) || '応答が正しくありません')
    data.fetchedAt = Date.now()
    fm.writeString(cachePath, JSON.stringify(data))
    return { data, offline: false }
  } catch (e) {
    if (fm.fileExists(cachePath)) return { data: JSON.parse(fm.readString(cachePath)), offline: true }
    return { data: null, offline: true, error: String(e) }
  }
}

/** Upcoming events (skips ones already finished today). */
function upcoming(data, limit) {
  const out = []
  for (const day of data.days) {
    for (const e of day.events) {
      if (day.date === data.today && e.endTime && e.endTime <= data.now) continue
      out.push(e)
      if (out.length >= limit) return out
    }
  }
  return out
}

// ---------- building blocks ----------
function text(stack, s, size, color, weight = 'regular') {
  const t = stack.addText(s)
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semibold' ? Font.semiboldSystemFont(size) : Font.systemFont(size)
  t.textColor = color
  t.lineLimit = 1
  t.minimumScaleFactor = 0.7
  return t
}

function bar(stack, color, h) {
  const b = stack.addStack()
  b.size = new Size(4, h)
  b.backgroundColor = new Color(color)
  b.cornerRadius = 2
}

function nextShiftBlock(stack, data) {
  text(stack, '次のシフト', 11, C.ink3, 'semibold')
  stack.addSpacer(4)
  const s = data.nextShift
  if (!s) {
    text(stack, '予定なし', 15, C.ink2, 'semibold')
    return
  }
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  bar(row, s.color, 44)
  row.addSpacer(8)
  const col = row.addStack()
  col.layoutVertically()
  const isToday = s.date === data.today
  text(col, dayLabel(s.date, data.today), 15, isToday ? C.today : C.ink, 'bold')
  text(col, timeOf(s), 13, C.ink, 'semibold')
  text(col, s.jobName || s.title, 11, C.ink2)
}

function salaryBlock(stack, data) {
  const m = Number(data.salary.month.slice(5))
  text(stack, `${m}月の給料見込み`, 10, C.ink3)
  text(stack, yen(data.salary.total), 18, C.ink, 'bold')
}

function eventRow(stack, e, data) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  bar(row, e.color, 26)
  row.addSpacer(6)
  const col = row.addStack()
  col.layoutVertically()
  const when = `${dayLabel(e.date, data.today)} ${e.startTime || '終日'}`
  text(col, when, 10, e.date === data.today ? C.today : C.ink3, 'semibold')
  text(col, e.title, 12, C.ink, 'semibold')
}

function footer(widget, data, offline) {
  if (!offline || !data.fetchedAt) return
  widget.addSpacer(2)
  text(widget, `最終更新 ${hhmm(new Date(data.fetchedAt))}（接続できません）`, 9, C.ink3)
}

// ---------- widgets ----------
function buildError(widget, error) {
  text(widget, 'PlaceCal', 13, C.ink, 'bold')
  widget.addSpacer(4)
  const t = widget.addText('サーバーに接続できません')
  t.font = Font.semiboldSystemFont(12)
  t.textColor = C.today
  widget.addSpacer(2)
  const h = widget.addText(`${SERVER}\nPCでPlaceCalが起動していて、同じWi-Fi（テザリング）にいるか確認してください。`)
  h.font = Font.systemFont(10)
  h.textColor = C.ink2
}

function buildSmall(widget, data) {
  nextShiftBlock(widget, data)
  widget.addSpacer()
  salaryBlock(widget, data)
}

function buildMedium(widget, data, rows = 3) {
  const top = widget.addStack()
  top.layoutHorizontally()
  const left = top.addStack()
  left.layoutVertically()
  left.size = new Size(128, 0)
  nextShiftBlock(left, data)
  left.addSpacer()
  salaryBlock(left, data)
  top.addSpacer(12)
  const right = top.addStack()
  right.layoutVertically()
  text(right, 'これからの予定', 11, C.ink3, 'semibold')
  right.addSpacer(4)
  const list = upcoming(data, rows)
  if (!list.length) text(right, '1週間、予定はありません', 12, C.ink2)
  list.forEach((e, i) => { if (i) right.addSpacer(5); eventRow(right, e, data) })
  right.addSpacer()
}

function buildLarge(widget, data) {
  buildMedium(widget, data, 3)
  widget.addSpacer(10)
  text(widget, '1週間', 11, C.ink3, 'semibold')
  widget.addSpacer(4)
  let shown = 0
  for (const day of data.days) {
    if (shown >= 7) break
    const row = widget.addStack()
    row.layoutHorizontally()
    row.centerAlignContent()
    const label = row.addStack()
    label.size = new Size(64, 0)
    text(label, day.date === data.today ? '今日' : md(day.date), 11, day.date === data.today ? C.today : C.ink2, 'semibold')
    const evs = day.events
    if (!evs.length) text(row, '—', 11, C.ink3)
    evs.slice(0, 3).forEach((e, i) => {
      if (i) row.addSpacer(6)
      const chip = row.addStack()
      chip.backgroundColor = new Color(e.color)
      chip.cornerRadius = 4
      chip.setPadding(1, 5, 1, 5)
      const t = chip.addText(`${e.startTime ? e.startTime + ' ' : ''}${e.title}`)
      t.font = Font.semiboldSystemFont(10)
      t.textColor = Color.white()
      t.lineLimit = 1
    })
    if (evs.length > 3) { row.addSpacer(4); text(row, `+${evs.length - 3}`, 10, C.ink3) }
    row.addSpacer()
    widget.addSpacer(5)
    shown++
  }
  widget.addSpacer()
}

// ---------- main ----------
const { data, offline, error } = await load()
const widget = new ListWidget()
widget.backgroundColor = C.bg
widget.setPadding(14, 14, 12, 14)
widget.url = SERVER + '/'
widget.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000)

const family = config.widgetFamily || 'medium'
if (!data) buildError(widget, error)
else if (family === 'small') buildSmall(widget, data)
else if (family === 'large') buildLarge(widget, data)
else buildMedium(widget, data)
if (data) footer(widget, data, offline)

if (config.runsInWidget) Script.setWidget(widget)
else await widget.presentMedium()
Script.complete()
