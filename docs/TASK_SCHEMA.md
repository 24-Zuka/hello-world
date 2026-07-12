# AIRFLOW Task Schema

正本は `src/types.ts` と `src-tauri/core/src/models.rs` です。TaskはSQLiteへJSON本体と実行索引用列を保存します。

## 状態

`DRAFT -> READY -> QUEUED -> ROUTING/RUNNING -> AI_REVIEW -> COMPLETED`

例外状態は `AWAITING_INPUT`、`AWAITING_APPROVAL`、`FAILED`、`CANCELLED`、`ARCHIVED` です。不正な遷移はRust状態機械が拒否します。

## 二重実行防止

- `BEGIN IMMEDIATE` トランザクション内で候補を選択します。
- 同時に `status=RUNNING`、`lease_owner`、`lease_expires_at`、`attempt_count` を更新します。
- 期限切れリースは `QUEUED` へ回収します。
- 依存Taskが全て `COMPLETED` になるまで取得しません。

## 後方互換

旧Markdown ticketの `id/category/status/priority/created/updated/tier/links/log` は移行用フィールドとして保持します。初回のSQLiteが空の場合、既存 `tickets/*.md` を読み込んでupsertします。

