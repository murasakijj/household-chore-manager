# household-chore-manager — Claude Code ガイド

家事を「定期メンテナンス対象」として管理する個人用Webアプリ。ドメイン仕様は `household-chore-manager-design.md`（設計書）が正。

## 文書

| 文書 | 内容 |
| --- | --- |
| [docs/decisions.md](../docs/decisions.md) | 技術スタック・AI用途・キャッシュ等の決定 |
| [docs/architecture.md](../docs/architecture.md) | 構成・データモデル・API・画面・環境変数 |
| [docs/implementation-plan.md](../docs/implementation-plan.md) | バッチ単位の実装順 |

設計とズレる実装をしたくなったら、勝手に変えず docs を直してから（必要ならユーザーに確認して）コードを書く。

## 絶対に守るルール

1. 状態判定は `api/_lib/domain/status.ts` の純粋関数のみ。設計書 §7.4 の境界値を厳守し、クライアントで判定式を再実装しない
2. 実施履歴は追加のみ。最終実施日時の上書き・履歴の物理削除をしない（取消は `voidedAt`）
3. cron 以外の全 `/api/*` は `requireAuth` → `resolveContext` を通し、`householdId` はサーバーで解決したものだけを使う
4. 秘密の環境変数に `VITE_` を付けない。`dangerouslySetInnerHTML` を使わない
5. AI出力は zod で検証し、利用者の確認なしに保存しない
6. 設計書 §4.2 の対象外機能を実装しない（AIは decisions.md の2機能のみ）

## コマンド

```
npm run dev     # フロント開発サーバー（/api は vercel dev で）
npm run build   # tsc -b && vite build
npm test        # vitest run
npm run lint
```
