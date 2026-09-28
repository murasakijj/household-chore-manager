# household-chore-manager

家事を「一度やって終わり」ではなく、定期メンテナンス対象として管理するPWA。
「いつ何をやったか」を記録し、推奨間隔から外れた家事をホーム画面と朝のまとめ通知で
知らせる。詳しい背景・コンセプトは [設計書](./household-chore-manager-design.md) を参照。

## 機能

- **今日の家事**: 優先(overdue)・やった方がよい(recommended)・そろそろ(upcoming)・
  初回未実施を分けて表示し、「やった」を1タップで記録
- **家事一覧・検索・絞り込み**(状態・場所・カテゴリ・名前)
- **家事の登録・編集**。「AIで候補を出す」で場所・カテゴリ・推奨間隔の候補を取得
  (確認なしに保存はしない)
- **家事をまとめて登録**: 設計書 §18 の推奨初期データ、またはAIへ家庭の状況を伝えての
  一括提案から、チェックした項目だけをまとめて登録
- **実施履歴**: 記録・取消(Undo)・全体履歴の絞り込み
- **朝のまとめ通知**(Web Push): 家庭のタイムゾーンでの指定時刻に、その日やるべき
  家事をまとめて通知
- **設定**: 通知のON/OFF・時刻、タイムゾーン、1タップ記録のON/OFF、
  場所・カテゴリ・対象リソースのマスタ管理

## 構成

- フロントエンド: React + TypeScript + Vite(PWA)。Firebase Authentication(Google
  ログイン)でサインインし、許可済みメールアドレスのみアクセスできる
- API: Vercel Functions 1本(`api/router.ts`)に集約したミニルーター。ドメインロジック
  (`api/_lib/domain/`)・リポジトリ層(`api/_lib/repo/`、本番はFirestore)・サービス層
  (`api/_lib/services/`)・ルート層(`api/_lib/routes/`)に分離
- データストア: Firestore(サーバー側 `firebase-admin` 経由のみ。クライアントからの
  直接アクセスは `firebase/firestore.rules` で全拒否)
- AI: `api/_lib/ai/` でプロバイダを抽象化し、`AI_PROVIDER` で Gemini(既定)/
  OpenAI互換 / Anthropic を切り替え可能
- 通知: Web Push(VAPID)。送信ジョブ `POST /api/cron/daily-summary` を
  GitHub Actions(毎時)+ Vercel Cron(毎日、保険)から起動

詳細は [docs/architecture.md](./docs/architecture.md)、実装判断の経緯は
[docs/decisions.md](./docs/decisions.md) を参照。

## セットアップ

本番環境の構築手順(Firebase・Vercel・GitHub Actionsの設定含む)は
[docs/setup.md](./docs/setup.md) を参照。

```bash
npm install
cp .env.example .env.local   # VITE_FIREBASE_* と VITE_VAPID_PUBLIC_KEY を埋める
npm run dev
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | フロント開発サーバー(Vite) |
| `npm run build` | 型チェック + 本番ビルド |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | ユニット・結合テスト(`MemoryRepo`、Firestore不要) |
| `npm run test:emulator` | Firestoreエミュレータに実接続する結合テスト(`firebase-tools` が必要) |

## ドキュメント

- [設計書](./household-chore-manager-design.md) — ドメイン仕様・画面設計・データモデル
- [docs/architecture.md](./docs/architecture.md) — 実装アーキテクチャ・API一覧・環境変数
- [docs/decisions.md](./docs/decisions.md) — 実装上の判断とその理由
- [docs/implementation-plan.md](./docs/implementation-plan.md) — 実装バッチ計画
- [docs/setup.md](./docs/setup.md) — Firebase/Vercel/GitHub Actionsのセットアップ手順

## 残課題

- **E2Eテスト**: Googleログインを伴う Playwright 等のE2Eテストは未実装。サービス層の
  結合テスト(`MemoryRepo`、`api/_lib/router.test.ts`)と、Firestoreエミュレータに
  実接続する結合テスト(`npm run test:emulator`)で設計書 §16.2 相当を担保している
  (decisions.md「生成AI」節の直後を参照)
- **AIプロバイダのライブ動作確認**: 各プロバイダの単体テストはHTTP/SDK呼び出しを
  モックしたものであり、実際のAPIキーでの疎通確認は別途必要
- **通知の実機確認**: iOS Safari(ホーム画面追加時)・Android Chromeでの実際のPush受信・
  タップ時の挙動は、本番デプロイ後に実機で確認すること
