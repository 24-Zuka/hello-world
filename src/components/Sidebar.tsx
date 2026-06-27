import { useCockpit } from "../store/cockpit";
import type { ScreenId } from "../types";

const NAV: { id: ScreenId; label: string; jp: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", jp: "司令室", icon: "◎" },
  { id: "agents", label: "Agents", jp: "組織図", icon: "❖" },
  { id: "build", label: "Build", jp: "開発", icon: "⚙" },
  { id: "memory", label: "Memory", jp: "記憶", icon: "▤" },
  { id: "schedule", label: "Schedule", jp: "定時運用", icon: "◷" },
  { id: "research", label: "Research", jp: "調査", icon: "⌕" },
  { id: "quota", label: "Quota & Cost", jp: "コスト管制", icon: "◔" },
  { id: "settings", label: "Settings", jp: "設定", icon: "⚒" },
];

// 左サイドバー固定（§4）。全画面へ常時アクセス可能（付録A）。
export function Sidebar() {
  const screen = useCockpit((s) => s.screen);
  const setScreen = useCockpit((s) => s.setScreen);
  const togglePalette = useCockpit((s) => s.togglePalette);

  return (
    <nav className="flex w-56 flex-col border-r border-base-700 bg-base-900">
      <div className="px-5 py-5">
        <div className="text-lg font-semibold tracking-wide text-accent">JARVIS</div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted">Cockpit</div>
      </div>
      <ul className="flex-1 space-y-0.5 px-2">
        {NAV.map((n) => {
          const active = screen === n.id;
          return (
            <li key={n.id}>
              <button
                onClick={() => setScreen(n.id)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-base-700 text-white"
                    : "text-muted hover:bg-base-800 hover:text-white"
                }`}
              >
                <span className="w-4 text-center text-accent">{n.icon}</span>
                <span className="flex-1">{n.label}</span>
                <span className="text-[10px] text-base-500">{n.jp}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        onClick={() => togglePalette(true)}
        className="m-2 rounded-md border border-base-700 px-3 py-2 text-xs text-muted hover:text-white"
      >
        ⌘K コマンドパレット
      </button>
    </nav>
  );
}
