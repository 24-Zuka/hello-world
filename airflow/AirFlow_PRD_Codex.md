# AIRFLOW デスクトップアプリ 仕様書（PRD）— Codex 運用版

> このドキュメントは、クウキデザイン（Rio Matsumoto）氏の note 記事2本
> （`n96b49ab854ba` / `ne3ec82df5ebb`）で公開された「AIRFLOW」設計を分析・統合し、
> **Claude 系（Claude Code / Cowork）前提の運用を、OpenAI Codex 中心の運用に全面的に置き換えた**
> コピペ可能な実装仕様書です。
> コーディングエージェント（**Codex**）にこのファイルをそのまま渡せば、骨格まで構築できる粒度で書いています。

---

## 0. このPRDの使い方（Codexへの最初の指示）

Codex（`codex` CLI もしくは ChatGPT 上の Codex）に対して、以下をそのまま貼り付けてください。

```
あなたはシニアフルスタックエンジニアです。
このリポジトリ直下にある AirFlow_PRD_Codex.md を仕様書として読み込み、
「AIRFLOW」というAI×人間ハイブリッドのタスクボード基盤を実装してください。

進め方:
1. まず実装計画書（IMPLEMENTATION_PLAN.md）を作成し、私の承認を得てから着手すること。
   - 解決する問題 / 成功基準 / スコープ / 依存関係 / 未解決の質問 を含める。
2. セクション「15. 実装ステップ」の順序で1ステップずつ進めること。
3. 破壊的・不可逆な操作（ファイル削除、本番デプロイ、外部送信）の前は必ず確認を取ること。
4. 各ステップ完了後、何をやったか・次に何をやるかを1〜3文で報告すること。

不明点があれば推測せず質問してください。
```

---

## 1. プロジェクト概要

| 項目 | 内容 |
|---|---|
| プロダクト名 | AIRFLOW（エアフロー） |
| 一言で言うと | **AIと人間が同じタスクボードを参照・更新するハイブリッド運用システム** |
| 着想元 | Google / Amazon のバグ管理システム（担当者・優先順位・ステータス・コメント欄）。そこに「**AIが担当者になれる**」という1点を追加した |
| 解決する課題 | Obsidian ベースの「引継書」がログのように肥大化し、AIのコンテキストウィンドウを圧迫した。**毎回ゼロから状況説明し直す**負担をなくす |
| 中核思想 | タスクボード自体が「次の担当者向けのブリーフィング文書」になる設計。AIはリアルタイム会話できない（スケジュール実行）ため、**非同期の引き継ぎ**が前提 |
| 形態 | デスクトップから使うWebアプリ（ローカル＋クラウド両用）＋ 定時実行される自動ディスパッチャー |

### 1.1 「動く情報」と「変わらない情報」の切り分け（重要な前提）

AIRFLOW は **毎日変わる情報だけ**を扱う。変わらない情報は Obsidian に置く。判定基準は「**毎日変わるかどうか**」のみ。

| 区分 | 置き場所 | 例 |
|---|---|---|
| **動く情報** | AIRFLOW タスクボード | 今日やるタスク、進捗、締め切り、今週/今月の優先順位、公開予定日 |
| **変わらない情報** | Obsidian | 価値観・判断基準、ブランドのトーン、技術スタック、パートナーシップのレート（月/年単位でしか変わらない） |

> AIはセッション開始時にまず Obsidian の定義ファイルを読み、「これは動く情報か／変わらない情報か」を判断して保存先を決める。ルールの更新権は人間にある。

---

## 2. Claude系 → Codex系 への置き換え対応表

このPRD全体で、元記事の Claude 系コンポーネントを以下のように読み替えています。

| 元記事（Claude系） | 本PRD（あなたの環境 / Codex系） | 役割 |
|---|---|---|
| Claude Code（朝7時半に自動起動するバッチ） | **Codex CLI（`codex exec`）を launchd で定時起動** | 自律バッチ実行（`owner: ai-batch`） |
| Cowork（昼間の対話型エージェント） | **ChatGPT（Plus）/ Codex 対話モード / Gemini** | 対話型実行（`owner: ai-interactive`） |
| Claude のフック（Hooks）機構 | **Codex の sandbox / approval policy ＋ ラッパースクリプト＋ 緊急停止ファイル** | 安全機構（後述 §11） |
| CLAUDE.md / システムプロンプト | **`AGENTS.md`（Codex が自動で読む）＋ ChatGPT Custom Instructions** | 社内規定 / General Instruction（§12） |
| Claude への MCP（airflow-board） | **HTTP API（X-Board-Token）を curl/fetch で呼ぶ。任意で MCP サーバ化も可** | ボードへのアクセス手段 |

### 2.1 あなたの環境前提

- デバイス: MacBook Air **M5 / メモリ24GB / SSD 512GB / macOS 27**
- 契約: **ChatGPT Plus** ＋ **Google AI Pro**
- 使用AI: **Codex**（メイン）, ChatGPT, Gemini, LM Studio（ローカルLLM）, Antigravity 2.0, Claude（無料）
- ノート: **Obsidian** 利用中

> ローカル実行が中心なので、まずは**自分のMac上だけで完結**させ（`localhost`）、安定後にクラウド（Vercel）へ移す二段構えを推奨します（§16）。

---

## 3. システム構成

AIと人間が同じタスクリストを参照・更新するシステム。以下の3コンポーネントで構成する。

1. **REST API サーバー**: タスクの CRUD 操作を提供する API。ローカル（Next.js dev / Node）または Vercel 上にデプロイ。
2. **JSON ファイルストレージ**: `board.json`（処理中タスク）と `archive.json`（完了タスク）の2ファイルで運用。**DBは不要**。ローカルはファイル、クラウドは Vercel Blob Storage。
3. **ディスパッチャー**: OSのスケジューラ（macOS は **launchd**）で定時実行する処理スクリプト。条件に合致するタスクを **1件ずつ** 処理する。

> 実装は驚くほどシンプル。月額課金のクラウドサービスも専用DBも使わない。「タスクの追加・更新・完了ができればいい、それ以上は不要」という判断で JSON ファイルを選んだ。

### 3.1 技術スタック（推奨・具体）

| レイヤ | 採用技術 | 備考 |
|---|---|---|
| API / フロント | **Next.js (App Router) + TypeScript** | API Routes で REST、画面はタスクボードUI |
| ランタイム | Node.js (LTS) / Edge Runtime | |
| ストレージ（ローカル） | ファイルシステム上の `data/board.json`, `data/archive.json` | 開発・個人運用はこれで十分 |
| ストレージ（クラウド） | **Vercel Blob Storage** | 公開デプロイ時。**認証なしアクセスは禁止**（§7） |
| ディスパッチャー | **Node スクリプト（TypeScript/JS）+ launchd plist** | `codex exec` を内部から呼ぶ |
| 自律バッチAI | **Codex CLI** (`codex exec`) | `owner: ai-batch` |
| 対話型AI | ChatGPT / Codex 対話 / Gemini | `owner: ai-interactive` |

---

## 4. 認証

すべての API エンドポイントはリクエストヘッダー `X-Board-Token: {TOKEN}` を必須とする。

- トークンが一致しない場合は **403 Forbidden** を返す。
- トークンは **環境変数**（`.env.local` / Vercel Environment Variables）で管理し、**コードにハードコードしない**。
- **AIエージェントの種類ごとに別トークンを発行**して、操作主体をログで追跡できるようにする。
  - 例: `TOKEN_HUMAN`, `TOKEN_CODEX_BATCH`, `TOKEN_CHATGPT`, `TOKEN_GEMINI`

---

## 5. API エンドポイント仕様

| メソッド | パス | 処理内容 |
|---|---|---|
| `GET` | `/api/board` | `board.json` 全件取得 |
| `GET` | `/api/board/{id}` | 特定IDのタスク取得（存在しない場合は **404**） |
| `POST` | `/api/board` | タスク新規作成（`id` は自動採番: `T0001`〜） |
| `PATCH` | `/api/board/{id}` | タスク部分更新（`updated_at`・`activity` ログを **自動追記**） |
| `POST` | `/api/board/{id}/complete` | タスクを `archive.json` に移動して `board.json` から削除 |
| `GET` | `/api/archive` | `archive.json` 全件取得 |

実装上の注意:
- `POST /api/board` の採番は `board.json` ＋ `archive.json` を通じて**一意**になるようにする（過去最大ID＋1）。
- `PATCH` は渡されたフィールドのみ更新し、必ず `updated_at` を現在時刻（UTC, ISO8601）に更新し、`activity` に1件追記する。
- 全エンドポイントで `X-Board-Token` 検証を最初に行う。

---

## 6. タスクスキーマ（データモデル）

`board.json` / `archive.json` は、以下のタスクオブジェクトの配列とする。

```json
{
  "id": "T0001",
  "title": "タスクの名称（自由記述）",
  "status": "needs-ai | needs-human | in-progress | done | blocked",
  "owner": "human | ai-batch | ai-interactive",
  "priority": "P0 | P1 | P2 | P3",
  "action_type": "content | research | review | publish | setup | other",
  "handoff_note": "前の担当者が何をやり、次の担当者は何をやるべきか、なぜか",
  "blocked_reason": "停滞理由（status が blocked の場合のみ。それ以外は null）",
  "tags": ["任意のタグ文字列"],
  "created_at": "2026-01-01T07:30:00Z",
  "updated_at": "2026-01-02T09:00:00Z",
  "activity": [
    {
      "timestamp": "2026-01-01T07:30:00Z",
      "actor": "ai-batch",
      "action": "処理内容の自由記述"
    }
  ]
}
```

### 6.1 フィールド定義

| フィールド | 説明 |
|---|---|
| `id` | `T0001` から始まる連番。1つ1つのタスクを識別する番号 |
| `title` | 何をするタスクかを示す名前 |
| `status` | 5種類（§7状態遷移参照）: `needs-ai`（AI処理待ち）/ `needs-human`（人間確認待ち）/ `in-progress`（処理中）/ `done`（完了）/ `blocked`（停滞中） |
| `owner` | このタスクを次に処理する者。**自分の環境のAI名に合わせて変更してよい**。本PRDでは `human` / `ai-batch`（=Codex）/ `ai-interactive`（=ChatGPT・Gemini） |
| `priority` | `P0`（最高緊急 / 即時対応）/ `P1`（本日中）/ `P2`（今週中）/ `P3`（いつでも） |
| `action_type` | タスクの種類: コンテンツ作成・調査・レビュー・公開・セットアップなど |
| `handoff_note` | **引継ノート**。前の担当者が何をして、次の担当者は何をやるべきか・なぜか。AIが書き込む。**この設計が最重要**（人間チームで「引継書をちゃんと書け」と指導するのと同じ価値）。コメント欄なきタスクシステムは AI×人間ハイブリッド運用に使えない |
| `blocked_reason` | `status` が `blocked` のとき、なぜ止まっているかを記録。それ以外は `null` |
| `tags` | 任意のタグ。制御用にも使う（例: `dispatcher-lock`） |
| `created_at` / `updated_at` | タイムスタンプ（UTC, ISO8601） |
| `activity` | タイムスタンプ付きの履歴ログ。誰（`actor`）が何（`action`）を、いつやったかの履歴 |

---

## 7. ステータス遷移ルール

```
needs-ai
  → in-progress（バッチ型AI = Codex が処理開始）
    → needs-human（人間の判断が必要）
    → done（処理完了）

needs-human
  → in-progress（人間 または 対話型AIが処理開始）
    → needs-ai（AI処理に戻す）
    → done（処理完了）

done → /complete エンドポイント呼び出し → archive.json に移動・board.json から削除

blocked → 人間が blocked_reason を確認・解消後、needs-ai または needs-human に戻す
```

### 7.1 自動 blocked ルール
**最終更新（`updated_at`）から72時間を超えてステータスが変化しないタスク**は、ディスパッチャーが自動で `blocked` に変更し、`blocked_reason` に「72時間変化なし」を記録する。

### 7.2 設計思想（重要）
- 重要なのは **「`needs-human` への差し戻しを失敗ではなく、正しい動作」** とする思想。AIが判断できないと判断した時点で、明示的に人間にバトンを渡す。**双方向のコミュニケーション**が起こる設計にする。

---

## 8. ディスパッチャー実装仕様

自律バッチ（`owner: ai-batch` = **Codex**）の自動処理の心臓部。

### 8.1 実行スケジュール
- **毎日 07:30** に起動（macOS は **launchd**、Linux は cron）。

### 8.2 処理フロー
```
1. GET /api/board で全タスクを取得する
2. status = needs-ai かつ owner = ai-batch のタスクを抽出する
3. tags に "dispatcher-lock" を含むタスクを除外する
   （ディスパッチャー自身の設定を変更するタスクを自動実行する無限ループを防ぐため）
4. priority の高い順（P0 → P1 → P2 → P3）で並べ、先頭の 1件だけ を処理する
5. タスク処理を実行する（後述: Codex に処理を依頼）
6. 完了後、PATCH /api/board/{id} で以下を更新する:
   - handoff_note: 実施内容と次担当者への引継ぎ内容
   - status: needs-human または done
   - activity: 実施ログを1件追記
7. 処理中にエラーが発生した場合:
   - status → blocked
   - blocked_reason → エラー内容を記録
   - activity: エラーログを追記
```

### 8.3 なぜ1件ずつ処理するか
複数タスクを並列処理するとエラー発生時の原因特定が困難になる。**まず1件ずつ逐次実行**し、安定稼働を確認した後に並列化を検討する（§14）。

### 8.4 Codex によるタスク処理の呼び出し（置き換えの核心）

ディスパッチャーは、抽出した1件のタスク内容を Codex に渡して非対話で処理させる。Codex CLI の `exec`（非対話）モードを使う。

```bash
# dispatcher が内部で呼ぶイメージ（擬似）
codex exec \
  --sandbox workspace-write \
  --ask-for-approval never \
  "AIRFLOWタスクT0123を処理せよ。
   title: <タスク名>
   handoff_note: <引継ノート>
   完了後は『何をやったか・次担当者への引継ぎ』を簡潔に出力すること。
   不可逆操作（削除・外部送信・本番デプロイ）は実行せず needs-human に差し戻すこと。"
```

- Codex の標準出力（実施結果・引継ぎ文）をパースし、`PATCH /api/board/{id}` に書き戻す。
- **`--ask-for-approval never` は自律実行のため。代わりに `--sandbox workspace-write`（書込はワークスペース内に限定）と deny list（§11）で安全を担保する。**
- ネットワークを使う場合は Codex のサンドボックス設定でネットワーク許可が必要（`~/.codex/config.toml` の `sandbox_workspace_write.network_access = true`）。

### 8.5 launchd 設定例（毎朝07:30起動）

`~/Library/LaunchAgents/com.airflow.dispatcher.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.airflow.dispatcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd /Users/YOURNAME/airflow && node dispatcher/run.js >> logs/dispatcher.log 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
```
登録: `launchctl load ~/Library/LaunchAgents/com.airflow.dispatcher.plist`

---

## 9. 役割とエージェント割り当て

| owner 値 | 担当 | 起動方法 | 主な役割 |
|---|---|---|---|
| `human` | あなた | 手動 | 判断・承認・最終決定 |
| `ai-batch` | **Codex CLI** | launchd で毎朝07:30 | `needs-ai` タスクの自律処理 |
| `ai-interactive` | **ChatGPT / Codex対話 / Gemini** | 日中、手動でセッション開始 | `needs-human` の対話処理、調査、レビュー |

> `owner` の値は自分の環境のAI名に合わせて自由に変えてよい（例: `codex`, `chatgpt`, `gemini` など細分化も可）。

---

## 10. 権限設計（誰に何ができるかを決める）

**全員に同じ権限を与えると、ミスの影響が最大になる。** ミスの影響範囲と職位に応じて制限する。3段階で設計する。

| Lv | 名称 | 内容 | Codex での実装 |
|---|---|---|---|
| **01** | **監視・報告のみ（読取専用）** | 状態の読み取り・分析・報告のみ。書き換え不可。**AI社員の大半はこのレベル** | `codex --sandbox read-only`（GET系APIのみ許可するトークンを付与） |
| **02** | **隔離スペース内での実装（限定書込）** | コードを書く/変更するが、**本番コードには直接触れない**。隔離された作業用コピー（worktree）内で動く。人間がレビュー・承認するまで本番に入らない | `codex --sandbox workspace-write` ＋ git worktree で隔離。PRを作るが merge は人間 |
| **03** | **禁止事項リスト（deny list）** | 「**何があっても実行できない操作**」を設定ファイルに明示。AIがどれだけ「これが必要」と判断しても物理的に実行できない | §11 の deny list ＋ サンドボックス。`approval_policy` でガード |

> インターンが採用の最終決定を承認できないのと同じ。「信頼が足りない」のではなく「ミスの影響範囲に応じて制限している」。

---

## 11. 安全機構（フック設計の Codex 置き換え）

元記事は Claude Code の「フック（Hooks）」で実現していた安全機構を、Codex では **サンドボックス + 承認ポリシー + ラッパースクリプト + 緊急停止ファイル** で再現する。

### 11.1 禁止事項リスト（deny list）— 最優先で実装
`AGENTS.md` と ディスパッチャーのラッパーに **明示的に** 記載する。「やってはいけないこと」を明示するほうが安全設計として有効（allow list より deny list）。

deny list に入れるもの:
- ファイルやフォルダの**強制削除**（`rm -rf` 等）
- 変更履歴の**強制書き換え**（`git push --force`, `git reset --hard` 等）
- 重要な設定ファイルの**上書き**（`.env`, plist, config.toml 等）
- データベースへの破壊的変更
- 外部通信の送信（メール・Slack・本番デプロイ）

### 11.2 不可逆操作の前で必ず止まる
上記操作の前は **必ず human に確認**（`needs-human` へ差し戻し）。Codex 対話時は `--ask-for-approval on-request`、バッチ時は「該当操作は実行せず差し戻す」を AGENTS.md で強制。

### 11.3 緊急停止スイッチ（Codex版フック）
定時実行（launchd）の **冒頭**で停止ファイルの有無を確認する。`STOP` ファイルが存在すれば全自動実行を中断する。

```js
// dispatcher/run.js の冒頭
const fs = require('fs');
if (fs.existsSync('./STOP')) {
  console.log('STOP file present. Halting dispatcher.');
  process.exit(0);
}
```
> 緊急時は `touch ~/airflow/STOP` するだけで全自動運用が止まる。「起きてから対処」ではなく「設計時に入れる」セーフガードの典型例。

### 11.4 自己改変ループ防止
ディスパッチャー自身の設定を変更するタスクには `dispatcher-lock` タグを付け、処理対象から除外する（§8.2 step 3）。

### 11.5 タスク重複生成の防止
新規タスク作成時、「**同じ内容のタスクが既に board に存在するか**」を確認するロジックを入れる（`title` / 内容の照合）。「同じタスクが既に存在する場合は新規生成しない」。

### 11.6 教訓（実装時の必須確認）
- **クラウド公開時のアクセス制御**: `board.json` / `archive.json` がインターネット上で**誰でも閲覧できる状態にしない**。Vercel はデフォルトでホストした内容を公開する設定なので、必ず public アクセスをブロックし `X-Board-Token` 必須にする。
- ローカルで動いていた設計をクラウドに移す際は、**セキュリティの前提が変わる**ことを当たり前にする。

---

## 12. AGENTS.md / General Instruction（社内規定・コピペ用）

> Codex はリポジトリ直下の **`AGENTS.md` を自動で読み込む**。以下をそのまま `AGENTS.md` に貼り付ける。
> ChatGPT を `ai-interactive` で使う場合は、同じ内容を **Custom Instructions**（設定→カスタム指示）に貼る。
> `★A★`〜`★C★` は自分の環境に合わせて置換すること。
> - `★A★` = ノートアプリ名/パス（例: Obsidian の Vault パス）
> - `★B★` = コンテキストファイル名（例: `_My Context.md`）
> - `★C★` = タスク管理（AIRFLOW）のURL/パス（例: `http://localhost:3000` または Vercel URL）

```markdown
# AGENTS.md — AIRFLOW General Instruction

## コンテキスト管理（ノートアプリと連携する場合）
- 会話開始時に毎回、★A★ のコンテキストファイル（★B★）を静かに読み込む。
- 追加ファイルは必要に応じてのみ読む。
- フォルダ全体を一括読み込みしない。
- このプロセスを口に出さない。

## 何かを構築するとき（アプリ、スクリプト、自動化など）
- コードを書いたり設定変更を行う前に、必ず実装計画書を作成する。例外なし。
- 実装計画書には以下を含める: 解決する問題とその理由 / 成功基準 / スコープ / 契約と依存関係 / 未解決の質問。
- 提示して承認をもらってから着手する。
- スキップを求められたら一度押し返す。実装計画書はかかるコスト以上の時間を節約する。
- カスタムビルドを提案する前に、既存のツールやスクリプトを確認する。明確な理由がなければ既存のものを使う。

## 押し返しと確認（イエスマン禁止）
- 要件が曖昧なら質問する。
- 計画が誤っていると思えば異議を唱える。
- 過去の決定と矛盾があれば「これは以前の決定と違う。どう整合させるか？」と聞く。
- 黙って上書きしない。
- わからないことは確認する。推測しない。
- 「いいアイデアですね！」「おっしゃる通りです」は、本当にそう思って熟考した後でなければ禁止。

## メモ取り
- セッション中に意味のあること（決定・気づき・制約・方向転換・未解決の質問）が起きたら、
  言われなくても書き留める。「保存して」と言われるのを待たない。
- セッション終わりに、決定されたこと・未解決のこと・次のアクションのサマリーを提示し、保存を申し出る。

## 取り消し不能な操作の前に必ず止まる（deny list）
- 以下の前には必ず確認する:
  ファイル/フォルダの削除、ファイルの上書き、変更履歴の強制書き換え、
  データベースへの破壊的変更、外部通信の送信（メール・Slack）、金融取引、
  一括操作（一括削除・一括リネーム）、本番デプロイ。
- 止まったら: これからやることを列挙 → 取り消せないことを明示 →「進めますか？」と確認 → 返答を待つ。
- 可能なら本番の前に試し実行する。

## タスクの引き継ぎ（AIRFLOW タスクボードを使う場合）
- タスクを終了/中断・引き継ぎするとき、構造化された形で結果を記録する
  （次の担当者が全部読み直さずに再開できるように）。
- handoff_note に含めるもの:
  - 行ったことの要約（1〜3文）
  - 次の具体的なアクション
  - 作成・編集したファイル
  - 下した主要な判断と理由
  - アウトプットのリンク（★C★）
- 簡潔に記述すること。これは「引き継ぎ」であって「レポート」ではない。

## AIRFLOW ボード操作
- タスク取得: GET ★C★/api/board （ヘッダー X-Board-Token 必須）
- 着手時: status を in-progress に PATCH
- 完了時: status を needs-human または done に、handoff_note を更新して PATCH
- 完了確定: POST ★C★/api/board/{id}/complete
- 判断不能/不可逆操作が必要: needs-human に差し戻し、理由を handoff_note に書く
```

---

## 13. 朝礼エージェント（Morning Standup）実装仕様

毎朝8時に起動し、深夜に動いた自律エージェント（Codex）の引継ぎメモを読み、カレンダーを確認し、ボード全体をスキャンして「**今日、人間の判断が必要なタスク**」を優先度順に**1件ずつ**提示する（一度に全部出さないのがキモ）。AIは会話が終わると記憶が消えるため、**ボードが組織の記憶**になる。

### 13.1 起動方法（Codex版）
- **推奨**: 毎朝、`codex`（対話モード）を開き、下記プロンプトを最初に投入する。あるいは ChatGPT Plus の「**スケジュールされたタスク**」で同プロンプトを毎朝配信する。
- カレンダー連携は Google Calendar（Google AI Pro / Gemini 経由）または ChatGPT のコネクタを使う。

### 13.1.1 カレンダー連携の選択肢（あなたの環境＝Google AI Pro / ChatGPT Plus 前提）

元記事は Claude 系でカレンダーを取得していたが、あなたは **Claude 有料プランを持たない**ため、以下のいずれかで「今日＋明日の予定」を取得する。朝礼プロンプトの Step 0（手順6）とこのどれかを組み合わせる。

| 手段 | 使うもの | 向き / 備考 |
|---|---|---|
| **A. Gemini + Google Calendar**（推奨） | Google AI Pro の Gemini。Workspace 連携で自分の Google Calendar を直接参照 | Google アカウントの予定をそのまま読める。日本語の予定にも強い |
| **B. ChatGPT コネクタ + スケジュールタスク** | ChatGPT Plus の Google Calendar コネクタ ＋「スケジュールされたタスク」 | 毎朝8時に朝礼を自動配信できる。Codex を都度開かなくてよい |
| **C. ローカル ICS 取り込み** | Google Calendar の「シークレットICS URL」を Codex/スクリプトで取得しパース | 完全ローカル運用したい場合。launchd で取得 → `00_Inbox/today-calendar.md` に書き出し → 朝礼が読む |

> **おすすめの組み合わせ**: 自律バッチ（深夜の処理）は **Codex + launchd**、朝礼の配信は **ChatGPT Plus のスケジュールタスク（手段B）** か、対話で深掘りしたい日は **Codex 対話 + Gemini にカレンダーを聞く（手段A）**。手段Cはネット非依存で確実なので、AとBが不調なときのフォールバックに使える。

### 13.2 朝礼エージェント プロンプト全文（コピペ用 / 英語版＝推奨）

> `[your name]` / `★C★` / ファイル名（`_My Context.md`, `AI Handoff.md` など）は自分の環境に置換。

```
You are the morning standup agent. You run at 8 AM after the overnight
dispatcher (Codex) has already done its automated work. Your job is to walk
[your name] through what needs their attention — one item at a time, sequentially.

## Step 0 — Load Context
1. Read _My Context.md (vault root context — roles, SSOT definitions)
2. Read AI Handoff.md (shift-change log from overnight agents)
3. Read Current Projects.md — specifically the `publishing_schedule:` frontmatter
   block. SSOT cache for video publish dates.
4. Read today's dispatch brief: 00_Inbox/daily-dispatch-YYYY-MM-DD.md
5. Read the task board via ★C★/api/board (X-Board-Token required).
6. Pull the calendar (today + tomorrow). The dispatch brief and the board do NOT
   contain calendar events — fetch them directly. Capture: title, start/end
   (local time), attendees + RSVP status, conference link, description/agenda.
   Run this even on the fallback path.

If today's dispatch brief doesn't exist, fall back to reading the board directly
and build the standup from that. (Still pull the calendar regardless.)

## Step 0.5 — SSOT Cross-Check (MANDATORY)
Before relaying anything from the dispatch brief or board: cross-check any publish
dates, deadlines, "残り N 日", subscriber count, or other quantitative fact
against the SSOT caches:
- Publish dates → Current Projects.md frontmatter publishing_schedule
- Key metrics  → _My Context.md frontmatter [your metric key]
- Career / project dates → _My Context.md frontmatter [your date key]
If upstream (dispatch/board) disagrees with vault frontmatter: vault wins. Flag
the discrepancy explicitly and queue a fix this session. Never propagate stale
values silently. The user should not be the verification step.

## Step 1 — Present the Morning Summary
Start with a brief 2-3 sentence summary:
- What the overnight dispatcher completed
- How many items need the user's attention
- Today's meeting load (how many, prep or decision needed today)
- Any urgent/time-sensitive flags

## Step 1.5 — Overnight Engineering Blocks (surface FIRST)
Before presenting anything else, scan the board for tasks matching ALL of:
- owner is codex (ai-batch)
- status is needs-human
- updated_at is between 02:00–08:00 (local, any date)
- handoff_note contains "🔴 OVERNIGHT BLOCK"
(highest-priority escalations — the agent already tried to resolve on its own
before escalating to [your name])
If any exist, present them immediately after the summary, BEFORE the regular
task queue. For each overnight block, show:
⚠️ OVERNIGHT BLOCK — [T00X] [title]
[paste handoff_note verbatim — it's formatted for fast reading]
Then ask: "Want to unblock this now?"
- "Yes" / give instruction → execute immediately, update board, move on
- "Later" → flag it and continue to regular standup
- "Drop it" → set status back to pending
Only after all overnight blocks are handled, proceed to Step 1.6.

## Step 1.6 — Today's Meetings (surface AFTER overnight blocks, BEFORE task queue)
Calendar events are time-anchored and frequently the most urgent thing in the
day — yet they never appear on the board. List today's events in chronological
order (local time). For each meeting show in 1–2 lines:
- Time (local) + title
- Who — external attendees and their RSVP responseStatus
- What it's about — one line from the description. If no agenda, do a quick
  lookup so the user walks in with context.
Flag where applicable: external guest still responseStatus needsAction;
back-to-back collisions; a meeting with zero notes/board footprint (offer to
capture — do not write without the user's go).
If no meetings today, say "No meetings today" and move on.

## Step 2 — Sequential Task Ping
Present items from the "Needs Your Attention" list ONE AT A TIME, ordered by
priority (P0 → P1 → P2 → P3). For each item present:
- Task ID + title (e.g., "T003: [task title]")
- Why it needs you — 1–2 sentences, not a wall of text
- Recommended action — what the dispatcher suggests
- Skill available — if a skill can help
- Your options:
  - "Do it" → execute immediately using the appropriate skill/agent
  - "Skip"  → move to next item
  - "Later" → keep on board, don't touch
  - Or the user gives specific instructions
Wait for the user's response before presenting the next item. Do NOT dump all
items at once.

## Step 3 — Execute Approved Tasks
When the user says "do it" or gives specific instructions:
- Load the appropriate skill if needed
- Execute the task
- Update the task on the board (status, handoff_note)
- Report back briefly: what you did, what changed
- Then present the next item

## Step 4 — Wrap Up
After all items are presented (or the user says "that's enough" / "done"):
- Summarize what was done this session
- Update any remaining board tasks
- Note items the user skipped as still pending

## Tone
- Direct, no fluff. The user reads this first thing in the morning.
- Task IDs always included for board reference.
- Don't explain what skills are — the user knows their system. Just name them.
- If nothing needs attention, say so and end. Don't pad.

## Rules
- Follow ALL vault conventions from _My Context.md
- Never execute high-risk tasks without the user's explicit approval
- Keep each ping compact: aim for 4-6 lines per item, not paragraphs
- SSOT first. When writing handoff_notes / board updates / standup text, never
  hardcode publish dates or quantitative facts. Reference the SSOT and resolve
  at consumer time. Hardcoded literals are an antipattern.
```

> 日本語のほうが読みやすければ日本語訳して使ってよい。精度の観点では英語版を推奨。

---

## 14. 拡張ガイド（スケールアップ時）

- **複数ユーザー対応**: `owner` フィールドにユーザーIDを追加。認証はユーザー別トークンで分ける。
- **ストレージのスケールアップ**: JSON → SQLite → PostgreSQL の順で移行を検討。**月1,000件超で SQLite を検討**する目安。
- **並列処理の解禁**: 安定稼働後、P0 タスクのみ並列実行を追加検討。エラー時のロールバック／原因特定が難しくなるため、**まず逐次で安定させてから**。

---

## 15. 実装ステップ（Codex はこの順で進めること）

1. **リポジトリ初期化**: Next.js + TypeScript プロジェクト作成。`AGENTS.md`（§12）と本PRDを配置。
2. **データ層**: `data/board.json`, `data/archive.json` を空配列 `[]` で作成。読み書きユーティリティを実装（排他制御に注意）。
3. **認証ミドルウェア**: `X-Board-Token` 検証（§4）。環境変数 `.env.local` を用意。
4. **API 実装**: §5 の6エンドポイント。自動採番・`updated_at`/`activity` 自動追記・404処理を含む。
5. **ボードUI**: タスク一覧をステータス別カラム（カンバン）で表示。`handoff_note` と `activity` を閲覧できる詳細ビュー。
6. **ステータス遷移＆72h自動blocked**（§7）。
7. **ディスパッチャー** `dispatcher/run.js`（§8）: STOP ファイル確認 → 抽出 → 1件処理 → Codex 呼び出し → 書き戻し。
8. **launchd plist**（§8.5）作成と登録手順を README に記載。
9. **安全機構**（§11）: deny list、緊急停止、自己改変ループ防止、重複生成防止。
10. **朝礼エージェント**（§13）のプロンプトを `prompts/morning-standup.md` として配置。
11. **ローカル動作確認** → 安定後にクラウド（Vercel + Blob）移行手順を整備（§16）。

---

## 16. ローカル → クラウド 移行（二段構え）

| フェーズ | 環境 | ストレージ | 目的 |
|---|---|---|---|
| Phase 1 | `localhost:3000` | ローカルファイル | まず自分のMacだけで完結。安定させる |
| Phase 2 | Vercel | Vercel Blob | 外出先からも参照。**public アクセス禁止＋トークン必須**（§11.6） |

---

## 17. 受け入れ基準（Acceptance Criteria）

- [ ] `X-Board-Token` 不一致のリクエストが **403** を返す
- [ ] `POST /api/board` が `T0001` 形式で **一意に** 自動採番する
- [ ] `PATCH` が `updated_at` を更新し `activity` に1件追記する
- [ ] `POST /api/board/{id}/complete` でタスクが archive に移動し board から消える
- [ ] ディスパッチャーが `needs-ai` & `owner=ai-batch` & not `dispatcher-lock` を priority 順で **1件だけ** 処理する
- [ ] エラー時にタスクが `blocked` ＋ `blocked_reason` 記録になる
- [ ] 72時間更新なしのタスクが自動 `blocked` になる
- [ ] `STOP` ファイル存在時にディスパッチャーが起動しない
- [ ] deny list の操作が AGENTS.md に明記され、Codex が事前確認/差し戻しする
- [ ] クラウド公開時に `board.json` が認証なしで閲覧できない

---

## 18. 環境変数（`.env.local` テンプレート）

```bash
# 操作主体ごとに別トークン（ログで追跡できるように）
TOKEN_HUMAN=replace_me_human
TOKEN_CODEX_BATCH=replace_me_codex
TOKEN_CHATGPT=replace_me_chatgpt
TOKEN_GEMINI=replace_me_gemini

# クラウド時のみ
BLOB_READ_WRITE_TOKEN=replace_me_vercel_blob

# 朝礼/連携（任意）
OBSIDIAN_VAULT_PATH=/Users/YOURNAME/ObsidianVault
BOARD_BASE_URL=http://localhost:3000
```

---

## 19. DOs / DON'Ts（運用の鉄則）

### DO
- タスク設計に **`handoff_note`（引継ノート）を必ず含める**（前の担当者が何をやり・次に何をやるべきか・なぜか の3点）。
- 自動ディスパッチャーは **1タスクずつ逐次実行**（安定してからスケールアップ）。
- まず手動確認しながら数日間稼働させてから、自動化に移行する。
- AIのアクセス権限は **「やってはいけないこと」のリスト（deny list）** で定義する。
- システム自身の動作ルールを変えるような危険タスクには専用タグ（`dispatcher-lock`）を付け、自動処理から除外する設計を**最初から**入れる。
- ローカル→クラウド移行時はセキュリティ前提を**一から確認**する。

### DON'T
- AIに「タスク完了のため必要な権限を自分で取りに行く」動作をさせない。**最小権限で動く**。使っていいツール・ファイル・呼び出していいAPIは運用者側が明示。
- 「同じタスクが存在するか確認」のロジックを省かない（同じタスクが毎日再生成され続ける）。
- 「読み取り専用で動かない」なら明示する（デフォルトはそうならない）。
- 複数タスクの同時並列処理を最初からやらない（エラー時の原因特定が困難）。
- **ローカルで安全だった設計をクラウドにそのまま引き継がない。**

---

## 20. クイックスタート（あなたが最短で動かす手順）

> Phase 1（localhost だけで完結）から始めるのが最短・最安全。クラウドは後回しでよい。

1. **PRD を配置**: このファイル `AirFlow_PRD_Codex.md` を作業フォルダ（例: `~/airflow`）に置く。
2. **Codex に渡す**: `~/airflow` で `codex` を起動し、§0 のプロンプトを貼る。実装計画書（`IMPLEMENTATION_PLAN.md`）が出たら内容を確認して承認。
3. **★置換**: 生成された `AGENTS.md` の `★A★`（Obsidian Vault パス）/ `★B★`（`_My Context.md`）/ `★C★`（`http://localhost:3000`）を自分の値に書き換える。
4. **`.env.local` 作成**: §18 のテンプレをコピーし、各トークンをランダム文字列に変更。
5. **起動・動作確認**: `npm run dev` → §17 の受け入れ基準を1つずつ確認（特に 403 / 自動採番 / complete 移動）。
6. **手動でAIループを試す**: タスクを `needs-ai` / `owner: ai-batch` で1件作成 → `node dispatcher/run.js` を手で実行 → `needs-human` に差し戻り＆`handoff_note` が書かれるのを確認。
7. **数日は手動運用**: 動作に納得してから launchd 登録（§8.5）で毎朝07:30自動化に移行。
8. **朝礼を試す**: §13.2 のプロンプトを `codex` か ChatGPT に投入。安定したら ChatGPT スケジュールタスク（§13.1.1 手段B）で毎朝配信。
9. **（任意）Phase 2**: 外出先からも使いたくなったら Vercel + Blob に移行（§16）。**public 公開禁止＋トークン必須**を必ず確認（§11.6）。

### 20.1 LM Studio / Antigravity の使いどころ（任意）
- **LM Studio（ローカルLLM）**: 機密タスクや、外部に出したくない調査・要約を `ai-batch` の一部としてオフラインで処理する選択肢。ネット不要・無料で回せるが精度はモデル依存。ディスパッチャーから OpenAI 互換エンドポイント（`http://localhost:1234/v1`）として呼べる。
- **Antigravity 2.0**: コード実装系タスク（`action_type: setup` 等）で Codex の代替/併用として使える。owner を細分化（例: `ai-batch-antigravity`）すれば振り分けも可能。

---

## 21. まとめ（設計の本質）

AIRFLOW に新しい技術はない。担当者・優先順位・ステータス・コメント欄は Google も Amazon も20年前から使っている設計。中核は「**『誰が何をやるべきか』を明示化することが、大きなチーム（人間＋AI）のコミュニケーションを成立させる**」という一点。AIチームも同じ原理で動く。本質は「発明」ではなく「**継承**」——人間社会の組織運営ノウハウをAI運用に適用すること。

技術は変遷しても、それを運用する人間の本質（引き継ぎ・判断・権限設計）は変わらない。だから**変わらない情報は Obsidian、動く情報は AIRFLOW**、という切り分けが効く。

---

### 出典
- クウキデザイン Rio Matsumoto, note『AIが自動で仕事をはじめて、終わったら人間に渡す仕組みの作り方』(`n96b49ab854ba`)
- クウキデザイン Rio Matsumoto, note（エグゼクティブ・レイヤー / 権限設計 / フック / 朝礼）(`ne3ec82df5ebb`)
- 本PRDは上記の設計思想を維持しつつ、Claude系（Claude Code / Cowork / Hooks / MCP）を **Codex / ChatGPT / Gemini / launchd / AGENTS.md** に置き換えて再構成したもの。
```