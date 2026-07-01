import type { ReactNode } from "react";

// 共有プリミティブ。詳細画面は余白を取る（§6 密度）。
export function ScreenHeader({ title, jp, children }: { title: string; jp: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3 border-b border-base-700 bg-base-900/80 px-4 py-3 md:px-5">
      <h1 className="font-display text-[24px] font-bold leading-none tracking-normal text-text1 md:text-[26px]">{title}</h1>
      <span className="text-[11px] text-muted">{jp}</span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-base-700 bg-base-850 ${className}`}>
      {title && (
        <div className="border-b border-base-700 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-text2">{title}</div>
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
    default: "border border-base-600 text-text1 hover:border-accent-border hover:bg-base-800",
    primary: "bg-accent text-[#04101f] font-semibold hover:bg-accent-soft",
    danger: "border border-down/50 text-down hover:bg-down/10",
    ghost: "text-muted hover:text-text1 hover:bg-base-800",
  }[variant];
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40 ${styles}`}
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
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}
