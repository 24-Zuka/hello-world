import { useEffect } from "react";

import { ApprovalModal } from "./components/ApprovalModal";
import { CommandPalette } from "./components/CommandPalette";
import { HealthBar } from "./components/HealthBar";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { useCockpit } from "./store/cockpit";
import { Agents } from "./screens/Agents";
import { Build } from "./screens/Build";
import { Dashboard } from "./screens/Dashboard";
import { Memory } from "./screens/Memory";
import { Quota } from "./screens/Quota";
import { Research } from "./screens/Research";
import { Schedule } from "./screens/Schedule";
import { Settings } from "./screens/Settings";

const SCREENS = {
  dashboard: Dashboard,
  agents: Agents,
  build: Build,
  memory: Memory,
  schedule: Schedule,
  research: Research,
  quota: Quota,
  settings: Settings,
};

export function App() {
  const screen = useCockpit((s) => s.screen);
  const init = useCockpit((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  const Screen = SCREENS[screen];

  return (
    <div className="flex h-screen overflow-hidden bg-base-900 text-gray-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <HealthBar />
        <main className="flex-1 overflow-auto">
          <Screen />
        </main>
      </div>
      <ApprovalModal />
      <CommandPalette />
      <Toasts />
    </div>
  );
}
