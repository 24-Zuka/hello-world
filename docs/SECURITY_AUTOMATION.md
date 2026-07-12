# Automation Security

## Trust boundaries

- Task本文、import、URL、ファイル参照、モデル出力、Bridgeリクエストは未信頼入力です。
- モデルの指示は権限を増やしません。
- Task本文をシェルとして実行しません。

## Controls

- Codexは引数配列＋stdinで起動し、allowlistとdcgを通します。
- LM Studio/Obsidian自動接続はloopback URLだけを許可します。
- Task IDはASCII英数字、`-`、`_`だけ。成果物名はallowlistです。
- Bridgeは127.0.0.1 bind、Bearer token、Origin allowlist、2 MiB本文上限、定数時間token比較を使います。
- 成果物は1ファイル5 MiB、ログ行は16 KiBで切り、Bearer/API形式のtokenをマスクします。
- SQLiteはWAL、外部キー、トランザクション、リースを使用します。
- 外部投稿、メール、メッセージ、merge、push、削除、購入、APIキー利用、システム変更は承認待ちで停止します。

## Known limitations

- EventSourceの制約によりBridge SSE tokenはquery parameter互換を残しています。Bridge側はtokenをログへ出さず、ブラウザ履歴やプロキシを介さないloopback運用に限定してください。
- Vite 5系には開発サーバー関連の既知脆弱性があります。自動修正はVite 8へのmajor upgradeを要求するため、この機能実装とは分離して更新・互換検証してください。
