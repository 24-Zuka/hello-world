import { create } from "zustand";

import { api, isTauri } from "../lib/api";
import * as bridge from "../lib/bridge";
import { listen, startBackgroundTicks } from "../lib/events";
import type {
  ApprovalRequest,
  AppSettings,
  AuthStatus,
  Health,
  Job,
  Quota,
  ScreenId,
} from "../types";

interface Toast {
  id: number;
  level: string;
  title: string;
  body: string;
}

// 現在の通信経路（§ハイブリッド）。HealthBar / Settings が参照する。
export type Transport = "tauri" | "bridge" | "mock";

interface CockpitState {
  screen: ScreenId;
  transport: Transport;
  health: Health | null;
  quota: Quota | null;
  auth: AuthStatus | null;
  settings: AppSettings | null;
  jobs: Record<string, Job>;
  approval: ApprovalRequest | null;
  paletteOpen: boolean;
  toasts: Toast[];

  setScreen: (s: ScreenId) => void;
  requestApproval: (req: ApprovalRequest) => void;
  closeApproval: () => void;
  togglePalette: (open?: boolean) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;

  // 退避モード（§4.7）: ON で全実行を local_review/ローカルへ。
  setRetreatMode: (on: boolean) => Promise<void>;

  init: () => Promise<void>;
  refreshJob: (id: string, patch: Partial<Job>, appendLog?: string) => void;
  startJob: (id: string, kind: Job["kind"], worktree?: string) => void;
}

let toastSeq = 1;

export const useCockpit = create<CockpitState>((set, get) => ({
  screen: "dashboard",
  transport: "mock",
  health: null,
  quota: null,
  auth: null,
  settings: null,
  jobs: {},
  approval: null,
  paletteOpen: false,
  toasts: [],

  setScreen: (screen) => set({ screen }),
  requestApproval: (approval) => set({ approval }),
  closeApproval: () => set({ approval: null }),
  togglePalette: (open) => set((st) => ({ paletteOpen: open ?? !st.paletteOpen })),
  pushToast: (t) =>
    set((st) => ({ toasts: [...st.toasts, { ...t, id: toastSeq++ }] })),
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })),

  setRetreatMode: async (on) => {
    const next = await api.settingsSet({ retreat_mode: on });
    set({ settings: next });
    get().pushToast({
      level: on ? "warn" : "info",
      title: on ? "退避モード ON" : "退避モード OFF",
      body: on ? "以降の実行をローカルモデルへ退避します。" : "通常の Plus 経路に戻しました。",
    });
  },

  startJob: (id, kind, worktree) =>
    set((st) => ({ jobs: { ...st.jobs, [id]: { id, kind, worktree, status: "running", logs: [] } } })),

  refreshJob: (id, patch, appendLog) =>
    set((st) => {
      const cur = st.jobs[id] ?? { id, kind: "build", status: "running", logs: [] };
      return {
        jobs: {
          ...st.jobs,
          [id]: {
            ...cur,
            ...patch,
            logs: appendLog ? [...cur.logs, appendLog] : cur.logs,
          },
        },
      };
    }),

  init: async () => {
    // ハイブリッド: Tauri 外なら設定済みブリッジへ自動再接続を試みる。
    if (!isTauri()) {
      await bridge.autoConnect();
    }
    const transport: Transport = isTauri()
      ? "tauri"
      : bridge.isBridgeActive()
        ? "bridge"
        : "mock";
    set({ transport });

    const [health, quota, auth, settings] = await Promise.all([
      api.healthCheck(),
      api.quotaStatus(),
      api.codexAuthStatus(),
      api.settingsGet(),
    ]);
    set({ health, quota, auth, settings });

    // 定期 tick と job ストリームを購読。
    startBackgroundTicks();
    await listen<Health>("health:tick", (h) => set({ health: h }));
    await listen<Quota>("quota:tick", (q) => set({ quota: q }));
    await listen<{ jobId: string; line: string }>("job:log", (e) =>
      get().refreshJob(e.jobId, {}, e.line)
    );
    await listen<{ jobId: string; exitCode: number }>("job:done", (e) =>
      get().refreshJob(e.jobId, { status: e.exitCode === 0 ? "done" : "error" })
    );
    await listen<{ level: string; title: string; body: string }>("notify", (n) =>
      get().pushToast(n)
    );
  },
}));
