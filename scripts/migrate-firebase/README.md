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

実行前提: PR #3 をマージした後の main、またはこのブランチで実行する(未マージの main では
`Missing script: migrate:firebase`)。初回は `npm install`(`tsx` が devDependency)。

JSON はリポジトリの外(Windows 例 `C:\keys\old-sa.json`、macOS/Linux 例 `~/keys/old-sa.json`。
先頭の `~` はホームディレクトリに展開される)に置く(誤コミット防止に `*service-account*.json` / `*-sa.json` は `.gitignore` 済み)。作業後は削除すること。

## 使い方

どのシェル(bash / PowerShell / cmd)でもそのまま動く1行形式。

1. dry-run(既定。件数と無料枠の見積もりだけ表示、書き込まない)

```
npm run migrate:firebase -- --app recipe-buddy --email you@gmail.com --old-service-account C:\keys\old-sa.json --new-service-account C:\keys\new-sa.json
```

2. 実書き込み(同じコマンドに `--execute` を付ける)

```
npm run migrate:firebase -- --app recipe-buddy --email you@gmail.com --old-service-account C:\keys\old-sa.json --new-service-account C:\keys\new-sa.json --execute
```

macOS/Linux ではパスを `~/keys/old-sa.json` のように書いてもよい。`npm run ... -- --flag` の `--` は
PowerShell 7 / 5.1 でも通常そのまま渡る。渡らない場合は `npx tsx scripts/migrate-firebase/cli.ts --app ...` と直接実行する。

| オプション                                        | 内容                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--app`                                           | `recipe-buddy`(`recipes`, `techniques`)または `fridge-track`(`foodItems`, `inventoryLots`, `inventoryEvents`, `receipts`, `receiptItems`, `receiptFoodMappings`, `consumptionProfiles`, `recipeConsumptions`) |
| `--email`                                         | 本人のメール。旧・新それぞれの Auth で `getUserByEmail` して uid を解決する                                                                                                                                   |
| `--old-service-account` / `--new-service-account` | サービスアカウントJSONのパス                                                                                                                                                                                  |
| `--execute`                                       | 実際に書き込む(無ければ dry-run)                                                                                                                                                                              |
| `--overwrite`                                     | コピー先の対象コレクションに既存データがあっても続行(同じIDのドキュメントは置換)                                                                                                                              |

## 動作

- 旧 `users/{旧uid}`(ドキュメントがあれば)と、対象アプリのコレクションだけを再帰的に
  新 `users/{新uid}` 配下へ同じIDでコピーする。対象外のコレクションはコピーしない。
  Timestamp などの型は保持される(同じ Admin SDK で読み書きするため)。
- 500件ずつバッチ書き込み。同じIDへの `set` なので、`--overwrite` 付きの再実行で重複しない。
- コピー先に既存データがあり `--overwrite` が無ければ中断する。
- 実行後、コレクションごとに旧・新の件数を比較して表示する(不一致なら異常終了)。
- 読み取り・書き込み件数の見積もりを表示する(走査は1ドキュメントあたり約3読み取り。
  dry-run の走査自体の読み取りも含む。コピー後の検証は書いたドキュメントの再読込で1件1読み取り)。
  共有プロジェクトは他アプリも同じ無料枠を使うため、1日の無料枠(読み取り5万・書き込み2万)の
  **50%** を超える見込みなら中断する。その場合は `--collections a,b` でコレクションを分け、
  日をまたいで実行する。`--overwrite`・件数比較は指定したコレクション単位。
  `users/{uid}` 本体はコピー先に無いときだけコピーする(`--overwrite` で置換)ので、
  分割実行の2回目以降も衝突扱いにならない。
- 新 uid は表示しない。fridge-track の `INVENTORY_OWNER_UID` には、共有プロジェクトの
  Firebase Console → Authentication → ユーザー の「User UID」を設定する。
- サービスアカウントJSONの読み込みに失敗したときは、旧・新の両方を確認したうえで、失敗したものの
  ラベル・パス・理由(存在しない/読めない/JSONとして不正/UTF-16/`project_id`・`type`・`private_key`・
  `client_email` の不足)をまとめて表示する。ファイルの中身は表示しない。UTF-8 の BOM は無視する。
- ログに出るのは件数・コレクション名のみ(ドキュメント本文・メールは出さない)。
- 旧プロジェクトのデータは変更しない(戻し方は計画書 §3)。

## トラブルシュート(サービスアカウントJSON)

PowerShell での確認:

```
Get-ChildItem C:\keys
Test-Path C:\keys\old-sa.json
(Get-Content C:\keys\old-sa.json -Raw | ConvertFrom-Json).project_id
```

- 拡張子が隠れていると `old-sa.json.json` になっていることがある。`Get-ChildItem` で実際の名前を確認する。
- メモ帳や PowerShell 5.1 の `Out-File` などで保存し直すと文字コードが UTF-16 に変わり読めなくなる。
  その場合は Firebase Console からキーをダウンロードし直し、編集・保存し直さない。

## 制限

- ドキュメント参照型(DocumentReference)のフィールドは旧プロジェクトを指したままになる
  (4アプリのデータには使われていない)。
- `FIRESTORE_EMULATOR_HOST` が設定されていると実プロジェクトに繋がらないため中断する。

## テスト

コア処理(`copy.ts`)はエミュレータでテストされる: `npm run test:emulator`
(`copy.emulator.test.ts`。同一エミュレータ内の2つの projectId で旧・新を模擬)。
