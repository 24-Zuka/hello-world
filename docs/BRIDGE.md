# JARVIS Bridge — 公開Webアプリで実連携を有効にする

公開Webアプリ（https://24-zuka.github.io/hello-world/）は、あなたのMac上で動く
**ローカルブリッジ** `jarvis-bridge` 経由で、実際の **Codex / LM Studio / Obsidian** を操作します。

> **なぜブリッジが要るのか**: どんな公開Webサーバーも、あなたのPCの `localhost`
> （LM Studio `:1234` / Obsidian `:27123`）や `codex` CLI・Keychain には届きません。
> そこで、127.0.0.1 だけで待ち受ける小さな仲介サーバーをあなたのMacで起動し、
> 公開アプリのUIからそこへ接続します。秘密情報はMacの中に留まります。

```
[ブラウザ: 公開Webアプリ] ──HTTP/SSE──▶ [jarvis-bridge @127.0.0.1] ──▶ codex / LM Studio / Obsidian / Keychain
        (UI・表示)                            (あなたのMacの中)
```

## 1. ブリッジを入手する

**A. ビルド済みバイナリ（Rust 不要・推奨）**
GitHub の **Actions →「Build bridge (macOS)」** を実行（または `bridge-v*` タグで Release 作成）し、
`jarvis-bridge-macos-universal`（Apple Silicon / Intel 両対応）をダウンロード。

**B. 自分でビルド（Rust toolchain がある場合）**
```bash
git clone https://github.com/24-Zuka/hello-world.git
cd hello-world/src-tauri
cargo build -p jarvis-bridge --release
# 生成物: src-tauri/target/release/jarvis-bridge
```

## 2. ブリッジを起動する

```bash
chmod +x jarvis-bridge        # ダウンロード版のみ
./jarvis-bridge
```

起動すると **Token** が表示されます:

```
  JARVIS Bridge — 実連携の仲介サーバー
  ───────────────────────────────────────────
  Listening : http://127.0.0.1:8787
  Token     : a1b2c3d4...（64文字）
  Origins   : https://24-zuka.github.io, http://localhost:5180, ...
```

> 署名なしバイナリが Gatekeeper に止められたら、右クリック →「開く」、または
> `xattr -dr com.apple.quarantine jarvis-bridge` で解除してください。

## 3. 公開アプリから接続する

1. https://24-zuka.github.io/hello-world/ を開く。
2. **Settings → ブリッジ接続（実連携）**。
3. URL = `http://127.0.0.1:8787`、Token = 上で表示された文字列を貼り付け。
4. **接続** を押す → ヘルスバー右上が **「● Bridge 実連携」** になり、画面が実データへ切り替わります。

接続後は 8 画面すべてが実連携で動作します（ビルドのJSONLログは SSE で逐次表示）。
**未接続でもデモ（モックデータ）として操作可能**です。

## 4. 実データを緑にする準備（各サービス側）

| 依存 | 準備 | ヘルス緑の条件 |
|---|---|---|
| **Codex** | `codex login`（ChatGPT 経路・APIキー不要, §9） | `codex login status` が logged in |
| **LM Studio** | アプリ起動 → モデルをロード → Local Server 開始（:1234） | `GET /v1/models` が成功 |
| **Obsidian** | Local REST API プラグイン有効化 → トークン発行（:27123） | ブリッジが REST に到達 |

Obsidian トークンは、接続済みの状態で **Settings → トークン → Keychain に保存** を押すと、
ブリッジ経由で **Mac の Keychain** に格納されます（ブラウザには平文を残しません, §9）。

## 5. セキュリティ（このブリッジが安全な理由）

- **127.0.0.1 のみ bind**。LAN/外部には一切公開しません。
- **Bearer トークン必須**。起動ごとに生成され、流出時は再起動で無効化。
- **Origin allowlist**。公開Webオリジンとローカル開発のみ許可（他サイトからは拒否, 403）。
- **CORS + Private Network Access** を明示対応（https→localhost を主要ブラウザで成立）。
- **シェル実行は allowlist + dcg を必ず通過**（§14.2）。`rm -rf /`・`git reset --hard`・
  main への `git push --force` 等は exit 2 で遮断。コミットメッセージ内の文字列は誤遮断しません。
- **秘密は Mac に留まる**。Keychain のトークンはブリッジがローカルで読み、フロントへは渡しません。

## 6. 環境変数（任意）

| 変数 | 既定 | 用途 |
|---|---|---|
| `JARVIS_BRIDGE_ADDR` | `127.0.0.1:8787` | 待ち受けアドレス |
| `JARVIS_BRIDGE_TOKEN` | 起動時に生成 | 固定トークンを使いたい場合 |
| `JARVIS_BRIDGE_ORIGINS` | 公開+ローカル開発 | 許可 Origin をカンマ区切りで上書き |
