# 実装計画

設計書のフェーズ（§19）を、担当エージェント単位のバッチに分ける。各バッチ完了時に `npm run lint && npm run build && npm test` が通ること。

## バッチ1: 土台・ドメイン・API（設計書 Phase 1 のサーバー側）

1. プロジェクト雛形: package.json（Node 22, `"type":"module"`）、tsconfig（app / api / node）、vite、eslint、prettier、vitest、`.gitignore`、`.env.example`、`vercel.json`
2. `api/_lib/{auth,http,types,context}.ts`（recipe-buddy から移植）と `api/router.ts`
3. ドメイン純粋関数 `api/_lib/domain/*` と単体テスト（設計書 §16.1 の全ケース: 境界値表、履歴なし、無効、猶予0、日付変更直前直後、UTC/JSTずれ、うるう年・月末・年末年始）
4. リポジトリ（Firestore / インメモリ）とサービス層、全APIルート（AI・Push・cron を除く）
5. 結合テスト（インメモリ）: 設計書 §16.2 の各項目
6. `firebase/firestore.rules`, `firebase/firestore.indexes.json`

## バッチ2: フロントエンド（Phase 1 画面 + Phase 2）

1. Firebase 初期化・AuthContext・RequireAuth・Login（recipe-buddy から移植）
2. 型付きAPIクライアント、`statusMeta.ts`
3. 画面: 今日 / 家事一覧（検索・絞り込み・並び替え・無効切替）/ 詳細 / 登録・編集（同名警告、初期値自動計算）/ 実施記録 / 全体履歴（絞り込み・取消表示切替・取消）/ 設定・マスタ管理
4. 1タップ完了＋Undoトースト、重複警告、下部ナビ、レスポンシブCSS、スケルトン表示
5. PWA manifest とアイコン

## バッチ3: AI・通知（Phase 3 + ユーザー追加要件）

1. `api/_lib/ai/`: プロバイダ抽象（gemini / openai互換 / anthropic）、リトライ（recipe-buddy `callGeminiWithRetry` 相当を共通化）、テスト
2. `/api/ai/chore-suggestion`、`/api/ai/chore-list-proposal`、`/api/templates/initial-chores` と画面（登録画面の候補ボタン、一括提案画面）
3. Web Push: 購読API、`public/sw.js`、設定画面の許可状態表示・テスト通知、cron ジョブ、`.github/workflows/daily-summary.yml`
4. `docs/setup.md`（Firebase / Vercel / VAPID / GitHub Actions / AI キーの手動設定手順）と README

## 各バッチ後

レビュー担当が設計書・本ドキュメントとの整合、セキュリティ、テストの妥当性をレビュー → 実装担当が指摘対応 → コミット・プッシュ。
