"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, CalendarClock, CarFront, CheckCircle2, Clock, Plus, X } from "lucide-react";
import { explainConflict, planResolution, type ChainEntry } from "@/lib/availability";
import { bookingPhase, fmtDateTime, fmtDuration, fmtWhen, lateByMinutes, useNow, type Phase } from "@/lib/format";
import type { Booking, Car } from "@/lib/types";
import { MarkLateDialog, ReassignDialog } from "./ResolveDialogs";
import { CarLabel, NeedsActionPill, PhasePill, SeverityPill, SkeletonBlock } from "./ui";

type Filter = "all" | "attention" | "active" | "upcoming" | "returned";

type Dialog =
  | { type: "late"; id: string; report: ChainEntry[] | null }
  | { type: "reassign"; id: string; back: Dialog | null };

export function BookingsList({
  cars,
  bookings,
  chains,
  focus,
}: {
  cars: Car[];
  bookings: Booking[];
  chains: Record<string, ChainEntry[]>;
  focus: string | null;
}) {
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const carById = useMemo(() => new Map(cars.map((c) => [c.id, c])), [cars]);
  const chainById = useMemo(
    () => new Map(Object.values(chains).flat().map((e) => [e.booking.id, e])),
    [chains],
  );
  const fleet = { cars, bookings, chainById };

  useEffect(() => {
    if (focus && now !== null) {
      document.getElementById(`row-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focus, now === null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (now === null) {
    return (
      <div className="space-y-3">
        <SkeletonBlock className="h-11 w-[460px]" />
        <SkeletonBlock className="h-[520px]" />
      </div>
    );
  }

  const needsAttention = (b: Booking) =>
    b.status === "needs-action" ||
    (b.status !== "completed" && b.status !== "cancelled" && (chainById.get(b.id)?.status ?? "ok") !== "ok");

  const phaseOf = (b: Booking): Phase => bookingPhase(b, now);
  const matches: Record<Filter, (b: Booking) => boolean> = {
    all: () => true,
    attention: needsAttention,
    active: (b) => ["active", "overdue"].includes(phaseOf(b)),
    upcoming: (b) => phaseOf(b) === "upcoming",
    returned: (b) => phaseOf(b) === "returned",
  };
  const visible = [...bookings]
    .filter(matches[filter])
    .sort((a, b) => Date.parse(a.pickupAt) - Date.parse(b.pickupAt));

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "attention", label: "Needs attention" },
    { id: "active", label: "Out now" },
    { id: "upcoming", label: "Upcoming" },
    { id: "returned", label: "Returned" },
  ];

  const dialogBooking = dialog ? bookings.find((b) => b.id === dialog.id) : null;

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-center gap-3 rounded-2xl border border-success/50 bg-success-tint px-4 py-3 text-[14px] font-medium text-success-ink">
          <CheckCircle2 size={18} />
          {notice}
          <button type="button" className="ml-auto" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => {
          const count = bookings.filter(matches[t.id]).length;
          const active = filter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-[14px] font-semibold transition-colors ${
                active ? "border-navy bg-navy text-white" : "border-line bg-white text-slate hover:border-navy hover:text-navy"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 text-[12px] ${
                  active ? "bg-white/20" : t.id === "attention" && count > 0 ? "bg-danger text-white" : "bg-sand"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <section className="card overflow-hidden">
        <div className="hidden grid-cols-[1.3fr_1.2fr_1.15fr_1.25fr_1.1fr_200px] gap-4 border-b border-line bg-sand/60 px-5 py-3 text-[12px] font-bold uppercase tracking-wider text-mist lg:grid">
          <span>Renter</span>
          <span>Vehicle</span>
          <span>Pickup</span>
          <span>Return</span>
          <span>Status</span>
          <span className="text-right">Actions</span>
        </div>
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
            <CheckCircle2 className="text-success" size={28} />
            <p className="text-[15px]">Nothing here.</p>
            <Link href="/bookings/new" className="btn btn-primary btn-sm">
              <Plus size={14} /> New booking
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {visible.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                car={carById.get(b.carId)}
                entry={chainById.get(b.id)}
                phase={phaseOf(b)}
                focused={b.id === focus}
                fleet={fleet}
                onMarkLate={() => setDialog({ type: "late", id: b.id, report: null })}
                onResolve={() => setDialog({ type: "reassign", id: b.id, back: null })}
              />
            ))}
          </ul>
        )}
      </section>

      {dialog?.type === "late" && dialogBooking && (
        <MarkLateDialog
          booking={dialogBooking}
          fleet={fleet}
          now={now}
          report={dialog.report}
          onReport={(report) => setDialog({ ...dialog, report })}
          onReassign={(id) => setDialog({ type: "reassign", id, back: dialog })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "reassign" && dialogBooking && (
        <ReassignDialog
          booking={dialogBooking}
          fleet={fleet}
          now={now}
          onDone={(message) => {
            setNotice(message);
            setDialog(dialog.back);
          }}
          onClose={() => setDialog(dialog.back)}
        />
      )}
    </div>
  );
}

function BookingRow({
  booking,
  car,
  entry,
  phase,
  focused,
  fleet,
  onMarkLate,
  onResolve,
}: {
  booking: Booking;
  car?: Car;
  entry?: ChainEntry;
  phase: Phase;
  focused: boolean;
  fleet: { cars: Car[]; bookings: Booking[] };
  onMarkLate: () => void;
  onResolve: () => void;
}) {
  const open = booking.status === "confirmed" || booking.status === "needs-action";
  const status = open ? (entry?.status ?? "ok") : "ok";
  const stuck = booking.status === "needs-action";
  const late = lateByMinutes(booking);
  const canMarkLate = booking.status === "confirmed" && (phase === "active" || phase === "overdue");
  const resolution = status === "critical" ? planResolution(booking, fleet.cars, fleet.bookings) : null;

  return (
    <li
      id={`row-${booking.id}`}
      className={`scroll-mt-24 px-5 py-4 transition-colors ${focused ? "bg-peach/50 shadow-[inset_3px_0_0_var(--color-brand)]" : ""}`}
    >
      <div className="grid items-center gap-x-4 gap-y-2 lg:grid-cols-[1.3fr_1.2fr_1.15fr_1.25fr_1.1fr_200px]">
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy">{booking.renterName}</div>
          <div className="text-[12px] text-mist">{booking.id}</div>
        </div>
        <div>{car ? <CarLabel car={car} /> : <span className="text-mist">Unknown car</span>}</div>
        <div className="text-[14px] text-navy">{fmtDateTime(booking.pickupAt)}</div>
        <div className="text-[14px] text-navy">
          {late > 0 ? (
            <>
              <span className="block text-mist line-through decoration-mist/60">{fmtDateTime(booking.returnAt)}</span>
              <span className="flex items-center gap-1 font-semibold text-danger-ink">
                <Clock size={13} /> {fmtWhen(booking.actualReturnAt!)} · {fmtDuration(late)} late
              </span>
            </>
          ) : (
            fmtDateTime(booking.returnAt)
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {stuck ? <NeedsActionPill /> : <PhasePill phase={phase} />}
          {status !== "ok" && <SeverityPill status={status} />}
        </div>
        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
          {canMarkLate && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onMarkLate}>
              <Clock size={14} /> Mark returned late
            </button>
          )}
          {resolution?.action === "reassign" && (
            <button type="button" className="btn btn-danger btn-sm" onClick={onResolve}>
              <CarFront size={14} /> Reassign car
            </button>
          )}
          {resolution?.action === "needs-action" && (
            <button type="button" className="btn btn-danger btn-sm" onClick={onResolve}>
              <AlertOctagon size={14} /> Resolve
            </button>
          )}
        </div>
      </div>

      {status !== "ok" && entry?.conflict && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[14px] ${
            status === "critical" ? "bg-danger-tint text-danger-ink" : "bg-warn-tint text-warn-ink"
          }`}
        >
          {status === "critical" ? <AlertOctagon size={16} className="mt-0.5 shrink-0" /> : <CalendarClock size={16} className="mt-0.5 shrink-0" />}
          <span>
            {explainConflict(entry.conflict, fmtWhen)}
            {resolution?.action === "needs-action" &&
              (resolution.slot
                ? ` No same-class car is free. Nearest slot on this car: ${fmtWhen(resolution.slot.pickupAt)}.`
                : " No same-class car is free and no slot in the next 7 days.")}
          </span>
        </div>
      )}
    </li>
  );
}
