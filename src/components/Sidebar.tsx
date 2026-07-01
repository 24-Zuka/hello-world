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
    <nav className="flex shrink-0 flex-col border-b border-base-700 bg-base-900 md:w-[236px] md:border-b-0 md:border-r">
      <div className="flex items-end justify-between px-4 py-3 md:block md:px-5 md:py-5">
        <div className="font-display text-xl font-bold tracking-normal text-accent">AirFlow</div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted">JARVIS Cockpit</div>
      </div>
      <ul className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:flex-1 md:space-y-0.5 md:overflow-visible md:pb-0">
        {NAV.map((n) => {
          const active = screen === n.id;
          return (
            <li key={n.id} className="shrink-0 md:shrink">
              <button
                onClick={() => setScreen(n.id)}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 min-w-[128px] items-center gap-2 rounded-lg px-3 text-left text-[13px] transition-colors md:w-full md:min-w-0 md:gap-3 ${
                  active
                    ? "border border-accent-border bg-accent-dim text-text1"
                    : "border border-transparent text-text2 hover:border-base-700 hover:bg-base-800 hover:text-text1"
                }`}
              >
                <span className="w-4 text-center text-accent">{n.icon}</span>
                <span className="flex-1">{n.label}</span>
                <span className="hidden text-[10px] text-base-500 md:inline">{n.jp}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        onClick={() => togglePalette(true)}
        className="mx-2 mb-2 hidden rounded-lg border border-base-700 px-3 py-2 text-xs text-muted hover:border-accent-border hover:text-text1 md:block"
      >
        ⌘K コマンドパレット
      </button>
    </nav>
  );
}
