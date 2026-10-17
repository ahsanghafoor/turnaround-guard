"use client";

import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, CarFront, CheckCircle2, KeyRound } from "lucide-react";
import { explainConflict, type ChainEntry } from "@/lib/availability";
import { bookingPhase, fmtWhen, useNow } from "@/lib/format";
import type { Booking, Car } from "@/lib/types";
import { Timeline, TimelineLegend } from "./Timeline";
import { NeedsActionPill, SeverityPill, SkeletonBlock } from "./ui";

export function FleetOverview({
  cars,
  bookings,
  chains,
}: {
  cars: Car[];
  bookings: Booking[];
  chains: Record<string, ChainEntry[]>;
}) {
  const now = useNow();
  const carById = new Map(cars.map((c) => [c.id, c]));

  // Alerts for bookings that haven't been returned yet.
  const alerts = Object.values(chains)
    .flat()
    .filter((e) => e.status !== "ok" && e.booking.status !== "completed")
    .sort((a, b) =>
      a.status === b.status ? Date.parse(a.booking.pickupAt) - Date.parse(b.booking.pickupAt) : a.status === "critical" ? -1 : 1,
    );
  const criticals = alerts.filter((a) => a.status === "critical").length;
  const warnings = alerts.length - criticals;
  const outNow = now ? bookings.filter((b) => bookingPhase(b, now) === "active").length : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Fleet overview</div>
          <h1 className="h-display text-[34px] sm:text-[40px]">Every car, every handoff</h1>
          <p className="mt-2 max-w-xl text-[16px]">
            Bookings by vehicle for the next 7 days, with each car&apos;s turnaround buffer shaded after every return.
          </p>
        </div>
        <Link href="/bookings/new" className="btn btn-primary">
          New booking <ArrowRight size={16} />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<CarFront size={18} />} label="Vehicles" value={cars.length} />
        <Stat icon={<KeyRound size={18} />} label="Out with renters" value={outNow} />
        <Stat
          icon={<AlertTriangle size={18} />}
          label="Rushed turnarounds"
          value={warnings}
          tone={warnings ? "warn" : undefined}
        />
        <Stat
          icon={<AlertOctagon size={18} />}
          label="Critical conflicts"
          value={criticals}
          tone={criticals ? "danger" : undefined}
        />
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="h-display text-[20px]">Timeline</h2>
          <TimelineLegend />
        </div>
        {now === null ? (
          <div className="space-y-3 p-5">
            {cars.map((c) => (
              <SkeletonBlock key={c.id} className="h-16" />
            ))}
          </div>
        ) : (
          <Timeline cars={cars} chains={chains} now={now} />
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="h-display text-[20px]">Needs attention</h2>
          <span className="text-[13px]">{alerts.length ? `${alerts.length} open` : ""}</span>
        </div>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-6 text-[15px]">
            <CheckCircle2 className="text-success" size={22} />
            Every handoff has a full turnaround. Nothing to fix.
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {alerts.map((a) => (
              <AlertRow key={a.booking.id} entry={a} car={carById.get(a.booking.carId)} hydrated={now !== null} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AlertRow({ entry, car, hydrated }: { entry: ChainEntry; car?: Car; hydrated: boolean }) {
  const { booking, status, conflict } = entry;
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
          status === "critical" ? "bg-danger-tint text-danger" : "bg-warn-tint text-warn"
        }`}
      >
        {status === "critical" ? <AlertOctagon size={20} /> : <AlertTriangle size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-navy">{booking.renterName}</span>
          <span className="text-[13px]">· {car?.name}</span>
          <SeverityPill status={status} />
          {booking.status === "needs-action" && <NeedsActionPill />}
        </div>
        <p className="mt-1 text-[14px]">
          {hydrated && conflict ? explainConflict(conflict, fmtWhen) : " "}
        </p>
      </div>
      <Link href={`/bookings?focus=${booking.id}`} className="btn btn-secondary btn-sm">
        {status === "critical" ? "Resolve" : "Review"} <ArrowRight size={14} />
      </Link>
    </li>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  tone?: "warn" | "danger";
}) {
  const accent =
    tone === "danger" ? "bg-danger-tint text-danger" : tone === "warn" ? "bg-warn-tint text-warn-ink" : "bg-peach text-brand";
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className={`grid h-11 w-11 place-items-center rounded-xl ${accent}`}>{icon}</div>
      <div>
        <div className="h-display text-[28px] leading-none">{value ?? "–"}</div>
        <div className="mt-1 text-[13px]">{label}</div>
      </div>
    </div>
  );
}
