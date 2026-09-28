# アーキテクチャ

> 対象読者: 実装担当AI / 開発者。ドメイン仕様は `household-chore-manager-design.md`（以下「設計書」）、実装上の決定は [decisions.md](./decisions.md)。

## システム構成

```
ブラウザ（スマホ優先 / PWA）
  │ ① Googleログイン（Firebase Authentication, signInWithPopup）
  │ ② すべての読み書き: Authorization: Bearer <idToken> で /api/*
  ▼
Vercel
  ├─ 静的配信: React + Vite SPA（public/sw.js, manifest.webmanifest）
  └─ Functions: api/router.ts（単一関数に集約。Hobby の関数数上限対策）
        ├─ requireAuth（IDトークン検証 + ALLOWED_EMAILS）→ household 解決
        ├─ サービス層 → リポジトリ（firebase-admin Firestore）
        ├─ AI（api/_lib/ai: gemini / openai互換 / anthropic）
        └─ /api/cron/daily-summary（CRON_SECRET）→ Web Push
GitHub Actions（毎時）/ Vercel Cron（毎日）→ /api/cron/daily-summary
```

## ルーティング（Vercel）

`vercel.json`:

- `rewrites`: `/api/:path*` → `/api/router?__path=:path*`、それ以外 → `/index.html`（SPA）
- `crons`: `{"path": "/api/cron/daily-summary", "schedule": "0 23 * * *"}`（Vercel Cron は GET で `Authorization: Bearer $CRON_SECRET` を付ける）
- `functions.api/router.ts.maxDuration`: 60

`api/router.ts` は `__path`（無ければ `req.url`）とメソッドから `api/_lib/routes/*` のハンドラへ振り分ける。未定義は404。

## 共通処理

- `api/_lib/auth.ts`: recipe-buddy からほぼ移植。`requireAuth(header) → {uid, email}`。
- `api/_lib/context.ts`: `resolveContext(user)` → `{householdId, memberId, household}`。`userMemberships/{uid}` を引き、無ければ初回セットアップ（decisions.md「家庭の自動作成」）をトランザクションで行う。**householdId はここ以外から取らない。**
- `api/_lib/http.ts`: `sendJson` / `readJsonBody`（recipe-buddy から移植）。
- エラー応答: `{ error: "<code>", details?: ... }`。400 `invalid_body` / 401 / 403 / 404 `not_found` / 405 / 409 / 500 `internal_error` / 502 AI系（`rate_limited` / `overloaded` / `upstream_error` / `invalid_ai_output`）。AIプロバイダ・Web Pushの環境変数未設定は `ai_not_configured` / `push_not_configured`(500。設定ミスとして扱い、キー自体はログに出さない)。
- ログにメモ本文・メール以外の個人情報を出さない。

## ドメイン（純粋関数・`api/_lib/domain/`）

| ファイル | 内容 |
| --- | --- |
| `calendar.ts` | `localDate(instant, tz) → "YYYY-MM-DD"`、`diffCalendarDays(a, b)`（`Intl.DateTimeFormat` で暦日化し `Date.UTC` で差分。外部ライブラリ不要） |
| `status.ts` | `computeChoreStatus({isActive, lastCompletedAt, intervalDays, warningDays, graceDays, now, timezone}) → {status, elapsedDays, overdueDays, nextChangeDate}`（設計書 §7.4 を厳守）。`defaultWarningGrace(intervalDays)`（§7.6）、`validateIntervals`（§7.4 制約） |
| `ordering.ts` | 状態順・超過日数・名称の比較関数（§12.3）。ホーム・一覧・通知で共通使用 |
| `today.ts` | ホームのセクション分け（優先/今日やった方がよい/そろそろ/初回未実施/本日実施済み、not_due は件数のみ） |
| `summary.ts` | 朝のまとめ通知の対象抽出と文面生成（§12.1〜12.3、§7.7 の「初回記録待ち」） |

状態値・表示名・色は **サーバーは内部値のみ返す**。表示名・色・アイコンの定義は `src/lib/statusMeta.ts` 1箇所に置く（設計書 §14.4）。

## データモデル（Firestore）

日時は Firestore `Timestamp`（UTC）。APIではISO 8601文字列。全ドキュメントに `householdId` を持たせ、パスでも分離する。

```
userMemberships/{uid}            { householdId, memberId, email, createdAt }
households/{hid}                 { name, timezone, schemaVersion, createdAt, updatedAt }
households/{hid}/members/{mid}   { displayName, userId, isActive, createdAt, updatedAt }
households/{hid}/areas/{id}      { name, sortOrder, isActive, createdAt, updatedAt }
households/{hid}/resources/{id}  { areaId|null, resourceType, name, externalRef|null, isActive, createdAt, updatedAt }
households/{hid}/choreCategories/{id} { name, sortOrder, isActive }
households/{hid}/chores/{id}     { name, description|null, categoryId|null, areaId|null, resourceId|null,
                                   scheduleType:"interval", intervalDays, warningDays, graceDays, isActive,
                                   createdBy, createdAt, updatedAt,
                                   lastCompletedAt|null  ← キャッシュ（decisions.md） }
households/{hid}/choreEvents/{id} { choreId, eventType:"completed", occurredAt, actorMemberId,
                                    recordedByMemberId, note|null, voidedAt|null, voidedByMemberId|null,
                                    voidReason|null, createdAt }
households/{hid}/notificationSettings/{memberId} { dailySummaryEnabled, dailySummaryTime:"HH:MM",
                                    includeUpcoming, oneTapComplete, lastSentLocalDate|null, updatedAt }
households/{hid}/pushSubscriptions/{sha256(endpoint)} { memberId, endpoint, keys:{p256dh, auth}, createdAt }
```

- `firebase/firestore.rules`: クライアントは全拒否（`allow read, write: if false;`）。
- `firebase/firestore.indexes.json`: `choreEvents` に以下の複合インデックス。
  - `(choreId ASC, voidedAt ASC, occurredAt DESC)`: 家事別履歴（有効履歴のみ）、`lastCompletedAt` 再計算、possibleDuplicate 判定、`areaId` 絞り込みの `choreId in [...]`
  - `(choreId ASC, occurredAt DESC)`: 家事別履歴（`includeVoided=true`）
  - `(actorMemberId ASC, voidedAt ASC, occurredAt DESC)`: 全体履歴の実施者絞り込み（有効履歴のみ）
  - `(actorMemberId ASC, occurredAt DESC)`: 全体履歴の実施者絞り込み（`includeVoided=true`）
  - `(voidedAt ASC, occurredAt DESC)`: 全体履歴（絞り込み無し、有効履歴のみ）
- 参照整合性: 家事の `areaId`/`categoryId`/`resourceId` は同一家庭のサブコレクションに存在することをサーバーで検証（別家庭は存在しない扱い → 400）。

### リポジトリ層

`api/_lib/repo/types.ts` にインターフェースを定義し、`firestoreRepo.ts`（本番）と `memoryRepo.ts`（テスト用）を実装する。イベント追加・取消は「イベント書き込み + `lastCompletedAt` 再計算」を1トランザクションで行うメソッドとして提供する。firebase-admin のトランザクションは read-after-write を禁止するため、トランザクション内の読み取りはすべて書き込みより前に完了させる。`lastCompletedAt` 再計算に必要な読み取りは「有効履歴のうち occurredAt 降順の先頭（取消時は先頭2件）」だけに限定し、家事あたりの履歴が多くても全件スキャンしない。家事作成（初回実施日時つき）と一括登録（`/api/chores/bulk`）は、事前の読み取りが不要なため `batch()` でまとめて書き込む。サービス層（`api/_lib/services/`）はリポジトリだけに依存し、結合テストはインメモリで回す。

## API

設計書 §11 に従う。すべて `requireAuth` → `resolveContext` を通る（cron を除く）。

| Method | Path | 備考 |
| --- | --- | --- |
| GET | `/api/auth-check` | 200 `{ok:true, member, household}` |
| GET | `/api/chores` | `status, areaId, categoryId, q, includeInactive, sort=status\|elapsed\|name`。各家事に `status, elapsedDays, lastCompletedAt, nextChangeDate` を付与 |
| POST | `/api/chores` | 同名があれば `warnings:["duplicate_name"]` を返す（保存はする）。任意 `lastCompletedAt` 指定時は completed イベントを1件作る |
| POST | `/api/chores/bulk` | 一括提案からの登録（最大50件） |
| GET | `/api/chores/today` | `{sections:{overdue, recommended, upcoming, neverDone, doneToday}, notDueCount}` |
| GET/PATCH | `/api/chores/{id}` | 詳細は最近の履歴20件・平均実施間隔（有効履歴2件以上）を含む。PATCH で `isActive:false` = 無効化 |
| POST | `/api/chores/{id}/events` | `{clientRequestId, occurredAt?, actorMemberId?, note?}`。未来日時は400。冪等・`possibleDuplicate` |
| GET | `/api/chores/{id}/events` | カーソルページネーション、`includeVoided` |
| GET | `/api/chore-events` | 全体履歴。`choreId, areaId, actorMemberId, from, to, includeVoided, cursor, limit` |
| POST | `/api/chore-events/{id}/void` | `{reason?}`。二重取消は409 |
| GET/POST/PATCH | `/api/areas`, `/api/resources`, `/api/chore-categories` | PATCH は `/api/areas/{id}` 形式 |
| GET/PATCH | `/api/settings` | 家庭（名前・timezone）＋自分の通知設定 |
| GET | `/api/members` | 実施者選択用 |
| POST/DELETE | `/api/push/subscriptions` | Web Push 購読の登録/解除 |
| POST | `/api/push/test` | 自分宛てテスト通知 |
| POST | `/api/ai/chore-suggestion` | `{name}` → `{areaId\|null, categoryId\|null, intervalDays, warningDays, graceDays, description\|null}` |
| POST | `/api/ai/chore-list-proposal` | `{context}` → `{items:[{name, areaId, categoryId, intervalDays, warningDays, graceDays, description}]}`（最大30件） |
| GET | `/api/templates/initial-chores` | 設計書 §18 の家事項目例（AI不要のフォールバック） |
| GET/POST | `/api/cron/daily-summary` | `Authorization: Bearer $CRON_SECRET`。requireAuth は通さない |

### 朝のまとめ通知ジョブ

各家庭・各メンバーについて、家庭タイムゾーンの現在時刻が `dailySummaryTime` 以上かつ `lastSentLocalDate != 今日` なら、`summary.ts` で文面を作り、そのメンバーの全購読へ送る。対象0件なら送らないが `lastSentLocalDate` は更新する。404/410 の購読は削除。通知タップで `/` を開く（`public/sw.js`）。

## フロントエンド

| パス | 画面 |
| --- | --- |
| `/login` | ログイン（アクセス権なし表示含む） |
| `/` | S-01 今日の家事 |
| `/chores` | S-02 家事一覧 |
| `/chores/new`, `/chores/:id/edit` | S-04 登録・編集（AI候補ボタン） |
| `/chores/propose` | 初期家事リスト一括提案（AI / 推奨初期データ） |
| `/chores/:id` | S-03 家事詳細 |
| `/chores/:id/record` | S-05 実施記録 |
| `/history` | S-06 全体履歴 |
| `/settings` | S-07 設定（通知・タイムゾーン・1タップ設定・場所/カテゴリ/対象リソース管理への導線） |
| `/settings/areas`, `/settings/categories`, `/settings/resources` | マスタ管理 |

- 下部ナビ「今日」「家事」「履歴」「設定」。タップ領域44px以上、状態は色＋ラベル＋アイコン。
- 「やった」: `oneTapComplete` ON なら即記録しトーストに「取り消す」（Undo = void API）。OFF なら S-05 へ。
- `dangerouslySetInnerHTML` を使わない。
- `src/lib/api.ts` に型付きAPIクライアント（Bearer 付与、`ApiError`）。

## 環境変数

サーバー（Vercel、秘密。`VITE_` を付けない）:

| 変数 | 用途 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | firebase-admin 初期化（JSON 1行） |
| `ALLOWED_EMAILS` | 許可メール（カンマ区切り、小文字比較）。本番は `u9c3300232346g@gmail.com` |
| `AI_PROVIDER` | `gemini`（既定）/ `openai` / `anthropic` |
| `AI_MODEL` | 任意。既定はプロバイダごと（gemini: `gemini-3.6-flash`） |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `ANTHROPIC_API_KEY` | 選んだプロバイダのもの |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |
| `CRON_SECRET` | 通知ジョブ認証 |

フロント（公開値）: `VITE_FIREBASE_*`（6個）、`VITE_VAPID_PUBLIC_KEY`。

## セキュリティチェックリスト

- [ ] 秘密の環境変数がフロントバンドルに含まれない
- [ ] cron 以外の全 `/api/*` が `requireAuth` → `resolveContext` を通る。cron は `CRON_SECRET` を定数時間比較
- [ ] リクエストボディ・クエリの `householdId` を一切使わない
- [ ] Firestore ルールはクライアント全拒否
- [ ] 全入力を zod で検証
- [ ] AI出力を zod で検証し、存在しないIDを捨てる
- [ ] Firebase Auth の承認済みドメインに Vercel 本番URLを登録
