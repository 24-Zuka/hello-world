import type { ReactNode } from "react";

// 共有プリミティブ。詳細画面は余白を取る（§6 密度）。
export function ScreenHeader({ title, jp, children }: { title: string; jp: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-base-700 px-6 py-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <span className="text-sm text-muted">{jp}</span>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-base-700 bg-base-850 ${className}`}>
      {title && (
        <div className="border-b border-base-700 px-4 py-2.5 text-sm font-medium text-gray-300">{title}</div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
}) {
  const styles = {
    default: "border border-base-600 text-gray-200 hover:bg-base-700",
    primary: "bg-accent text-base-900 font-medium hover:bg-accent-soft",
    danger: "border border-down/50 text-down hover:bg-down/10",
    ghost: "text-muted hover:text-white",
  }[variant];
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "down" | "accent" }) {
  const t = {
    muted: "bg-base-700 text-muted",
    ok: "bg-ok/20 text-ok",
    warn: "bg-warn/20 text-warn",
    down: "bg-down/20 text-down",
    accent: "bg-accent/20 text-accent",
  }[tone];
  return <span className={`rounded px-2 py-0.5 text-xs ${t}`}>{children}</span>;
}
