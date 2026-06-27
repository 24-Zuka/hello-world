# scripts/

JARVIS Cockpit は独自ロジックを極力持たず、既存の CLI・スクリプトを呼ぶ薄い操作層です（§0.2, §1）。
ここに置くスクリプトは `jarvis-codex-org` キット側の実体（通常は `~/.codex/scripts/`）への
**プレースホルダ / 契約定義**です。Settings 画面の「scripts パス」で実体の場所を指定してください。

| スクリプト | 呼び出し元（画面） | 引数 |
|---|---|---|
| `morning_meeting.sh` | Dashboard / Schedule | （なし） |
| `worktree_new.sh` | Build | `<repo> <feature>` |
| `codex_build.sh` | Build | `<worktree> "<prompt>" <profile>` |
| `local_review.sh` | Build | `<worktree> <base>` |
| `research_scan.sh` | Research | `"<topic>"` |

各スクリプトは `codex exec --json` などを起動し、JSONL を標準出力へ逐次出力する想定です
（Cockpit の `exec.rs` が行単位で `job:log` / `job:event` として中継します）。
