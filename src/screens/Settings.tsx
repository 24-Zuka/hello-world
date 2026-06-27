import { useEffect, useState } from "react";

import { Button, Card, Pill, ScreenHeader } from "../components/ui";
import { api, isTauri } from "../lib/api";
import * as bridge from "../lib/bridge";
import { useCockpit } from "../store/cockpit";
import type { McpServer } from "../types";

// Settings（設定, §4.8）: パス・トークン・接続の管理。APIキー欄は無し（§9）。
export function Settings() {
  const settings = useCockpit((s) => s.settings);
  const transport = useCockpit((s) => s.transport);
  const pushToast = useCockpit((s) => s.pushToast);

  const [vaultPath, setVaultPath] = useState("");
  const [scriptsPath, setScriptsPath] = useState("");
  const [reposParent, setReposParent] = useState("");
  const [lmEndpoint, setLmEndpoint] = useState("");
  const [obsToken, setObsToken] = useState("");
  const [mcp, setMcp] = useState<McpServer[]>([]);
  const [lmStatus, setLmStatus] = useState<"idle" | "ok" | "down">("idle");

  // ブリッジ接続（ハイブリッド）。
  const [bridgeUrl, setBridgeUrl] = useState(
    bridge.getBridgeConfig().url || "http://127.0.0.1:8787"
  );
  const [bridgeToken, setBridgeToken] = useState("");
  const [connecting, setConnecting] = useState(false);

  const onConnectBridge = async () => {
    setConnecting(true);
    const ok = await bridge.connectBridge(bridgeUrl, bridgeToken);
    setConnecting(false);
    if (ok) {
      pushToast({ level: "info", title: "ブリッジ接続", body: "接続しました。実連携を有効化します…" });
      setBridgeToken("");
      // 接続後はクリーンに全画面を実連携へ切り替えるため再読込（重複購読を防ぐ）。
      setTimeout(() => window.location.reload(), 700);
    } else {
      pushToast({
        level: "warn",
        title: "接続できません",
        body: "Mac で jarvis-bridge が起動中か、URL/トークンが正しいか確認してください。",
      });
    }
  };

  const onDisconnectBridge = () => {
    bridge.disconnectBridge();
    pushToast({ level: "info", title: "切断", body: "デモ（モック）表示に戻します…" });
    setTimeout(() => window.location.reload(), 500);
  };

  useEffect(() => {
    if (settings) {
      setVaultPath(settings.vault_path);
      setScriptsPath(settings.scripts_path);
      setReposParent(settings.repos_parent);
      setLmEndpoint(settings.lmstudio_endpoint);
    }
    api.mcpList().then(setMcp).catch(() => setMcp([]));
  }, [settings]);

  const savePaths = async () => {
    await api.settingsSet({
      vault_path: vaultPath,
      scripts_path: scriptsPath,
      repos_parent: reposParent,
      lmstudio_endpoint: lmEndpoint,
    });
    pushToast({ level: "info", title: "保存", body: "設定を更新しました。" });
  };

  // トークンは Keychain 保存（§9）。値はフロントに残さない（保存後にクリア）。
  const saveToken = async () => {
    await api.secretSet("obsidian", obsToken);
    setObsToken("");
    pushToast({ level: "info", title: "Keychain", body: "Obsidian トークンを Keychain に保存しました。" });
  };

  const testLm = async () => {
    try {
      const res = await fetch(`${lmEndpoint}/v1/models`);
      setLmStatus(res.ok ? "ok" : "down");
    } catch {
      setLmStatus("down");
    }
  };

  const toggleMcp = async (s: McpServer) => {
    await api.mcpToggle(s.name, !s.enabled);
    setMcp((cur) => cur.map((x) => (x.name === s.name ? { ...x, enabled: !x.enabled } : x)));
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Settings" jp="設定" />
      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-6">
        {!isTauri() && (
          <Card title="ブリッジ接続（実連携）" className="col-span-2">
            <p className="mb-3 text-[12px] text-base-400">
              この公開アプリは、あなたのMacで動く <span className="mono">jarvis-bridge</span> 経由で
              実 Codex / Obsidian / LM Studio に接続します（§ハイブリッド）。
              ブリッジを起動し、表示された <b>Token</b> を貼り付けてください。
            </p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field label="ブリッジ URL" value={bridgeUrl} onChange={setBridgeUrl} />
              </div>
              <div className="flex-1">
                <Field label="Token（起動時に表示）" value={bridgeToken} onChange={setBridgeToken} password />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              {transport === "bridge" ? (
                <>
                  <Pill tone="ok">● 接続中（実連携）</Pill>
                  <Button onClick={onDisconnectBridge}>切断</Button>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={onConnectBridge} disabled={connecting || !bridgeToken}>
                    {connecting ? "接続中…" : "接続"}
                  </Button>
                  <Pill tone="muted">未接続（デモはモック表示）</Pill>
                </>
              )}
            </div>
            <p className="mt-2 text-[11px] text-base-500">
              未接続でも 8 画面はモックデータで操作できます。Token はこのブラウザにのみ保存（localStorage）。
              入手方法は <span className="mono">docs/BRIDGE.md</span> を参照。
            </p>
          </Card>
        )}

        <Card title="パス">
          <Field label="Vault" value={vaultPath} onChange={setVaultPath} />
          <Field label="リポジトリ親" value={reposParent} onChange={setReposParent} />
          <Field label="scripts" value={scriptsPath} onChange={setScriptsPath} />
          <div className="mt-3">
            <Button variant="primary" onClick={savePaths}>
              保存
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-base-500">
            初回起動時 ${"{WORKSPACE_ROOT}"}/tmp に iCloud 同期除外 xattr を適用（§14.5）。
          </p>
        </Card>

        <Card title="トークン（Keychain 保存・平文非表示）">
          <Field label="Obsidian キー" value={obsToken} onChange={setObsToken} password />
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={saveToken} disabled={!obsToken}>
              Keychain に保存
            </Button>
            <Pill tone={settings ? "ok" : "muted"}>API キー欄なし（§9）</Pill>
          </div>
          <p className="mt-2 text-[11px] text-base-500">
            GitHub PAT 等も Keychain のみ。画面・ログ・設定ファイルに平文を出しません。
          </p>
        </Card>

        <Card title="LM Studio">
          <Field label="エンドポイント" value={lmEndpoint} onChange={setLmEndpoint} />
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={testLm}>疎通テスト</Button>
            {lmStatus !== "idle" && (
              <Pill tone={lmStatus === "ok" ? "ok" : "down"}>
                {lmStatus === "ok" ? "接続 OK" : "接続不可"}
              </Pill>
            )}
          </div>
        </Card>

        <Card title="MCP サーバー">
          <div className="space-y-2">
            {mcp.map((s) => (
              <div key={s.name} className="flex items-center justify-between rounded border border-base-700 px-3 py-2">
                <div>
                  <span className="mono text-sm">{s.name}</span>
                  <span className="ml-2 text-[10px] text-base-500">{s.transport}</span>
                </div>
                <button
                  onClick={() => toggleMcp(s)}
                  className={`rounded px-2 py-0.5 text-xs ${s.enabled ? "bg-ok/20 text-ok" : "bg-base-700 text-muted"}`}
                >
                  {s.enabled ? "有効" : "無効"}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-base-500">未使用 MCP は無効化を推奨（Plus 制限保護, §9）。</p>
        </Card>

        <Card title="ログイン" className="col-span-2">
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={async () => {
                await api.codexLogin();
                pushToast({ level: "info", title: "codex login", body: "ログインフローを起動しました。" });
              }}
            >
              codex login を起動
            </Button>
            <span className="text-sm text-muted">ChatGPT 経路のみ（APIキー入力は持ちません）。</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  password,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  password?: boolean;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mono w-full rounded-md border border-base-700 bg-base-900 px-3 py-1.5 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}
