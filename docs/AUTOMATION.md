# AIRFLOW AI自動実行ガイド

AIRFLOWは、タスクをSQLiteへ保存し、承認ルールを確認してからCodex CLI、LM Studio、またはWork用手動パッケージへ振り分けます。外部投稿・メール・GitHub push/merge・削除・購入は自動実行しません。

## 1. 起動

```bash
npm ci
npm run tauri dev
```

公開Web UIからローカル機能を使う場合はBridgeを起動します。既定の8787番が使用中なら空きポートへ変更してください。

```bash
cd src-tauri
PATH="$HOME/.cargo/bin:$PATH" cargo run -p jarvis-bridge
```

別ポート例:

```bash
JARVIS_BRIDGE_ADDR=127.0.0.1:8797 PATH="$HOME/.cargo/bin:$PATH" cargo run -p jarvis-bridge
```

表示されたTokenを Settings > Bridge接続へ貼り付けます。

## 2. Codexログイン確認

```bash
codex login status
codex debug models
```

`Logged in using ChatGPT` を確認してください。AIRFLOWはOpenAI APIキーを要求しません。

## 3. LM Studio

1. LM StudioのDeveloper画面でLocal Serverを開始します。
2. 既定URLは `http://127.0.0.1:1234` です。
3. モデルをロードします。
4. Settingsで「疎通テスト」を実行します。

確認コマンド:

```bash
curl http://127.0.0.1:1234/v1/models
```

## 4. タスク作成と実行

1. 左ナビの Tasks を開きます。
2. 「新規」でタイトル、目的、指示、出力形式、完了条件を入力します。
3. 自動実行する場合だけ「自動実行」をONにします。
4. 「保存」後、「ルート確認」でWorker・モデル・思考レベル・理由を確認します。
5. 「実行待ちへ」または「今すぐ実行」を選びます。
6. 右側のログと成果物を確認します。

JSON/Markdownは「貼り付けて取り込む」から登録できます。サンプルは `examples/tasks/` にあります。

## 5. 成果物とChatGPT最終確認

- 成果物タブを開くと `run.jsonl`、`output.md`、`review.json`、`work-package.md`、`final-review-package.md` を確認できます。
- 「ChatGPT最終確認用にコピー」で通常のChatGPTチャットへ貼り付けます。
- Workは自動操作せず、`work-package.md` を生成して `AWAITING_INPUT` で止まります。

## 6. エラー時

- `FAILED`: エラー内容を確認し、入力または接続を直して「再試行」。
- `AWAITING_INPUT`: 情報不足またはWork手動作業待ち。
- `AWAITING_APPROVAL`: 外部操作、高リスク、または明示承認待ち。
- LM Studioがdown: Serverとモデルを確認。
- Codexがdown: `codex login status` を確認。
- Bridge接続不可: 使用ポート、Token、Originを確認。

## 7. 自動実行を完全停止

Tasks画面の「停止」を押し、Settingsで「オーケストレーター有効」をOFFにします。常駐版は次で解除できます。

```bash
./scripts/uninstall_orchestrator_launchd.sh
```

データベースと成果物は削除されません。

## 8. launchd常駐

```bash
chmod +x scripts/*orchestrator*.sh
./scripts/install_orchestrator_launchd.sh
./scripts/orchestrator_status.sh
```

8787番が使用中の場合:

```bash
JARVIS_BRIDGE_ADDR=127.0.0.1:8797 ./scripts/install_orchestrator_launchd.sh
```

Tokenは権限0600の `~/Library/Application Support/JARVIS Cockpit/bridge.token` に保存され、plistへは書きません。
