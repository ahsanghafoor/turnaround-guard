"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { Globe2, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { resetDemoAction } from "@/app/actions";
import { tzLabel, useHydrated } from "@/lib/format";

const links = [
  { href: "/", label: "Fleet" },
  { href: "/bookings", label: "Bookings" },
];

export function Header() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [resetting, startReset] = useTransition();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white shadow-[var(--shadow-brand)]">
            <ShieldCheck size={18} strokeWidth={2.5} />
          </span>
          <span className="h-display hidden text-[17px] sm:inline">
            Turnaround<span className="text-brand"> Guard</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-4 py-1.5 text-[14px] font-semibold transition-colors ${
                  active ? "bg-navy text-white" : "text-slate hover:bg-sand hover:text-navy"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span
            className="hidden items-center gap-1.5 text-[13px] text-slate md:flex"
            title="All times are shown in your browser's timezone"
          >
            <Globe2 size={14} />
            {hydrated ? `Local time · ${tzLabel()}` : "Local time"}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={resetting}
            onClick={() => {
              if (confirm("Reset all bookings to the demo data, anchored to the current hour?")) {
                startReset(async () => {
                  await resetDemoAction();
                });
              }
            }}
          >
            <RotateCcw size={14} className={resetting ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Reset demo</span>
          </button>
          <Link href="/bookings/new" className="btn btn-primary btn-sm">
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">New booking</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
