# JARVIS Cockpit — 仕様書（実装版 v1.1）

`jarvis-codex-org`（Codex × ローカル LM Studio × Obsidian の自動化エージェント組織）を、
1 つの管制盤から可視化・操作するアプリケーションの**実装仕様書**。
原仕様書 *JARVIS Cockpit GUI 仕様書 v1.0*（2026-06-27）をベースに、
実装で追加された**ハイブリッド構成（公開Web + ローカルブリッジ）**を反映する。

- 公開アプリ: https://24-zuka.github.io/hello-world/
- リポジトリ: https://github.com/24-Zuka/hello-world

---

## 1. 目的と設計原則

GUI は「薄いラッパー」に徹し、頭脳（推論・判断）は Codex / ローカルモデルに置く。
本アプリは **状態の表示** と **操作の発火** に集中する。

| # | 原則 | 実装上の担保 |
|---|---|---|
| 1 | 薄いラッパー | ロジックは既存 CLI/REST/スクリプトに委譲。独自ロジックは最小。 |
| 2 | 課金ゼロを UI で強制 | API キー入力欄を一切持たない。Codex は ChatGPT ログイン経路のみ。クレジット購入 UI 無し。 |
| 3 | 権限遵守 | 破壊的操作は承認モーダル + dcg ガード。シェルは allowlist のみ。 |
| 4 | 書き物文化の可視化 | Obsidian Vault（MEMORY / AI_Handoff / DECISION_LOG）を一級市民として表示・編集。 |
| 5 | 静かに壊れない | 実依存が未接続でもクラッシュせず「不明 / 未接続」を正直に表示しモックへ縮退。 |
| 6 | JARVIS 的体験 | ダーク基調・低彩度シアン・⌘K パレット・ストリーミングログ。 |

**最重要セキュリティ不変条件**:
- API キー入力欄は UI に存在しない。
- トークンは macOS Keychain のみ。画面・ログ・設定ファイルに平文を出さない。
- `OPENAI_API_KEY` を環境に検出したら Quota 画面で赤旗。
- シェル実行は allowlist（`codex` / `git` / `launchctl` / 同梱スクリプト）に限定し、必ず dcg を通す。
- クレジット購入 UI は存在しない。

---

## 2. アーキテクチャ（3 トランスポート）

フロントエンドは単一の API 窓口（`src/lib/api.ts`）から、3 つの経路を自動選択する。

```
                         ┌─────────────────────────── src/lib/api.ts（唯一の窓口）
                         │  優先順位: Tauri → Bridge → Mock
   ┌─────────────┐       │
   │  React 8画面 │───────┤── Tauri    : デスクトップアプリ（invoke / emit）
   │  (公開 Web)  │       │── Bridge   : 公開Web → ローカル jarvis-bridge（HTTP/SSE）
   └─────────────┘       │── Mock     : browserMock（公開デモ・実依存不要）
                         │
   実連携（Bridge/Desktop 経路）の裏側:
   jarvis_cockpit_core ──▶ codex / git / launchctl / Obsidian REST / LM Studio / Keychain
```

| モード | 接続先 | 用途 |
|---|---|---|
| **Demo（モック）** | `src/lib/browserMock.ts` | 公開 URL で誰でも操作。実依存不要。既定。 |
| **Bridge（実連携）** | Mac で起動する `jarvis-bridge`（`127.0.0.1:8787`） | 公開 UI から実 Codex/LM Studio/Obsidian を操作。 |
| **Desktop** | Tauri 2 `.app`（同梱 Rust） | ネイティブ・デスクトップ。 |

### 2.1 物理制約とハイブリッドの根拠
公開 Web サーバーはユーザーの `localhost`（LM Studio `:1234` / Obsidian `:27123`）や
`codex` CLI・Keychain に到達できない。そこで **ローカルブリッジ**を介在させる。
公開 Web ページ（HTTPS）から `http://127.0.0.1` への fetch / EventSource は、
主要ブラウザの localhost 例外として許可される（CORS + Private Network Access で成立）。

### 2.2 クレート構成（Cargo ワークスペース `src-tauri/`）
頭脳を GUI 非依存の `core` に集約し、Tauri とブリッジの 2 トランスポートで共有する。

```
src-tauri/
├── core/    jarvis-cockpit-core : models / state / exec / obsidian / secrets / mock / commands
│            GUI 非依存。Linux でビルド/テスト可。
├── bridge/  jarvis-bridge       : axum HTTP/SSE サーバー（core を再利用、127.0.0.1 専用）
├── dcg/     dcg                 : Destructive Command Guard（独立・単体テスト可）
└── src/     jarvis-cockpit      : Tauri デスクトップ層（core への薄い #[tauri::command] ラッパ）
```

- **EventSink トレイト**（`core::exec`）でイベント配信を抽象化:
  Tauri 実装 = `AppHandle::emit` / ブリッジ実装 = tokio broadcast → SSE。
- `core::commands::*` は `&Cockpit`（状態）+ `Arc<dyn EventSink>`（配信）を受け取る純関数。
  Tauri コマンドとブリッジ HTTP ハンドラが同じ関数を呼ぶ。
- `resolver = "2"` により、Linux では `cargo build -p jarvis-bridge` で
  core+bridge+dcg のみコンパイル（tauri/webkit は不要）。

---

## 3. 技術スタック

| 層 | 採用 |
|---|---|
| フロント | React 18 + TypeScript + Vite + Tailwind CSS + Zustand。チャートは軽量 SVG。 |
| デスクトップ | Tauri 2（Rust コア + WebView）。単一 `.app` / `.dmg`。 |
| ブリッジ | Rust + axum + tokio + tokio-stream（SSE）。reqwest は rustls（openssl 不要）。 |
| 共有コア | Rust（serde / tokio / reqwest / thiserror）。 |
| 配信 | GitHub Pages（フロント）+ GitHub Actions（Pages デプロイ / macOS バイナリ）。 |

---

## 4. 画面仕様（8 画面）

各画面は `src/lib/api.ts` のみに依存し、トランスポートを意識しない。

| 画面 | 役割（操作 → 裏側） |
|---|---|
| **Dashboard**（司令室） | ヘルスバー（Codex/LM Studio/Obsidian + 経路ピル）/ Plus 残量 SVG ゲージ（取得不能時「不明」）/ 今日のブリーフ（最新 Daily 抜粋 = `vault_read`）/ アクティブ（実行中スレッド・ジョブ数・退避モード）/ クイックアクション（朝会・レビュー・調査）。 |
| **Agents**（組織図） | AI 6 体（秘書/開発/レビュー/調査/運用/戦略）+ Codex サブエージェント。ノード = 名前/役割/割当モデル/権限/状態。右ペインに詳細。人格定義は `Agents/*.md`（Obsidian）由来。 |
| **Build**（開発パイプライン） | Worktree 一覧（`worktree_list`）/ ビルド（`codex_build` → JSONL を LogStream に逐次表示）/ ローカルレビュー（HIGH/MEDIUM/LOW）/ DiffViewer / **main マージは要承認モーダル**。並列上限 4。 |
| **Memory**（記憶 / Vault） | 左ツリー（`vault_tree`）/ 中央 Markdown 編集・プレビュー / 右全文検索（`vault_search`）。Handoff・DecisionLog はタイムライン。編集 = PATCH(heading)/PUT、**MEMORY 上書き・削除は要承認**（削除はゴミ箱経由）。 |
| **Schedule**（定時運用） | launchd ジョブ一覧（`launchd_list`）/ トグル（load/unload）/ 今すぐ実行 / 時刻編集 / 最終ログ tail。 |
| **Research**（調査） | 自動スキャン（`research_scan` → Inbox ブリーフ）/ 手動ステーション外部リンク（Gemini Deep Research・NotebookLM、「自動化不可」明記）/ 結果取込。 |
| **Quota & Cost**（コスト管制） | 5h ウィンドウ使用率 / 認証経路（ChatGPT✓ / `OPENAI_API_KEY` 検出時**赤旗**）/ **クレジット購入「無効」固定** / 退避モード / 既定モデル切替（要確認）。 |
| **Settings**（設定） | **ブリッジ接続**（URL + Token、接続/切断）/ パス / トークン（Keychain 保存・平文非表示・**API キー欄なし**）/ MCP トグル / LM Studio 疎通テスト / `codex login` 起動。 |

横断機能（`src/components/`）: 承認モーダル / ⌘K コマンドパレット / トースト / 空・エラー状態は「直し方」を一文提示。

---

## 5. IPC 契約（§7）

`src/lib/api.ts` が唯一の窓口。Tauri 内なら `invoke`、Bridge なら HTTP `POST /invoke/:cmd`、
それ以外は browserMock。引数キーは 3 経路で一致する。

### 5.1 Commands（26）
`health_check` / `codex_auth_status` / `codex_login` / `quota_status` /
`mcp_list` / `mcp_toggle(name, enabled)` /
`worktree_list(repo)` / `worktree_create(repo, feature)` /
`codex_build(worktree, prompt, profile?)` / `local_review(worktree, base)` /
`git_diff(worktree, base)` / `git_merge(worktree, base)` ［要承認］/
`vault_tree` / `vault_read(path)` / `vault_write(path, content, mode, heading?)` /
`vault_delete(path)` ［要承認］/ `vault_search(query)` /
`launchd_list` / `launchd_toggle(label, on)` / `launchd_run_now(label)` / `launchd_set_time(label, hour, minute)` /
`research_scan(topic)` /
`config_get_model` / `config_set_model(model)` ［要確認］/
`secret_set(key, value)` / `settings_get` / `settings_set(patch)`

### 5.2 Events（6）
`job:log` / `job:event` / `job:done` / `health:tick` / `quota:tick` / `notify`
（Tauri = emit、Bridge = SSE `GET /events` で `{event, payload}` 行を配信、5 秒間隔で health/quota tick）。

### 5.3 実コマンド対応（§3.1）
ビルド = `codex exec --json`（JSONL 逐次解析）/ 認証 = `codex login status` / MCP = `codex mcp list --json` /
Plus 残量 = セッション `/status` パース（§12: 公式 API 無し・取得不能時 `source:"unknown"`）/
LM Studio = `GET :1234/v1/models` / Obsidian = `GET/PUT/PATCH/DELETE :27123`（Bearer）/
launchd = `launchctl list|load|unload` / git = `git worktree list --porcelain` ほか。
スクリプト導線（`scripts/`、Settings でパス指定）: `morning_meeting.sh` / `worktree_new.sh` /
`codex_build.sh` / `local_review.sh` / `research_scan.sh`。

---

## 6. データモデル（§8）

`src/types.ts`（TS）と `core/src/models.rs`（Rust serde）で命名一致。主要型:
`Status(ok|warn|down|unknown)` / `Health` / `AuthStatus` / `Quota(source: parsed|unknown)` /
`McpServer` / `Agent` / `Worktree` / `Job` / `VaultNode` / `SearchHit` / `ScheduleJob` /
`TaskCard`（§14.4）/ `AppSettings` / `ApprovalRequest` / `ReviewFinding`。

---

## 7. セキュリティ仕様

### 7.1 承認モーダル（§5, §14.3）
`risk_score >= 3.0` または §9 権限表の「要承認」操作（main マージ / ノート削除 / MEMORY 上書き /
モデル変更 / 外部送信）で必ず表示。Approve / Feedback（差し戻し）/ Reject。

### 7.2 dcg — Destructive Command Guard（§14.2, `src-tauri/dcg`）
全プロセス起動を allowlist 通過後にゲート。3 段解析:
①Quick Reject ②Context Classification（コミットメッセージ等のデータ語を除外し誤検知防止）③遮断時 exit 2 + 理由 + `notify`。
ルールパック: `core.filesystem`(rm -rf) / `core.git`(reset --hard) / `core.git:force-push`(main へ force) / `system.disk`(dd/mkfs/fdisk)。
受け入れテスト 8 件（§14.7）が `cargo test -p dcg` で通過。

### 7.3 ブリッジのセキュリティ（実装追加）
- **127.0.0.1 のみ bind**（LAN/外部に非公開）。
- **Bearer トークン**必須（起動時生成・標準エラー表示・再起動で無効化）。`/events` は `?token=` 許可。
- **Origin allowlist**（公開 Web オリジン + ローカル開発のみ。他オリジンは 403）。
- **CORS + Private Network Access**（`access-control-allow-private-network: true`）。
- シェル起動は `core::exec::guard`（allowlist + dcg）を必ず通過。
- 秘密は Mac の Keychain に留まり、フロントへは渡さない。`/health` のみ無認証。

### 7.4 トークン / API キー
Keychain のみ（`security` CLI、非 macOS では平文保存せずエラー）。`OPENAI_API_KEY` 検出で赤旗。

---

## 8. デザイン言語（§6）

ダーク基調 `#0E1116` 系 + 低彩度シアン/ティールのアクセント。状態色 緑=正常/黄=警告/赤=要対応。
本文サンセリフ、ログ/コード/差分は等幅。Dashboard は要約密度高め。モーション控えめ（ストリーミングログのみ強調）。
コントラスト WCAG AA、キーボード操作で完結。

---

## 9. ビルド・実行・配布

### 9.1 公開 Web（誰でも・モック）
`npm ci && npm run build && npm run preview`（`http://localhost:5180`）。
公開は GitHub Pages（`.github/workflows/deploy-pages.yml`、push で自動デプロイ）。

### 9.2 実連携（ハイブリッド）→ [docs/BRIDGE.md](BRIDGE.md)
1. ブリッジ入手: Actions「Build bridge (macOS)」の Artifact（Apple Silicon+Intel universal）
   または `cd src-tauri && cargo build -p jarvis-bridge --release`。
2. `./jarvis-bridge` 起動 → 表示 Token をコピー。
3. 公開アプリ Settings →「ブリッジ接続」に URL（`http://127.0.0.1:8787`）と Token を貼付 → 接続。
4. `codex login` / LM Studio Local Server / Obsidian REST 有効化で各依存が緑に。

### 9.3 デスクトップ（macOS 実機）→ [docs/SETUP_MAC.md](SETUP_MAC.md)
`npm run tauri dev` / `npm run tauri build`（`.app` / `.dmg`）。

### 9.4 テスト（Linux で実施可）
`cargo build -p jarvis-bridge` / `cargo test -p dcg` / `npm run build`（tsc 型チェック + Vite）。

---

## 10. 受け入れ基準（§13 + §14.7）

- ヘルス 3 点が実状態を反映（実依存未接続なら「不明/down」へ縮退）。
- GUI のみで worktree → ビルド → レビュー → 差分が完結し、ログが逐次表示される。
- main マージ / MEMORY 上書き / ノート削除は承認モーダルなしに実行されない。
- `OPENAI_API_KEY` 設定時に Quota 画面で赤旗。クレジット購入 UI が存在しない。
- Plus 残量が取得できない場合「不明」と正直に表示。
- トークンは Keychain のみ・平文非表示。API キー入力欄が存在しない。
- dcg が `rm -rf /` / `git reset --hard` / main への force-push を exit 2 で遮断。コミットメッセージは誤遮断しない。
- 3 トランスポート（Tauri / Bridge / Mock）が同一 UI で切替可能。Bridge 接続時は実 HTTP/SSE で往復する。

---

## 11. ディレクトリ構成

```
src/                React フロント（screens / components / lib / store）
  lib/api.ts        Tauri / Bridge / mock の 3 トランスポート切替（唯一の窓口）
  lib/bridge.ts     ブリッジ・クライアント（fetch invoke + EventSource SSE）
  lib/browserMock.ts 公開デモ用モック IPC
src-tauri/          Cargo ワークスペース（core / bridge / dcg / Tauri 層）
scripts/            jarvis-codex-org スクリプトのプレースホルダ / 契約
docs/               SPEC.md（本書）/ BRIDGE.md / SETUP_MAC.md
.github/workflows/  deploy-pages.yml / bridge-release.yml
```
