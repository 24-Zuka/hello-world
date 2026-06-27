import type { Quota } from "../types";

// Plus残量SVGゲージ（§4.1）。80%超で警告色。§12: source=unknown は「不明」を正直に表示。
export function QuotaGauge({ quota, size = 140 }: { quota: Quota | null; size?: number }) {
  const unknown = !quota || quota.source === "unknown" || quota.window_limit <= 0;
  const pct = unknown
    ? 0
    : Math.min(100, Math.round((quota!.window_used / quota!.window_limit) * 100));

  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = unknown ? 0 : (pct / 100) * c;

  const color = unknown ? "#8A94A6" : pct >= 80 ? "#FBBF24" : pct >= 95 ? "#F87171" : "#3FB5B0";

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F2630" strokeWidth={stroke} />
        {!unknown && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="-mt-[88px] flex flex-col items-center" style={{ width: size }}>
        {unknown ? (
          <>
            <span className="text-2xl font-semibold text-muted">不明</span>
            <span className="text-[10px] text-base-500">公式API無し (§12)</span>
          </>
        ) : (
          <>
            <span className="text-3xl font-semibold" style={{ color }}>
              {pct}%
            </span>
            <span className="text-[10px] text-muted">5h ウィンドウ</span>
          </>
        )}
      </div>
      <div className="mt-[60px] text-center text-xs text-muted">
        {unknown
          ? "残量を取得できません"
          : quota?.resets_at
            ? `リセット: ${quota.resets_at}`
            : ""}
      </div>
    </div>
  );
}
