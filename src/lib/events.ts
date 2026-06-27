// イベント購読の統一層（§7.2）。トランスポートに応じて配信元を切り替える:
//   Tauri=listen / Bridge=SSE(bridgeOn) / ブラウザ単体=browserMock バス。
import { isTauri } from "./api";
import * as bridge from "./bridge";
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
  if (bridge.isBridgeActive()) {
    return bridge.bridgeOn(event, (p) => handler(p as T));
  }
  return browserMock.on(event, (p) => handler(p as T));
}

// tick の発火元: Tauri/Bridge は Rust 側が実 emit。ブラウザ単体のみ擬似 tick。
export function startBackgroundTicks() {
  if (isTauri() || bridge.isBridgeActive()) return;
  browserMock.startTicks();
}
