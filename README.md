# JARVIS Cockpit

`jarvis-codex-org`（Codex × ローカル LM Studio × Obsidian の自動化エージェント組織）を、
1 つのローカル・デスクトップ管制盤から可視化・操作するための GUI です。
仕様書 *JARVIS Cockpit GUI 仕様書 v1.0*（2026-06-27）に基づく v1 実装。

> 🌐 **公開Webアプリ**: https://24-zuka.github.io/hello-world/
> ブラウザだけで 8 画面を操作できます。バックエンドは 3 トランスポートで動作:
>
> | モード | 接続先 | 用途 |
> |---|---|---|
> | **Demo（モック）** | `browserMock` | 公開URLで誰でもお試し。既定。 |
> | **Bridge（実連携）** | Mac で起動する `jarvis-bridge`（127.0.0.1） | 公開UIから実 Codex/LM Studio/Obsidian を操作（ハイブリッド）。→ [docs/BRIDGE.md](docs/BRIDGE.md) |
> | **Desktop** | Tauri `.app`（同梱 Rust） | ネイティブ・デスクトップ。→ [docs/SETUP_MAC.md](docs/SETUP_MAC.md) |
>
> 公開Webサーバーは localhost に届かないため、**実連携はローカルブリッジが仲介**します
> （秘密は Mac の Keychain に留まる, §9）。Settings →「ブリッジ接続」で URL とトークンを入力。

> **設計の核**: GUI は薄いラッパー。頭脳は Codex / ローカルモデルに置き、本アプリは
> 「状態の表示」と「操作の発火」に徹します。**課金ゼロの規律を UI レベルで強制**し、
> API キー入力欄を一切持ちません（§0.2, §9）。

## 技術スタック

- **シェル**: Tauri 2（Rust コア + WebView）。単一 `.app`、サーバー常駐不要。
- **フロント**: React + TypeScript + Vite + Tailwind CSS + Zustand。チャートは軽量 SVG。
- **バックエンド**: Rust（Tauri commands/events）。プロセス実行・JSONL 解析・REST・Keychain。

## 画面（§4）

| 画面 | 役割 |
|---|---|
| Dashboard | ヘルス・Plus 残量・今日のブリーフ・クイックアクション |
| Agents | AI 組織図とサブエージェント、権限・割当モデルの可視化 |
| Build | worktree → ビルド → ローカルレビュー → 差分（JSONL ログを逐次表示） |
| Memory | Obsidian Vault の閲覧/編集、Handoff/DecisionLog のタイムライン |
| Schedule | launchd ジョブ（朝会など）の管理 |
| Research | 自動スキャン発火・手動ステーション導線・結果取込 |
| Quota & Cost | 課金ゼロを守る要塞（残量・退避モード・APIキー赤旗） |
| Settings | パス・トークン(Keychain)・MCP・LM Studio 疎通・ログイン |

## 安全装置

- **承認モーダル**（§5, §14.3）: `risk_score >= 3.0` または「要承認」操作（main マージ /
  ノート削除 / MEMORY 上書き / モデル変更）で必ず確認を挟む。
- **dcg — Destructive Command Guard**（§14.2, `src-tauri/dcg/`）: すべての外部プロセス起動を
  allowlist 通過後にゲート。`rm -rf /`・`git reset --hard`・main への `git push --force` 等を
  exit code 2 で遮断。コミットメッセージ内のテキストは誤遮断しない。
- **APIキー検出**（§9）: 環境に `OPENAI_API_KEY` があれば Quota 画面に赤旗。
- **Plus 残量**（§12）: 公式 API が無いため取得不能時は「不明」を正直に表示。
- **トークン**: Keychain のみ。画面・ログ・設定ファイルに平文を出さない。

## 開発・起動

### フロント単体（ブラウザで UI 確認 / この環境でも可）

```bash
npm install
npm run build      # tsc 型チェック + Vite ビルド
npm run preview    # http://localhost:5180
```

Tauri ランタイム外ではバックエンドを `src/lib/browserMock.ts` が代替し、8 画面を
モックデータで操作確認できます（実依存 = Codex / Obsidian / LM Studio は不要）。

### デスクトップアプリ（macOS 実機）

前提: Rust toolchain、`codex`（ChatGPT ログイン済み）、LM Studio、Obsidian Local REST API。

```bash
npm install
npm run tauri dev      # 開発起動
npm run tauri build    # 署名付き .app / dmg を生成
```

実依存への接続は実機で行います。`scripts/` のプレースホルダを実体（通常は
`~/.codex/scripts/`）に差し替えるか、Settings 画面の「scripts パス」で実体を指定してください。

### dcg ガードのテスト（GUI 不要）

```bash
cd src-tauri/dcg && cargo test
```

## バックエンド IPC（§7）

`src/lib/api.ts` が唯一の窓口。Tauri 内なら `invoke`、ブラウザなら browserMock を呼びます。
Commands / Events の一覧は仕様書 §7 および `src-tauri/src/commands.rs` を参照。

## 段階的セットアップ

1. `npm install && npm run build` で UI を確認。
2. macOS で Rust toolchain を入れ `npm run tauri dev`。
3. `codex login`（ChatGPT 経路）/ LM Studio 起動 / Obsidian Local REST API 有効化。
4. Settings でパスと Obsidian トークン（Keychain）を登録 → ヘルスが緑になることを確認。

## ディレクトリ

```
src/                React フロント（screens / components / lib / store）
                    lib/api.ts が Tauri / Bridge / mock の 3 トランスポートを切替
src-tauri/          Cargo ワークスペース
  core/             GUI 非依存の共有頭脳（commands / exec / obsidian / secrets / mock）
  bridge/           ローカル仲介 HTTP/SSE サーバー（core を再利用・Linux でもビルド可）
  dcg/              Destructive Command Guard（GUI 非依存・単体テスト可）
  src/              Tauri デスクトップ層（core への薄いラッパ）
scripts/            jarvis-codex-org スクリプトのプレースホルダ / 契約
```
