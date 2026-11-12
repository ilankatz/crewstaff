"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api, useData } from "@/lib/api";
import { cx } from "@/components/ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◧" },
  { href: "/jobs", label: "Jobs", icon: "▤" },
  { href: "/workers", label: "Labor pool", icon: "◉" },
  { href: "/clients", label: "Clients & venues", icon: "◆" },
  { href: "/messages", label: "Messages", icon: "✉" },
  { href: "/invoices", label: "Invoices", icon: "$" },
  { href: "/payroll", label: "Payroll export", icon: "⇩" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

type Me = { name: string; email: string; is_admin: boolean };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { data: me } = useData<Me>("/me");
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={cx(
          "no-print fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r border-line bg-ink text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-full flex-col">
          <Link href="/" className="px-5 py-5 text-xl font-bold tracking-tight" onClick={() => setOpen(false)}>
            Crew<span className="text-accent">Staff</span>
          </Link>
          <nav className="flex-1 space-y-0.5 px-3">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active(n.href) ? "bg-white/12 text-white" : "text-white/60 hover:bg-white/6 hover:text-white",
                )}
              >
                <span className="w-4 text-center text-white/50">{n.icon}</span>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-white/10 px-5 py-4 text-xs">
            <div className="font-medium text-white/80">{me?.name}</div>
            <div className="truncate text-white/40">{me?.email}</div>
            <button
              className="mt-2 text-white/50 hover:text-white"
              onClick={async () => {
                await api("POST", "/auth/logout");
                // Full reload so no signed-in state survives.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = "/login";
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded border border-line px-2 py-1 text-sm" aria-label="Menu">
            ☰
          </button>
          <span className="font-bold">
            Crew<span className="text-accent">Staff</span>
          </span>
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
