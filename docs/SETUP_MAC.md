# JARVIS Cockpit — macOS 実機セットアップ & 実連携ガイド

このドキュメントは、**実際の連携**（Codex / LM Studio / Obsidian）を有効にして
JARVIS Cockpit を Mac 上で動かすための手順です。

> **なぜ Mac 実機が必要か**: Cockpit はローカル専用の管制盤です（仕様 §0.2, §9）。
> Codex CLI・LM Studio（`localhost:1234`）・Obsidian Local REST API（`localhost:27123`）は
> いずれもあなたのマシン上のローカルサービスで、トークンは Keychain にのみ保存されます。
> 公開 Web デモ（GitHub Pages）は `browserMock` による**シミュレーション**で、
> 実サービスへは技術的に接続できません。実連携はこの手順で**ローカルアプリ**として動かします。

公開デモ（モックデータ・閲覧用）: https://24-zuka.github.io/hello-world/

---

## 0. 前提ツール

| ツール | 用途 | 導入 |
|---|---|---|
| Xcode Command Line Tools | Rust ビルドのリンカ等 | `xcode-select --install` |
| Rust toolchain | Tauri コア | `curl https://sh.rustup.rs -sSf \| sh` |
| Node.js 20+ | フロントビルド | `brew install node` または公式 |
| codex CLI | ビルド/レビュー/認証 | jarvis-codex-org キットの導入手順に従う |
| LM Studio | ローカル推論（退避先） | https://lmstudio.ai |
| Obsidian + Local REST API プラグイン | Vault 読み書き | Obsidian コミュニティプラグイン |

## 1. 取得とビルド

```bash
git clone https://github.com/24-Zuka/hello-world.git
cd hello-world
npm ci

# 開発起動（ホットリロード）
npm run tauri dev

# 署名なし .app / .dmg を生成（src-tauri/target/release/bundle/ に出力）
npm run tauri build
```

> アイコンを綺麗にしたい場合は実機で一度だけ:
> `npm run tauri icon src-tauri/icons/icon.png`（全サイズ + .icns を生成）。

署名していない `.app` は Gatekeeper に止められます。初回は **右クリック →「開く」**、
または `xattr -dr com.apple.quarantine "JARVIS Cockpit.app"` で解除してください。

## 2. 実依存の準備（ここが「実連携」）

### 2-1. Codex（認証は ChatGPT 経路のみ・API キー不要）

```bash
codex login        # ブラウザで ChatGPT ログイン。OPENAI_API_KEY は使わない（§9）
codex login status # logged_in / method: chatgpt を確認
```

> 環境に `OPENAI_API_KEY` があると Quota 画面が**赤旗**を出します（課金事故防止, §9）。
> 検出されたら `unset OPENAI_API_KEY` で外してください。

### 2-2. LM Studio（退避モードの推論先）

1. LM Studio を起動し、モデルを 1 つロード。
2. **Local Server** を開始（既定で `http://localhost:1234`）。
3. Settings 画面の「LM Studio エンドポイント」で **疎通テスト** → `接続 OK` を確認。

### 2-3. Obsidian Local REST API（Vault 連携）

1. Obsidian で **Local REST API** プラグインを有効化。
2. プラグイン設定で API キーを発行（既定ポート `27123`）。
3. Cockpit の **Settings → トークン** に貼り付け「**Keychain に保存**」。
   入力欄は保存後に即クリアされ、平文は画面・ログ・ファイルに残りません（§9）。
4. Settings 画面で **Vault パス**を実際の Vault に設定。

### 2-4. スクリプト導線

`scripts/` のプレースホルダ（`morning_meeting.sh` / `worktree_new.sh` / `codex_build.sh` /
`local_review.sh` / `research_scan.sh`）を jarvis-codex-org キットの実体に差し替えるか、
**Settings → scripts パス**で実体（通常 `~/.codex/scripts`）を指定します。各スクリプトは
`codex exec --json` 等を起動し JSONL を標準出力へ流す契約です（`scripts/README.md` 参照）。

## 3. 初回オンボーディングの確認

1. アプリ起動 → 上部ヘルスバーの **Codex / LM Studio / Obsidian** が緑になること。
2. **Build**: worktree 一覧が実リポジトリを反映 → ビルド実行で実 JSONL ログが流れること。
3. **Memory**: 実 Vault のツリー・本文が表示され、編集が Obsidian に反映されること。
4. **Quota**: API キー未検出（緑）、クレジット購入が「無効」固定であること。
5. `main` マージ / MEMORY 上書き / ノート削除で**承認モーダル**が必ず挟まること（§14.3）。

## 4. 安全装置の確認（任意）

```bash
# 破壊的コマンド改札（GUI 不要・単体テスト）
cd src-tauri/dcg && cargo test
```

`rm -rf /` / `git reset --hard` / `main` への `git push --force` を exit code 2 で遮断し、
コミットメッセージ内の文字列は誤遮断しないことを 8 件のテストで検証します（§14.7）。

## 5. トラブルシュート

| 症状 | 対処 |
|---|---|
| ヘルスが赤（Codex） | `codex login status` を確認。PATH に `codex` が通っているか。 |
| ヘルスが赤（Obsidian） | プラグイン有効化・ポート 27123・Keychain のトークンを再確認。 |
| ヘルスが黄/赤（LM Studio） | Local Server 起動とモデルのロードを確認。Settings で疎通テスト。 |
| `.app` が開けない | 右クリック→開く、または `xattr -dr com.apple.quarantine`。 |
| Quota が赤旗 | `OPENAI_API_KEY` を環境から外す（`unset`）。 |
