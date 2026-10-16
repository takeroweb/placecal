# PlaceCal — 予定を「置く」カレンダー

保存したテンプレートをカレンダーの日付へドラッグ／スワイプするだけで予定を登録できる Web アプリ。

## 構成

```
placecal/
  package.json        ルート（まとめて起動・テストするためのスクリプト）
  server/             API (Node.js 22 + Express 4 + node:sqlite)
    src/index.js        起動エントリ（PORT, DB_FILE）
    src/app.js          Express アプリ組み立て・CSRF ガード・静的配信
    src/auth.js         認証（既定はログインなし。AUTH_MODE=password で登録/ログイン）
    src/resources.js    Category / Job / Template / Event / Earnings API（全クエリを user_id でスコープ）
    src/earnings.js     給与計算（純粋関数）
    src/validate.js     入力検証
    src/errors.js       統一エラー形式
    src/seed.js         初期カテゴリー・初期テンプレート
    src/db.js           スキーマ（将来用テーブル含む）
    test/api.test.js    API テスト (node:test + supertest)
  scriptable/PlaceCal.js  iPhone ホーム画面ウィジェット（Scriptable 用）
  web/                フロント (React 19 + TypeScript + Vite)
    src/Planner.tsx           メイン画面（状態管理・配置処理・トースト）
    src/useTemplateGesture.ts テンプレートのドラッグ/上スワイプ/タップ
    src/useEventGesture.ts    予定の移動（PC: ドラッグ / スマホ: 長押し→移動）・タップで編集
    src/components/Calendar.tsx      月カレンダー
    src/components/TemplateTray.tsx  テンプレートトレイ
    src/components/TemplateForm.tsx  テンプレート作成・編集 / 予定の追加・編集（共通フォーム）
    src/components/CategorySheet.tsx カテゴリーの追加・名前変更・色変更・削除
    src/components/BulkSheet.tsx     複数日に一括配置（期間＋曜日）
    src/components/DaySheet.tsx      1日の予定一覧（追加・タイムテーブルへ）
    src/components/DayTimeline.tsx   1日のタイムテーブル（#/day/YYYY-MM-DD）
    src/components/EarningsPage.tsx  給料ページ（#/earnings）
    src/components/JobSettingsPage.tsx 勤務先の設定（#/earnings/jobs）
    src/components/AuthScreen.tsx    ログイン/登録
```

## 起動

Node.js 22.13 以上が必要です（`node:sqlite` を使用）。

```bash
cd placecal
npm run setup        # server と web の依存をインストール
npm run dev:server   # API → http://localhost:3001
npm run dev:web      # 別ターミナルで UI → http://localhost:5173 （/api は 3001 へプロキシ）
```

本番相当（API が web/dist を配信）:

```bash
npm run build && npm start   # → http://localhost:3001
```

スマホ実機で確認する場合は同じ Wi-Fi で `http://<PCのIP>:5173` を開いてください（Vite は `host: true`）。

環境変数: `PORT`（既定 3001）、`DB_FILE`（既定 `server/data/placecal.db`）、`NODE_ENV=production` で Cookie に `Secure` 付与。

### 認証モード（`AUTH_MODE`）

- 既定（未指定）: **ログインなし**。アプリを開くとすぐカレンダー。全リクエストが1人の「ローカルユーザー」として動作（DBに既存ユーザーがいれば最も古いアカウントを引き継ぐ。いなければ初期カテゴリー・テンプレート付きで作成）。PC とスマホで同じデータを共有。
  - サーバーに届く人は誰でもデータを見られます。自分のPC・自宅Wi-Fi内での利用向け。インターネットに公開する場合は必ず `AUTH_MODE=password` にしてください。
- `AUTH_MODE=password npm run dev:server`: 従来のメール＋パスワードのログイン（ユーザーごとに完全分離）。

## テスト

```bash
npm test   # API テスト 48 件
```

## API（すべて `/api` 配下、認証必須。エラーは `{ "error": { "code", "message", "field?" } }`）

| Method | Path | 説明 |
|---|---|---|
| POST | /auth/register | 登録（初期カテゴリー6種＋初期テンプレートを作成）※ password モードのみ |
| POST | /auth/login | ログイン |
| POST | /auth/logout | ログアウト |
| GET | /auth/me | 現在のユーザー |
| GET/POST | /categories | 一覧 / 作成 `{name,color}` |
| PUT/DELETE | /categories/:id | 変更 / 削除（予定・テンプレートは消さず未分類に） |
| GET/POST | /jobs | 勤務先 一覧 / 作成 `{name, hourlyWage, transportFee, color?, closingDay?, payDay?, payMonthOffset?, breakRules?}` |
| PUT/DELETE | /jobs/:id | 変更 / 削除（テンプレート・予定は残り、バイト先が外れる） |
| GET | /widget | ウィジェット用（次のシフト・7日分の予定・今月の給料見込み） |
| GET | /earnings?month=YYYY-MM | その月に締まる給料（勤務先ごとの締め日〜締め日。時給×(勤務時間−休憩) ＋ 交通費×出勤日数） |
| GET/POST | /templates | 一覧 / 作成（`jobId`, `breakMinutes` 任意） |
| PUT | /templates/order | 並び順 `{templateIds: [...]}` |
| PUT/DELETE | /templates/:id | 変更 / 削除（既存予定は変更されない） |
| GET | /events?start=YYYY-MM-DD&end=YYYY-MM-DD | 期間内の予定（最大400日） |
| POST | /events | `{templateId, date}` でテンプレートから作成、または全項目指定で手動作成 |
| POST | /events/bulk | `{templateId または title等の予定内容, startDate, endDate, weekdays?}` で一括作成（最大366日、weekdays は 0=日〜6=土） |
| DELETE | /events/batch/:batchId | 一括配置の取り消し |
| PUT/DELETE | /events/:id | 変更（部分更新可、日付だけ送れば移動）/ 削除 |

## 操作

| やりたいこと | PC | スマホ |
|---|---|---|
| 予定を置く | テンプレートを日付へドラッグ | テンプレートを上にスワイプして日付で離す |
| 続けて何日も置く | テンプレートをクリック → 日付をクリック | テンプレートをタップ → 日付をタップ |
| 複数日に一括配置 / テンプレート編集 | テンプレート選択中のバナーの「複数日」「編集」 | 同左 |
| 予定を移動 | 予定をドラッグ | 予定を長押し → 移動 |
| 予定を編集・削除 | 予定をクリック | 予定をタップ |
| その日だけの予定を追加（テンプレートにしない） | 予定のない日付をクリック／一覧の「＋ 予定を追加」。終了日を入れると期間の毎日に追加 | 同左（タップ） |
| 1日のタイムテーブル | 右上の時計アイコン（¥ の左）／日付の一覧 →「タイムテーブル」 | 同左。空き時間をタップでその時刻から追加 |
| その日の予定を全部見る | 予定のある日付の空白部分 / 「+N」をクリック | 同左（タップ） |
| カテゴリー管理 | 右上のパレットアイコン | 同左 |
| テンプレートの並び替え | カードを別のカードの上へドラッグ | カードを上にスワイプして持ち上げ、別のカードの上で離す |
| 給料を見る | 右上の ¥ アイコン | 同左 |
| 勤務先（時給・交通費・休憩ルール・締め日・支給日）の設定 | 給料ページ右上の設定アイコン | 同左 |

配置・移動・削除はすべてトーストの「取り消す」で戻せます。

## iPhone ウィジェット（Scriptable）

1. PC で `npm run build && npm start`（または `npm run dev:server`）。iPhone と PC を同じ Wi-Fi（またはテザリング）に。
2. iPhone に App Store から「Scriptable」（無料）を入れる。
3. iPhone の Safari で `http://<PCのIP>:3001/scriptable/PlaceCal.js` を開く → 全選択してコピー
   （このURLで開くと、サーバーのアドレスが自動で埋め込まれた状態になります。PCのIPは `ipconfig getifaddr en0`）。
4. Scriptable で右上「＋」→ 貼り付け → 名前を `PlaceCal` にして保存。▶ で一度実行し、「ローカルネットワーク」へのアクセスを許可。
5. ホーム画面を長押し →「＋」→ Scriptable → 小・中・大のいずれかを追加 → ウィジェットを長押し →「ウィジェットを編集」→ Script に `PlaceCal`。

- 表示: 小=次のシフト＋今月の給料見込み / 中=＋これからの予定 / 大=＋1週間。ダークモード対応。約15分ごとに更新（iOS の都合で前後します）。
- タップすると PlaceCal（`http://<PCのIP>:3001/`）が開きます（`npm run build` 済みのとき）。
- PC に届かないときは前回の内容を「最終更新 HH:MM」付きで表示。
- PC の IP が変わったら、ウィジェット編集の Parameter に `http://<新しいIP>:3001` を入れれば上書きできます。

## インターネットに公開する（Docker）

`Dockerfile` 1つで API と画面をまとめて動かします（ポート 8080）。データは `/data/placecal.db` に保存されるので、**/data に永続ボリュームを付けてください**（付けないと再起動でデータが消えます）。

コンテナの既定値: `NODE_ENV=production`（Cookie に Secure・プロキシ配下の HTTPS を信頼）、`AUTH_MODE=password`（ログイン必須）。

- 最初にアクセスした人がアカウントを作成でき、**以降は新規登録が閉じます**（個人用サーバー）。複数人で使う場合のみ `ALLOW_SIGNUP=1`。
- ログインは同じIPから15分に10回失敗すると一時停止。
- iPhone ウィジェット: アプリ右上の人型アイコン →「iPhoneウィジェット」の URL を iPhone の Safari で開いてコピー → Scriptable に貼り付け。URL には読み取り専用の合言葉が入っています（漏れたら「合言葉を作り直す」）。
- ホーム画面に追加: iPhone の Safari で公開 URL を開き、共有 →「ホーム画面に追加」。

## iPhone だけで使う（GitHub Pages・サーバー不要版）

`npm --prefix web run build:pages` で、**サーバーなしで動く版**をビルドします（`VITE_STORAGE=local`）。

- 予定・テンプレート・カテゴリー・勤務先はすべて**端末内（IndexedDB）に保存**。入力チェックと給料計算はサーバーと同じコード（`server/src/validate.js` / `earnings.js`）を共有。
- 初回表示後は**オフラインでも動作**（Service Worker）。iPhone の Safari で開き、共有 →「ホーム画面に追加」。
- データは端末の中だけ。右上の人型アイコン →「データとバックアップ」で JSON を書き出し（「ファイルに保存」→ iCloud Drive など）／読み込みができます。
- この版では Scriptable ウィジェットとログインは使えません。

公開・更新は `npm run deploy:pages`（テスト → ビルド → `gh-pages` ブランチへ push）。GitHub Pages は `gh-pages` ブランチのルートから配信します。
