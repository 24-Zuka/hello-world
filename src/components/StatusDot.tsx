import type { Status } from "../types";

// 状態色（§6）: 緑=正常 / 黄=警告 / 赤=要対応 / グレー=不明。
const COLOR: Record<Status, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  down: "bg-down",
  unknown: "bg-muted",
};

const LABEL: Record<Status, string> = {
  ok: "正常",
  warn: "警告",
  down: "要対応",
  unknown: "不明",
};

export function StatusDot({ status, label }: { status: Status; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" title={LABEL[status]}>
      <span className={`h-2.5 w-2.5 rounded-full ${COLOR[status]}`} aria-label={LABEL[status]} />
      {label && <span className="text-sm text-muted">{label}</span>}
    </span>
  );
}
