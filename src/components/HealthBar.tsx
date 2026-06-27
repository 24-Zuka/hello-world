import { useCockpit } from "../store/cockpit";
import { StatusDot } from "./StatusDot";

// 最上部・常時表示のヘルスバー（§4.1）。3依存の点灯 + 赤があれば原因を一言。
export function HealthBar() {
  const health = useCockpit((s) => s.health);
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
    </div>
  );
}
