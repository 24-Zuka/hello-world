// イベント購読の統一層（§7.2）。Tauri 内なら listen、ブラウザなら browserMock のバス。
import { isTauri } from "./api";
import * as browserMock from "./browserMock";

export type JobLog = { jobId: string; line: string; stream: "stdout" | "stderr" };
export type JobEvent = { jobId: string; type: string; payload: unknown };
export type JobDone = { jobId: string; exitCode: number; durationMs: number };
export type NotifyEvent = { level: string; title: string; body: string };

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (isTauri()) {
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    const un = await tauriListen<T>(event, (e) => handler(e.payload));
    return un;
  }
  return browserMock.on(event, (p) => handler(p as T));
}

// ブラウザ起動時は擬似 tick を開始（実 Tauri は Rust 側が emit）。
export function startBackgroundTicks() {
  if (!isTauri()) browserMock.startTicks();
}
