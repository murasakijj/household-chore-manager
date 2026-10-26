# migrate-firebase

旧 Firebase プロジェクトの Firestore データを、共有プロジェクトへコピーするスクリプト
(recipe-buddy / fridge-track 用)。仕様は [docs/firebase-consolidation.md §2.3](../../docs/firebase-consolidation.md)。
利用者がローカルで実行する。

## 事前に必要なもの

- 旧プロジェクトのサービスアカウントJSON(Firebase Console > プロジェクトの設定 > サービスアカウント)
- 共有プロジェクトのサービスアカウントJSON
- 共有プロジェクトに本人が一度ログイン済みであること(household-chore-manager 等で。
  未ログインだと新 uid を解決できず中断する)
- 移行中は対象アプリを使わない(コピー後に旧側へ書いたデータは移らない)

JSON はリポジトリに置かない(`.gitignore` 対象外)。作業後は削除すること。

## 使い方

```bash
# 1. dry-run(既定。件数と無料枠の見積もりだけ表示、書き込まない)
npm run migrate:firebase -- --app recipe-buddy --email you@gmail.com \
  --old-service-account /path/old.json --new-service-account /path/new.json

# 2. 実書き込み
npm run migrate:firebase -- --app recipe-buddy --email you@gmail.com \
  --old-service-account /path/old.json --new-service-account /path/new.json --execute
```

| オプション | 内容 |
| --- | --- |
| `--app` | `recipe-buddy`(`recipes`, `techniques`)または `fridge-track`(`foodItems`, `inventoryLots`, `inventoryEvents`, `receipts`, `receiptItems`, `receiptFoodMappings`, `consumptionProfiles`, `recipeConsumptions`) |
| `--email` | 本人のメール。旧・新それぞれの Auth で `getUserByEmail` して uid を解決する |
| `--old-service-account` / `--new-service-account` | サービスアカウントJSONのパス |
| `--execute` | 実際に書き込む(無ければ dry-run) |
| `--overwrite` | コピー先の対象コレクションに既存データがあっても続行(同じIDのドキュメントは置換) |

## 動作

- 旧 `users/{旧uid}`(ドキュメントがあれば)と、対象アプリのコレクションだけを再帰的に
  新 `users/{新uid}` 配下へ同じIDでコピーする。対象外のコレクションはコピーしない。
  Timestamp などの型は保持される(同じ Admin SDK で読み書きするため)。
- 500件ずつバッチ書き込み。同じIDへの `set` なので、`--overwrite` 付きの再実行で重複しない。
- コピー先に既存データがあり `--overwrite` が無ければ中断する。
- 実行後、コレクションごとに旧・新の件数を比較して表示する(不一致なら異常終了)。
- 読み取り・書き込み件数の見積もりを表示し、1日の無料枠(読み取り5万・書き込み2万)を
  超える見込みなら中断する。その場合は `--app` ごとに日を分けて実行する。
- ログに出るのは件数・コレクション名のみ(ドキュメント本文・メールは出さない)。
- 旧プロジェクトのデータは変更しない(戻し方は計画書 §3)。

## 制限

- ドキュメント参照型(DocumentReference)のフィールドは旧プロジェクトを指したままになる
  (4アプリのデータには使われていない)。
- `FIRESTORE_EMULATOR_HOST` が設定されていると実プロジェクトに繋がらないため中断する。

## テスト

コア処理(`copy.ts`)はエミュレータでテストされる: `npm run test:emulator`
(`copy.emulator.test.ts`。同一エミュレータ内の2つの projectId で旧・新を模擬)。
