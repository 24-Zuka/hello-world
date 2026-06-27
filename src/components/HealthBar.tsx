import { useCockpit } from "../store/cockpit";
import { StatusDot } from "./StatusDot";

// 最上部・常時表示のヘルスバー（§4.1）。3依存の点灯 + 赤があれば原因を一言。
// 右側に現在の通信経路（Desktop / Bridge / Demo）を表示（§ハイブリッド）。
export function HealthBar() {
  const health = useCockpit((s) => s.health);
  const transport = useCockpit((s) => s.transport);
  const setScreen = useCockpit((s) => s.setScreen);

  return (
    <div className="flex items-center gap-6 border-b border-base-700 bg-base-850 px-5 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">Health</span>
      <StatusDot status={health?.codex ?? "unknown"} label="Codex (ChatGPT)" />
      <StatusDot status={health?.lmstudio ?? "unknown"} label="LM Studio" />
      <StatusDot status={health?.obsidian ?? "unknown"} label="Obsidian" />
      {health?.note && (
        // 静かに壊れない（§5）: 失敗を黙殺せず「直し方」を一文で。
        <span className="ml-auto truncate text-sm text-warn" title={health.note}>
          {health.note}
        </span>
      )}
      <button
        onClick={() => setScreen("settings")}
        className={`${health?.note ? "" : "ml-auto"} shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${transportStyle(transport)}`}
        title="通信経路（クリックで Settings）"
      >
        {transportLabel(transport)}
      </button>
    </div>
  );
}

function transportLabel(t: "tauri" | "bridge" | "mock"): string {
  if (t === "tauri") return "● Desktop";
  if (t === "bridge") return "● Bridge 実連携";
  return "○ Demo（モック）";
}

function transportStyle(t: "tauri" | "bridge" | "mock"): string {
  if (t === "bridge") return "border-ok/40 bg-ok/10 text-ok";
  if (t === "tauri") return "border-accent/40 bg-accent/10 text-accent";
  return "border-base-700 bg-base-800 text-muted";
}
