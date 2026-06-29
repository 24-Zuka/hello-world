# AIRFLOW

**AI×人間ハイブリッドのタスクボード基盤** — AI（スケジュール実行）と人間が同じ
ボードを参照・更新し、`handoff_note`（引継ノート）で非同期にバトンを渡す。
ボード自体が「次の担当者向けブリーフィング文書」になる設計。

> 仕様の全文は [`AirFlow_PRD_Codex.md`](./AirFlow_PRD_Codex.md)、実装計画は
> [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) を参照。

## 構成

| 要素 | 実体 |
|---|---|
| REST API + UI | Next.js (App Router) + TypeScript（`src/`） |
| ストレージ | `data/board.json`（処理中）/ `data/archive.json`（完了）。DB不要 |
| ディスパッチャー | `dispatcher/run.js`（launchd で定時起動 → Codex に1件ずつ委譲） |
| 安全機構 | deny list / STOP ファイル / dispatcher-lock / 重複生成防止 |

## セットアップ（Phase 1 = localhost）

```bash
cd airflow
npm install
cp .env.local.example .env.local   # 各トークンをランダム文字列に置換
npm run build                       # 型チェック + Next.js ビルド
npm run dev                         # http://localhost:3000
```

トークン生成例: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

UI を開くと `X-Board-Token` の入力を求められる。`.env.local` の `TOKEN_HUMAN`
を貼ると 5 カラム（needs-ai / in-progress / needs-human / blocked / done）の
カンバンが表示され、カードを押すと `handoff_note` と `activity` 履歴が読める。

## API（§5）

すべて `X-Board-Token` ヘッダー必須（不一致は **403**）。

| メソッド | パス | 処理 |
|---|---|---|
| GET | `/api/board` | 全件取得 |
| GET | `/api/board/{id}` | 1件取得（無ければ 404） |
| POST | `/api/board` | 新規作成（`T0001` 自動採番・重複 title は 409） |
| PATCH | `/api/board/{id}` | 部分更新（`updated_at` と `activity` を自動追記） |
| POST | `/api/board/{id}/complete` | archive へ移動し board から削除 |
| GET | `/api/archive` | 完了タスク全件 |

## 動作確認（受け入れ基準 §17）

サーバを起動した別ターミナルで:

```bash
TOKEN_HUMAN=<.env.local と同じ値> npm run smoke
```

403 / 自動採番 / 重複防止 / PATCH の activity 追記 / 404 / complete 移動を検証する。

## ディスパッチャー（§8）

```bash
# 1件 needs-ai / owner: ai-batch のタスクを作ってから:
npm run dispatch        # = node dispatcher/run.js
```

- 冒頭で `STOP` ファイルを確認（`touch STOP` で全停止 / 削除で再開）。§11.3
- `needs-ai` かつ `owner=ai-batch`、`dispatcher-lock` タグなしを priority 順で **1件だけ** 処理。
- `codex` バイナリが無い環境ではスタブ実行し `needs-human` に差し戻す（クラッシュしない）。
- 処理エラーは `blocked` + `blocked_reason` に記録。
- 72時間更新の無いタスクを自動 `blocked` にする（§7.1）。

毎朝07:30の自動化は `launchd/com.airflow.dispatcher.plist`（§8.5）を
`~/Library/LaunchAgents/` に置き `launchctl load` する。

## 朝礼エージェント（§13）

`prompts/morning-standup.md` を `codex` か ChatGPT に投入する。カレンダー連携は
Gemini / ChatGPT コネクタ / ローカル ICS のいずれか（PRD §13.1.1）。

## 安全機構（§11）

- **deny list**（`dispatcher/deny-list.js` ＋ `AGENTS.md`）: `rm -rf` /
  `git push --force` / `git reset --hard` / `.env`・plist・config 上書き /
  破壊的DB / 外部送信。バッチ時は実行せず `needs-human` に差し戻す。
- **STOP** ファイル / **dispatcher-lock** タグ（自己改変ループ防止）/ 重複生成防止。

## Phase 2（クラウド移行・§16）

外出先から使う場合のみ Vercel + Vercel Blob に移行する。**public アクセス禁止＋
`X-Board-Token` 必須**を必ず確認すること（§11.6）。ローカルで安全だった前提は
クラウドでは変わる。`storage.ts` のファイル読み書きを Blob API に差し替え、
`BLOB_READ_WRITE_TOKEN` を設定する。
