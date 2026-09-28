# セットアップ手順

本番環境(Firebase + Vercel + GitHub Actions)を新規に構築する手順。開発だけしたい場合は
「ローカル開発」節だけで足りる。用語・環境変数の一覧は [architecture.md](./architecture.md)、
実装判断の背景は [decisions.md](./decisions.md) を参照。

## 1. Firebase プロジェクト

1. [Firebase Console](https://console.firebase.google.com/) で新規プロジェクトを作成する。
2. **Authentication** を有効化し、サインイン方法で **Google** を有効にする。
3. **Authentication > Settings >承認済みドメイン** に、後述の Vercel 本番URL
   (例 `household-chore-manager.vercel.app`)を追加する(デプロイ後でよい)。
4. **Firestore Database** を作成する(本番モードでよい。ルールは後述の手順で上書きする)。
5. サービスアカウントJSONを取得する: **プロジェクトの設定 > サービスアカウント >
   新しい秘密鍵の生成**。ダウンロードしたJSONは1行に整形して控えておく
   (Vercel の `FIREBASE_SERVICE_ACCOUNT` に使う)。
   ```bash
   jq -c . service-account.json
   ```
6. フロント用の公開設定値を控える: **プロジェクトの設定 > 全般 > マイアプリ** で
   ウェブアプリを追加し、`firebaseConfig` の各値(`apiKey` 等)をコピーする。

### Firestore ルール・インデックスのデプロイ

```bash
npm install -g firebase-tools   # 未導入の場合
firebase login
firebase use --add               # 上記で作成したプロジェクトIDを選ぶ
firebase deploy --only firestore:rules,firestore:indexes
```

`firebase/firestore.rules` はクライアントからの直接アクセスを全拒否する
(全データアクセスは Vercel Functions 経由、decisions.md)。`firebase/firestore.indexes.json`
は複合インデックス。

## 2. VAPID鍵(Web Push)

```bash
npx web-push generate-vapid-keys
```

出力された Public Key / Private Key を控える(後述の環境変数 `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` / `VITE_VAPID_PUBLIC_KEY` に使う)。`VAPID_SUBJECT` は
`mailto:` から始まる連絡先メールアドレス(例 `mailto:you@example.com`)。

## 3. CRON_SECRET

`/api/cron/daily-summary` を叩く際の認証トークン。ランダムな文字列を生成する。

```bash
openssl rand -base64 32
```

## 4. 生成AI APIキー(任意。無くてもAI以外の機能は動く)

既定は Gemini(無料枠)。[Google AI Studio](https://aistudio.google.com/) でAPIキーを取得し、
`GEMINI_API_KEY` に設定する。

他のプロバイダへ切り替える場合は `AI_PROVIDER` を変更する(`docs/architecture.md`「環境変数」参照):

| `AI_PROVIDER` | 必要な環境変数 | 備考 |
| --- | --- | --- |
| `gemini`(既定) | `GEMINI_API_KEY` | 既定モデル `gemini-3.6-flash` |
| `openai` | `OPENAI_API_KEY`(+任意 `OPENAI_BASE_URL`) | OpenAI本体だけでなく、OpenRouterやOpenAI互換のローカルLLM(Ollama等)にも `OPENAI_BASE_URL` で向けられる |
| `anthropic` | `ANTHROPIC_API_KEY` | 既定モデル `claude-haiku-4-5` |

`AI_MODEL` でモデル名を上書きできる(未指定ならプロバイダごとの既定値)。AI機能
(家事登録アシスト・初期家事リスト一括提案)はどちらもAIの結果を候補表示のみに使い、
利用者の確認なしには保存しない(decisions.md「生成AI」)。AIキー未設定でも、
「推奨初期データ」からの一括登録など他の機能は問題なく動く。

## 5. Vercel プロジェクト

1. [Vercel](https://vercel.com/) でこのリポジトリをインポートする(Framework Preset: Vite)。
2. **Settings > Environment Variables** に以下を設定する(Production/Preview両方。値は
   `VITE_` の有無を間違えないこと。`VITE_` が付くものだけがブラウザに公開される)。

サーバー側(秘密。`VITE_` を付けない):

| 変数 | 値 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | 手順1で取得したサービスアカウントJSON(1行) |
| `ALLOWED_EMAILS` | `u9c3300232346g@gmail.com` |
| `AI_PROVIDER` | `gemini` (既定。変更する場合のみ設定) |
| `AI_MODEL` | 省略可 |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `ANTHROPIC_API_KEY` | 選んだプロバイダのもの |
| `VAPID_PUBLIC_KEY` | 手順2のPublic Key |
| `VAPID_PRIVATE_KEY` | 手順2のPrivate Key |
| `VAPID_SUBJECT` | 手順2の`mailto:...` |
| `CRON_SECRET` | 手順3の値 |

フロント側(公開値。`VITE_` を付ける):

| 変数 | 値 |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | Firebase `appId` |
| `VITE_VAPID_PUBLIC_KEY` | 手順2のPublic Key(公開鍵なので `VITE_` で問題ない) |

3. デプロイ後、本番URL(例 `https://household-chore-manager.vercel.app`)を
   Firebase Authentication の承認済みドメインに追加する(手順1-3)。

## 6. GitHub Actions secrets(朝のまとめ通知)

このリポジトリの **Settings > Secrets and variables > Actions** に以下を設定する
(`.github/workflows/daily-summary.yml` が毎時 `/api/cron/daily-summary` を叩く)。

| Secret | 値 |
| --- | --- |
| `APP_URL` | Vercel本番URL(例 `https://household-chore-manager.vercel.app`、末尾スラッシュ無し) |
| `CRON_SECRET` | 手順3と同じ値 |

Vercel Cron(`vercel.json`、毎日 UTC 23:00 = JST 08:00)も保険として引き続き有効。
どちらから呼ばれても、送信済みかどうかはサーバー側(`lastSentLocalDate`)で判定するため
二重送信はしない。

## 7. iPhoneでの通知許可

iOS Safari はホーム画面に追加した状態(PWA)でしか Web Push を受け取れない
(設計書 §12.4)。

1. Safari で本番URLを開き、ログインする。
2. 共有ボタン(□に↑のアイコン)→「ホーム画面に追加」。
3. ホーム画面のアイコンからアプリを開き直す。
4. 「設定」画面の「この端末の通知」から「この端末で通知を受け取る」を押し、
   通知を許可する。

Android Chrome・PCのChrome/Edgeは通常のブラウザタブのままで通知を許可できる。

## ローカル開発

```bash
npm install
cp .env.example .env.local   # VITE_FIREBASE_* と VITE_VAPID_PUBLIC_KEY を埋める
npm run dev
```

`npm run dev` はフロントのみ(Vite)。API(`api/router.ts`)をローカルで動かす場合は
`vercel dev` を使うか、`vitest`(結合テスト、`MemoryRepo`)で代替する。

```bash
npm run lint
npm run build
npm test              # ユニット・結合テスト(MemoryRepo、Firestore不要)
npm run test:emulator # Firestoreエミュレータに実接続する結合テスト(firebase-tools必要)
```
