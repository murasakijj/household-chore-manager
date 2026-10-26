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
   ロケーションは東京(asia-northeast1)推奨。Vercel Functions のリージョンと同じ地域にそろえること。
5. サービスアカウントJSONを取得する: **プロジェクトの設定 > サービスアカウント >
   新しい秘密鍵の生成**。ダウンロードしたJSONは1行に整形して控えておく
   (Vercel の `FIREBASE_SERVICE_ACCOUNT` に使う)。
   ```bash
   jq -c . service-account.json
   ```
6. フロント用の公開設定値を控える: **プロジェクトの設定 > 全般 > マイアプリ** で
   ウェブアプリを追加し、`firebaseConfig` の各値(`apiKey` 等)をコピーする。

> **このプロジェクトは4アプリ共有**(household-chore-manager・money-lens・recipe-buddy・
> fridge-track)。経緯と切り替え全体の手順は
> [firebase-consolidation.md](./firebase-consolidation.md) を参照。

### 承認済みドメイン(他アプリの追加)

**Authentication > Settings > 承認済みドメイン** に、このアプリに加えて money-lens・
recipe-buddy・fridge-track の Vercel ドメインもすべて追加する。`VITE_FIREBASE_*` は
この手順6のウェブアプリ設定を4アプリで共用する。

### Firestore ルール・インデックスのデプロイ

`firebase/` が4アプリ共通の正本。**他アプリのリポジトリからルールをデプロイしない**
(1プロジェクトにルールは1つで、上書きすると他アプリのルールが消える)。
リポジトリ上の許可メールはプレースホルダ(`you@example.com`)なので、専用スクリプトで
置き換えてからデプロイする。

```bash
npx firebase login   # 初回のみ(Firebase CLI は devDependency に含まれる)
RULES_ALLOWED_EMAILS=you@gmail.com npm run deploy:firestore -- --project <プロジェクトID>
```

> **直接 `firebase deploy` しない。必ず `npm run deploy:firestore` を使う。**
> リポジトリのルールは許可メールがプレースホルダのままなので、直接デプロイすると
> 全アプリでログイン後のデータアクセスが拒否される。ルート `firebase.json` には
> エミュレータ設定しか置いていない(デプロイ対象の設定は生成物 `.generated/firebase.json`)。

- `RULES_ALLOWED_EMAILS`: recipe-buddy・fridge-track を使う人のメール(カンマ区切り。
  household-chore-manager 側の `ALLOWED_EMAILS` とは別の設定)。小文字に正規化される。
  未設定・プレースホルダのままなら中断する。
- `--project <ID>` は必須(環境変数からの補完はしない)。デプロイ前に対象プロジェクトIDと
  許可メール件数を表示し、プロジェクトIDの再入力を求める(一致しなければ中断)。
  非対話で実行する場合は `--yes`。
- 置換済みの生成物は `.generated/`(git 管理外)。`--generate-only` を付けると生成だけ行い
  デプロイしない。
- 反映されるのは `firestore:rules` と `firestore:indexes`。
- ルールの変更時は `npm run test:emulator`(`firebase/firestore.rules.emulator.test.ts`)を通す。

`firebase/firestore.rules` は household-chore-manager のコレクションをクライアントから
全拒否する(全データアクセスは Vercel Functions 経由、decisions.md)。他アプリ分は
アプリ別セクションで個別に許可している。`firebase/firestore.indexes.json` は複合インデックス。

### 他アプリのデータ移行(recipe-buddy / fridge-track)

旧プロジェクトのデータを共有プロジェクトへコピーする。利用者のローカルで実行する
(旧・新それぞれのサービスアカウントJSONが必要)。既定は dry-run。

```bash
npm run migrate:firebase -- --app recipe-buddy --email you@gmail.com \
  --old-service-account ~/keys/old-sa.json --new-service-account ~/keys/new-sa.json   # dry-run
npm run migrate:firebase -- ... --execute                                             # 実書き込み
```

サービスアカウントJSONはリポジトリ外(例 `~/keys/`)に置く。無料枠を超える見込みなら
`--collections a,b` でコレクションを分けて日をまたいで実行する。

**新 uid の確認(fridge-track のみ)**: 共有プロジェクトの Firebase Console →
Authentication → ユーザー の「User UID」が新 uid。fridge-track の Vercel 環境変数
`INVENTORY_OWNER_UID` にこの値を設定する(スクリプトは uid を表示しない)。

詳細・オプション・注意点は
[scripts/migrate-firebase/README.md](../scripts/migrate-firebase/README.md)。
アプリごとの切り替え手順(環境変数・再デプロイ・戻し方)は
[firebase-consolidation.md §3](./firebase-consolidation.md) を参照。

## 2. VAPID鍵(Web Push)

```bash
npx web-push generate-vapid-keys
```

出力された Public Key / Private Key を控える(後述の環境変数 `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` / `VITE_VAPID_PUBLIC_KEY` に使う)。`VAPID_SUBJECT` は
`mailto:` から始まる連絡先メールアドレス(例 `mailto:you@example.com`)。

> **注意**: VAPID鍵を後から再生成(ローテーション)すると、その時点までに登録された
> 端末の購読(ブラウザの `PushSubscription`)はすべて無効になる。利用者は「設定」
> 画面の「この端末で通知を受け取る」を改めて押し、再登録する必要がある
> (自動では復旧しない)。

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
4. **`VITE_` から始まる環境変数を追加・変更したときは、必ず Vercel で再デプロイする**
   (Redeploy)。ビルド時に埋め込まれるため、環境変数を保存しただけでは既存の
   デプロイには反映されない。
5. `vercel.json` の `regions` で hnd1(東京)に固定している。Firestore を別ロケーションで
   作った場合はそれに近いリージョンへ変更すること(例: 大阪 asia-northeast2 → kix1)。
   地理的に離れていると Firestore との往復のたびに遅延が大きくなる。
   ダッシュボードの Function Region 設定より `vercel.json` の `regions` が優先される。

## 6. GitHub Actions secrets(朝のまとめ通知)

このリポジトリの **Settings > Secrets and variables > Actions** に以下を設定する
(`.github/workflows/daily-summary.yml` が毎時 `/api/cron/daily-summary` を叩く)。

| Secret | 値 |
| --- | --- |
| `APP_URL` | Vercel本番URL(例 `https://household-chore-manager.vercel.app`、末尾スラッシュ無し) |
| `CRON_SECRET` | 手順3と同じ値 |

Vercel Cron(`vercel.json`、毎日 UTC 23:00 = JST 08:00)も保険として引き続き有効。
どちらから呼ばれても、送信済みかどうかはサーバー側(`lastSentLocalDate`)で判定するため
二重送信はしない。実際の送信は「設定」画面で指定した通知時刻ちょうどではなく、
その時刻を過ぎたあとの最初の毎時実行(`daily-summary.yml` は毎時7分頃)に届く。
通知時刻は23:00までしか設定できない(23:xx台だと、その日最後の実行までに間に
合わない可能性があるため)。

> **GitHub Actions のスケジュール実行は、リポジトリに60日間更新(push)が無いと
> 自動的に無効化される**(GitHub の仕様)。無効化された場合は、リポジトリの
> **Actions** タブ → 左側のワークフロー一覧から `Daily summary cron` を選び、
> 「...」メニュー(または黄色い警告バナー)から **Enable workflow** を押すと復旧する。
> Vercel Cron(手順2文末)は保険として動き続けるが、頻度が1日1回のみなので、
> 長期間気づかないと通知が届く時刻が実質1つに制限される点に注意する。

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
npm run test:emulator # Firestoreエミュレータに実接続する結合テスト・ルールテスト・移行テスト(firebase-tools・Java必要)
```
