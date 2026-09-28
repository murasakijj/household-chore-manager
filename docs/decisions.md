# 決定記録（設計書 §21「実装開始時に選択が必要」ほか）

> 決定日: 2026-09-28。設計書 `household-chore-manager-design.md` を補う実装上の決定。ドメイン仕様（状態判定・履歴不変・household分離）は設計書が正であり、ここで変更しない。変更したい場合はまずこの文書を直す。

## §21 実装開始時の選択

| 項目 | 決定 | 理由 |
| --- | --- | --- |
| フロントエンド | React 19 + Vite + TypeScript / react-router-dom v7 / 素のCSS（モバイルファースト） | recipe-buddy と同構成。実績があり保守しやすい |
| バックエンド | Vercel Functions（Node.js 22, `api/`）。**全データアクセスはAPI経由** | 設計書 §11.4「状態はサーバー側で算出」「household_id をクライアントから信用しない」を素直に満たすため。クライアントからの Firestore 直アクセスは使わない |
| DB | Cloud Firestore（firebase-admin からのみアクセス）。セキュリティルールはクライアント全拒否 | 無料枠、recipe-buddy と同じ Firebase プロジェクト運用。マイグレーションの代わりにドキュメントへ `schemaVersion` を持たせる |
| 認証 | Firebase Authentication（Google）。サーバーは `requireAuth`（IDトークン検証 + `ALLOWED_EMAILS`）を全APIで通す | recipe-buddy の実装をほぼ移植。`ALLOWED_EMAILS=u9c3300232346g@gmail.com` とし、本人以外は403 |
| ホスティング | Vercel（Hobby） | ユーザー指定 |
| Push通知方式 | Web Push（VAPID, `web-push`）+ PWA（manifest + service worker）。送信ジョブは `POST /api/cron/daily-summary`（`CRON_SECRET` 認証）を GitHub Actions で毎時起動 | Vercel Hobby の Cron は1日1回のみで利用者ごとの通知時刻に対応できないため。Vercel Cron（毎日 23:00 UTC = 08:00 JST）も保険として併用し、送信済み判定で二重送信しない |
| 利用者 | 本人のみで開始。データ構造は household / member を持ち、将来メンバー追加可能 | ユーザー指定 |

## 生成AI（2026-09-28 ユーザー決定）

設計書 §4.2 は「AIによる家事提案」をMVP対象外としているが、ユーザー決定により次の2機能に限ってAIを使う。いずれも **AIの結果は候補表示のみで、利用者の確認なしに保存しない**。

| 機能 | 内容 |
| --- | --- |
| 家事登録アシスト | S-04 で家事名を入力し「AIで候補を出す」を押すと、場所・カテゴリ・推奨間隔（と説明）の候補をフォームに反映する。保存は利用者が行う |
| 初期家事リスト一括提案 | 家庭の状況（例: 犬がいる、乳児がいる）を入力すると家事項目リスト案を出す。チェックしたものだけ一括登録。AIが使えない場合に備え、設計書 §18 の推奨初期データも同じ画面から選べる |

- AI呼び出しはプロバイダ抽象化（`api/_lib/ai/`）し、環境変数 `AI_PROVIDER` で `gemini`（既定）/ `openai`（OpenAI互換API。OpenAI・OpenRouter・ローカルLLM等）/ `anthropic` を切り替える。モデルは `AI_MODEL`。
- 既定は Gemini 無料枠 `gemini-3.6-flash`（recipe-buddy と同じ）。
- AI出力は zod で検証し、存在しない場所・カテゴリ名は捨てる。間隔は §7.4 の制約に丸める。
- APIキーはサーバー環境変数のみ（`VITE_` を付けない）。

## その他の実装判断

- **最終実施日時キャッシュ**: 設計原則6は「高速化が必要な場合のみキャッシュ」。Firestore では家事ごとに履歴を集計すると読み取りが家事数×Nになるため、`chores.lastCompletedAt` をキャッシュとして持つ。実施記録の追加・取消時に **同一トランザクション内で** 有効履歴の `MAX(occurredAt)` を再計算して更新する（取消後は1つ前の有効履歴に戻る）。正本は常に `choreEvents`。
- **二重タップ対策**: `POST /api/chores/{id}/events` はクライアント生成の `clientRequestId`（UUID）を必須とし、イベントIDとして使う。同じIDの再送は既存イベントを返す（冪等）。加えて同じ家事に10分以内の有効履歴があれば応答に `possibleDuplicate: true` を付け、UIで警告する（自動削除はしない）。
- **家庭の自動作成**: 許可済み利用者の初回APIアクセス時に、家庭「わが家」（`Asia/Tokyo`）・メンバー・通知設定・推奨初期データの場所/カテゴリ（§18）を作成する。家事項目は自動作成しない（一括提案画面から選ぶ）。
- **ページネーション**: 履歴系はカーソル方式（`limit` 既定50・最大100、`cursor`）。家事一覧は1家庭1,000件想定のため全件取得してサーバーで絞り込み・並び替え。
- **E2Eテスト**: Google ログインを伴う Playwright E2E は MVP では作らず、サービス層の結合テスト（インメモリリポジトリ）で §16.2 を担保する。残課題として README に記載する。
- **対象ブラウザ**: iPhone Safari（iOS 16.4+、Push はホーム画面追加時のみ）と Android Chrome。PC は Chrome/Edge 最新。
