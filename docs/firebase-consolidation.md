# Firebase プロジェクト統合計画

> 決定日: 2026-10-26（ユーザー決定）。目的は **Firebase の無料枠（Spark）のプロジェクト数上限の解消**。4アプリが使う Firebase を、household-chore-manager が使っているプロジェクト（以下「共有プロジェクト」）1つに集約する。ハブページ・アプリ間連携は本計画の範囲外（統合完了後に別途検討）。

## 1. 対象と現状

| アプリ | 認証 | Firestore | サーバー側の Firebase 利用 | 移行作業 |
| --- | --- | --- | --- | --- |
| household-chore-manager | Google | `userMemberships/*`, `households/**`（クライアント全拒否、API経由のみ） | Auth 検証 + Firestore | **なし（共有プロジェクトの持ち主）** |
| money-lens | Google | 使わない（データは GitHub `money-lens-data`） | Auth 検証のみ | 設定差し替えのみ |
| recipe-buddy | Google | `users/{uid}/recipes/*`, `users/{uid}/techniques/*`（クライアント直アクセス） | Auth 検証のみ | データコピー + uid 付け替え + 設定差し替え |
| fridge-track | Google | `users/{uid}/{foodItems, inventoryLots, inventoryEvents, receipts, receiptItems, receiptFoodMappings, consumptionProfiles, recipeConsumptions}`（クライアント直アクセス、厳格ルール） | Auth 検証 + Firestore（連携API） | データコピー + uid 付け替え + 設定差し替え + `INVENTORY_OWNER_UID` 更新 |

調査で確認した事実:

- 保存データ内に uid を含むフィールドは無い。uid はドキュメントパス（`users/{uid}`）にのみ現れる。
- コレクション名は4アプリ間で衝突しない。
- Firebase Storage はどのアプリも使っていない。
- money-lens・recipe-buddy のサーバーは `verifyIdToken` しか使わない（Firestore を触らない）。

## 2. 統合後の構成

### 2.1 Firebase

- **Authentication**: 共有プロジェクトの Google ログインを全アプリで使う。uid は全アプリ共通になる。承認済みドメインに4アプリの Vercel ドメインをすべて登録する。
- **Web アプリ設定（`VITE_FIREBASE_*`）**: 共有プロジェクトの既存 Web アプリ設定を全アプリで共用する（アプリ追加登録は不要。登録しても良いが必須ではない）。
- **Firestore**: 既定データベース1つ（無料枠は1プロジェクト1データベースのみ）。ロケーションは東京（既存）。コレクションはアプリごとに上表のとおりで、名前空間の変更はしない。
- **サービスアカウント**:
  - household-chore-manager・fridge-track: Firestore を使うので `FIREBASE_SERVICE_ACCOUNT` を設定。
  - money-lens・recipe-buddy: **サービスアカウントを渡さない**。`FIREBASE_PROJECT_ID` だけで `verifyIdToken` できるようにコードを変更する（他アプリのデータを読み書きできる権限を持たせないため）。auth は **`FIREBASE_PROJECT_ID` が設定されていればそれを優先し、`FIREBASE_SERVICE_ACCOUNT` は無視する（警告ログのみ）**。`FIREBASE_PROJECT_ID` が無いときだけ従来の `FIREBASE_SERVICE_ACCOUNT` を使う（後方互換）。共有プロジェクトでは SA を設定しない。

### 2.2 セキュリティルール・インデックスの一元管理

1つのプロジェクトにルールは1つしか適用できない。どれか1つのリポジトリから単独のルールをデプロイすると他アプリのルールが消えるため、**ルールとインデックスの正本を household-chore-manager の `firebase/` に一本化する**。

- `firebase/firestore.rules`: アプリごとのセクションに分けた統合ルール。
  - household-chore-manager: 従来どおりクライアント全拒否（明示のマッチを書かない＝末尾の全拒否に落ちる）。
  - recipe-buddy: `users/{userId}/recipes/{document=**}` と `users/{userId}/techniques/{document=**}` だけを本人に許可する。**従来の `users/{userId}/{document=**}` のワイルドカード許可は使わない**（ルールは OR 評価のため、fridge-track の追記専用制約が破られる）。
  - fridge-track: 既存ルールをそのまま移植。
  - 本人判定は fridge-track の厳しい版（メール一致 + `email_verified` + `sign_in_provider == 'google.com'` + uid 一致）に全アプリで統一する。
- 許可メールはリポジトリ上ではプレースホルダ `you@example.com` のまま置き、デプロイ用スクリプトが環境変数 `RULES_ALLOWED_EMAILS` で置き換えた生成ファイル（git 管理外）をデプロイする。
- `firebase/firestore.indexes.json`: household-chore-manager の既存インデックスに、他アプリが必要とする複合インデックスを統合する（旧プロジェクトのコンソールの「インデックス」タブで手動作成済みのものも移す）。
- ルールのテスト: `@firebase/rules-unit-testing` で、アプリごとの許可・拒否（特に fridge-track の追記専用、recipe-buddy が fridge-track のコレクションを書けないこと、household-chore-manager のコレクションがクライアントから読めないこと、他人の uid 配下に触れないこと）をエミュレータで検証する。
- recipe-buddy・fridge-track のリポジトリにある `firebase/firestore.rules` は削除し、「正本は household-chore-manager」と案内する README を置く（誤デプロイ防止）。

### 2.3 データ移行スクリプト

household-chore-manager の `scripts/migrate-firebase/` に置く。利用者がローカルで実行する（Claude の実行環境からは Firebase に接続できないため）。

- 入力: 旧プロジェクトのサービスアカウント JSON、共有プロジェクトのサービスアカウント JSON、対象アプリ（`recipe-buddy` / `fridge-track`）、本人のメールアドレス、任意で `--collections a,b`（コレクション単位の分割実行）。
- uid の解決: 旧 uid = 旧プロジェクトの `getUserByEmail`、新 uid = 共有プロジェクトの `getUserByEmail`（家事アプリで既にログイン済みなので存在する。無ければ「新しいアプリで一度ログインしてから再実行」と案内して終了）。
- コピー: 旧 `users/{旧uid}` のドキュメント（あれば）と、**対象アプリのコレクションだけ**を再帰的に新 `users/{新uid}` 配下へ同じドキュメントIDで書く。Timestamp などの型を保持する。バッチ書き込み（最大500件/回）。
- `--dry-run`: 書き込まず件数だけ表示。既定は dry-run とし、`--execute` で実書き込み。
- 冪等: 同じドキュメントIDに `set` するので再実行しても重複しない。コピー先に既にデータがある場合は警告して `--overwrite` 指定時のみ続行。
- 検証: 実行後、コレクションごとに旧・新の件数を比較して表示。
- 無料枠への配慮: 読み取り・書き込み件数を事前に表示し、1日の無料枠（読み取り5万・書き込み2万）の **50%**（共有プロジェクトは他アプリも同じ枠を使うため）を超える見込みなら中断し、`--collections` での分割実行を案内する。走査は1ドキュメントあたり約3読み取りで見積もる。
- ログに書き込むのは件数とコレクション名のみ（ドキュメント本文は出さない）。

## 3. 切り替え手順（利用者が実施）

各アプリ「切り替え中は使わない」前提（コピー後に旧プロジェクトへ書いたデータは移らない）。

### 事前準備（1回だけ）

1. 共有プロジェクトの Authentication → 設定 → 承認済みドメインに、money-lens・recipe-buddy・fridge-track の Vercel ドメインを追加。
2. household-chore-manager リポジトリから統合ルール・インデックスをデプロイ（手順は `docs/setup.md`）。家事アプリはクライアントから Firestore を使わないので影響しない。
3. 共有プロジェクトのサービスアカウントキー（JSON）を用意（家事アプリで使っているもの、または新規発行）。

### アプリごと（money-lens → recipe-buddy → fridge-track の順）

| 手順 | money-lens | recipe-buddy | fridge-track |
| --- | --- | --- | --- |
| 1. データ移行 | 不要 | スクリプトを dry-run → `--execute` | 同左 |
| 2. Vercel 環境変数 | `VITE_FIREBASE_*` を共有プロジェクトの値に、`FIREBASE_PROJECT_ID` を設定し `FIREBASE_SERVICE_ACCOUNT` を削除（設定が残っていても `FIREBASE_PROJECT_ID` が優先され SA は無視される） | 同左 | `VITE_FIREBASE_*`、`FIREBASE_SERVICE_ACCOUNT` を共有プロジェクトのものに、`INVENTORY_OWNER_UID` を新 uid に（新 uid は共有プロジェクトのコンソール → Authentication → ユーザー の「User UID」で確認。移行スクリプトは uid を表示しない） |
| 3. 再デプロイ | Vercel で Redeploy（`VITE_*` はビルド時に埋め込まれるため必須） | 同左 | 同左 |
| 4. 動作確認 | ログイン・データ表示・AI分析 | ログイン・レシピ一覧・編集・AIアレンジ | ログイン・在庫一覧・レシート読み取り・recipe-buddy からの消費連携 |

### 戻し方

Vercel の環境変数を旧プロジェクトの値に戻して再デプロイする。旧プロジェクトのデータは移行で変更しないので、そのまま戻れる（切り替え後に新側へ書いたデータは戻らない）。

### 旧プロジェクトの削除

全アプリの動作確認後、しばらく（目安1〜2週間）旧プロジェクトを残してから削除する。**削除したプロジェクトは30日間「削除予定」状態になり、その間はプロジェクト数の上限に数えられる**ため、枠が実際に空くのは削除の約30日後。

## 4. 各リポジトリの変更

| リポジトリ | 変更 |
| --- | --- |
| household-chore-manager | 本書、統合ルール・インデックス、ルールのデプロイスクリプトとテスト、移行スクリプトとテスト、`docs/setup.md`・`docs/architecture.md`・`docs/decisions.md` 更新 |
| money-lens | `FIREBASE_PROJECT_ID` のみでの初期化に対応（テスト付き）、`.env.example`・セットアップ文書更新 |
| recipe-buddy | 同上、`firebase/firestore.rules` を削除し正本への案内に置き換え |
| fridge-track | `firebase/firestore.rules` を削除し正本への案内に置き換え、セットアップ文書更新（共有プロジェクト・`INVENTORY_OWNER_UID`） |

いずれもアプリの機能・データ構造は変えない。
