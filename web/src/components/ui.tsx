"use client";

import Link from "next/link";
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { Tone } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink/90 shadow-sm",
  secondary: "bg-white text-ink border border-line hover:bg-paper shadow-sm",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
  ghost: "text-ink/70 hover:bg-ink/5",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variants[variant],
        className,
      )}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", size = "md", children, className }: { href: string; variant?: Variant; size?: "sm" | "md"; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

const fieldCls =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-paper";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldCls, "pr-8", props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(fieldCls, props.className)} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink/50">{hint}</span>}
    </label>
  );
}

const tones: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  red: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({ tone = "slate", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone])}>
      {dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-block text-xs font-medium text-ink/50 hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink/60">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink/50">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{children}</div>;
}

export function Loading() {
  return <div className="py-16 text-center text-sm text-ink/40">Loading…</div>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        className={cx("w-full rounded-xl bg-white shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-ink/40 hover:bg-ink/5 hover:text-ink" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: "warn" }) {
  const inner = (
    <div className={cx("rounded-xl border bg-white p-4 shadow-sm transition", tone === "warn" ? "border-amber-300" : "border-line", href && "hover:border-ink/30")}>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

/** Shows a one-time secret (e.g. a temporary password) with a copy button. */
export function SecretBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <code className="text-lg font-semibold text-ink">{value}</code>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="mt-1 text-xs text-amber-800">Shown once. Share it with the worker; they can change it in the app.</div>
    </div>
  );
}

export const th = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/50";
export const td = "px-4 py-2.5 text-sm text-ink";
