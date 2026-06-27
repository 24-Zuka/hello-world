// ブリッジ・トランスポート（ハイブリッド構成）。
// 公開Webアプリ（GitHub Pages）から、ユーザーのMacで動く jarvis-bridge
// (http://127.0.0.1:8787) へ接続し、実 Codex/Obsidian/LM Studio を操作する。
//
// 仕組み: https のページから http://127.0.0.1 への fetch / EventSource は
// 主要ブラウザで localhost 例外として許可される。認証は Bearer トークン
// （ブリッジ起動時に表示され、ユーザーが下の Settings に貼り付ける）。

const LS_URL = "jarvis.bridge.url";
const LS_TOKEN = "jarvis.bridge.token";

// 設定済みなら module ロード時点で楽観的に active=true にする。これにより、
// 非同期 ping を待たずに（コンポーネントの初回 fetch も含め）全 invoke が
// ブリッジへルーティングされ、transport 決定の競合を防ぐ。ping は autoConnect で検証。
let active = isBridgeConfigured();

export function getBridgeConfig(): { url: string; token: string } {
  if (typeof localStorage === "undefined") return { url: "", token: "" };
  return {
    url: localStorage.getItem(LS_URL) ?? "",
    token: localStorage.getItem(LS_TOKEN) ?? "",
  };
}

function saveConfig(url: string, token: string) {
  localStorage.setItem(LS_URL, url.replace(/\/+$/, ""));
  localStorage.setItem(LS_TOKEN, token);
}

function clearConfig() {
  localStorage.removeItem(LS_URL);
  localStorage.removeItem(LS_TOKEN);
}

export function isBridgeConfigured(): boolean {
  const c = getBridgeConfig();
  return !!c.url && !!c.token;
}

/** 現在ブリッジ経由で通信しているか（api.ts / events.ts のトランスポート判定）。 */
export function isBridgeActive(): boolean {
  return active;
}

/** liveness。/health は無認証。 */
export async function pingBridge(url?: string): Promise<boolean> {
  const u = (url ?? getBridgeConfig().url).replace(/\/+$/, "");
  if (!u) return false;
  try {
    const res = await fetch(`${u}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/** 接続: 設定を保存 → ping → 成功なら active + SSE 購読開始。 */
export async function connectBridge(url: string, token: string): Promise<boolean> {
  saveConfig(url, token);
  const ok = await pingBridge(url);
  active = ok;
  if (ok) startBridgeStream();
  return ok;
}

/** 起動時の自動再接続（設定済みなら）。 */
export async function autoConnect(): Promise<boolean> {
  if (!isBridgeConfigured()) return false;
  const { url, token } = getBridgeConfig();
  return connectBridge(url, token);
}

export function disconnectBridge() {
  active = false;
  stopBridgeStream();
  clearConfig();
}

/** §7.1 invoke を HTTP POST で代理。void コマンドは空ボディを返す。 */
export async function bridgeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { url, token } = getBridgeConfig();
  const res = await fetch(`${url}/invoke/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) {
    let msg = `bridge: ${cmd} が失敗しました (HTTP ${res.status})`;
    try {
      const j = await res.json();
      if (j && typeof j.error === "string") msg = j.error;
    } catch {
      /* non-json */
    }
    throw new Error(msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ── SSE イベントバス（browserMock.on と同じ形） ──────────────────────────────
type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();
let es: EventSource | null = null;

export function bridgeOn(event: string, handler: Handler): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function startBridgeStream() {
  if (es) return;
  const { url, token } = getBridgeConfig();
  if (!url || !token) return;
  // EventSource はヘッダを付けられないため token はクエリで渡す（ブリッジが対応）。
  es = new EventSource(`${url}/events?token=${encodeURIComponent(token)}`);
  es.onmessage = (ev) => {
    try {
      const { event, payload } = JSON.parse(ev.data) as { event: string; payload: unknown };
      listeners.get(event)?.forEach((h) => h(payload));
    } catch {
      /* keep-alive 等は無視 */
    }
  };
  // onerror 時、EventSource は自動再接続する。
}

export function stopBridgeStream() {
  es?.close();
  es = null;
}
