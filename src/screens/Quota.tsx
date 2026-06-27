import { QuotaGauge } from "../components/QuotaGauge";
import { Button, Card, Pill, ScreenHeader } from "../components/ui";
import { api } from "../lib/api";
import { useCockpit } from "../store/cockpit";

const MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

// Quota & Cost（コスト管制, §4.7）: 「課金ゼロ」を守る要塞画面。
export function Quota() {
  const quota = useCockpit((s) => s.quota);
  const auth = useCockpit((s) => s.auth);
  const settings = useCockpit((s) => s.settings);
  const setRetreat = useCockpit((s) => s.setRetreatMode);
  const requestApproval = useCockpit((s) => s.requestApproval);
  const pushToast = useCockpit((s) => s.pushToast);

  // §9: 環境に OPENAI_API_KEY があれば赤旗（課金事故防止）。auth.method=api でも検出。
  const apiKeyFlag = (settings?.openai_api_key_present ?? false) || auth?.method === "api";

  const setModel = (model: string) =>
    // 既定モデル切替は要確認（§4.7, §9）。~/.codex/config.toml を編集。
    requestApproval({
      title: "既定モデルの変更",
      description: `~/.codex/config.toml の model を ${model} に変更します。ルーチンは mini 推奨です。`,
      target: model,
      riskScore: 2.0,
      onApprove: async () => {
        await api.configSetModel(model);
        pushToast({ level: "info", title: "モデル変更", body: `既定モデルを ${model} に設定しました。` });
        // settings を更新表示するため再取得。
        const s = await api.settingsGet();
        useCockpit.setState({ settings: s });
      },
    });

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Quota & Cost" jp="コスト管制" />
      <div className="grid flex-1 grid-cols-3 gap-4 overflow-auto p-6">
        <Card title="5h ウィンドウ使用率">
          <div className="flex justify-center">
            <QuotaGauge quota={quota} />
          </div>
          <p className="mt-2 text-center text-[11px] text-base-500">
            {quota?.source === "unknown"
              ? "公式 API 無し・取得不能のため「不明」表示（§12）"
              : "週次キャップは取得可能な範囲で表示"}
          </p>
        </Card>

        <Card title="認証経路">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">ChatGPT ログイン</span>
              <Pill tone={auth?.method === "chatgpt" ? "ok" : "muted"}>
                {auth?.method === "chatgpt" ? "✓ 有効" : "未確認"}
              </Pill>
            </div>
            {/* APIキー検出時は赤旗（§4.7, §9） */}
            <div
              className={`rounded-md border p-3 ${
                apiKeyFlag ? "border-down bg-down/10" : "border-base-700"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={apiKeyFlag ? "text-down" : "text-ok"}>{apiKeyFlag ? "🚩" : "✓"}</span>
                <span className="text-sm font-medium">
                  {apiKeyFlag ? "OPENAI_API_KEY を検出" : "API キー未検出"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {apiKeyFlag
                  ? "課金事故防止のため unset を推奨: `unset OPENAI_API_KEY`"
                  : "課金につながる API 経路は検出されていません。"}
              </p>
            </div>
          </div>
        </Card>

        <Card title="課金ポリシー">
          {/* クレジット購入は無効（操作不可）= ポリシーの可視化（§4.7, §9） */}
          <div className="space-y-3">
            <div className="rounded-md border border-base-700 bg-base-900 p-3 opacity-70">
              <div className="flex items-center justify-between">
                <span className="text-sm">クレジット購入</span>
                <Pill tone="down">無効</Pill>
              </div>
              <p className="mt-1 text-xs text-muted">UI に存在させない方針（§9）。操作不可。</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">退避モード</span>
              <Button
                variant={settings?.retreat_mode ? "danger" : "default"}
                onClick={() => setRetreat(!(settings?.retreat_mode ?? false))}
              >
                {settings?.retreat_mode ? "ON（解除）" : "OFF（ONにする）"}
              </Button>
            </div>
          </div>
        </Card>

        <Card title="既定モデル" className="col-span-3">
          <div className="flex items-center gap-3">
            {MODELS.map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={`rounded-md border px-4 py-2 text-sm ${
                  settings?.default_model === m
                    ? "border-accent bg-base-700 text-white"
                    : "border-base-600 text-muted hover:border-accent-soft"
                }`}
              >
                {m}
                {m.endsWith("mini") && <span className="ml-2 text-[10px] text-accent">推奨(ルーチン)</span>}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-base-500">切替は要確認モーダルを挟みます（§9）。</p>
        </Card>
      </div>
    </div>
  );
}
