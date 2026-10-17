"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { AlertOctagon, AlertTriangle } from "lucide-react";
import { HOUR_MS, effectiveReturn, type ChainEntry } from "@/lib/availability";
import { bookingPhase, fmtDuration, fmtTime, fmtWhen, lateByMinutes } from "@/lib/format";
import type { Car } from "@/lib/types";
import { CarLabel } from "./ui";

const DAY_W = 152; // px per day
const DAYS = 9; // yesterday + today + 7 days ahead
const LABEL_W = 208;
const LANE_H = 46;
const ROW_PAD = 22; // top room for inline alert badges

const DAY_MS = 24 * HOUR_MS;

function localMidnight(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Puts overlapping bookings (only possible when there is a critical conflict) on separate lanes. */
function assignLanes(entries: ChainEntry[]): Map<string, number> {
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const e of entries) {
    const start = Date.parse(e.booking.pickupAt);
    const end = Date.parse(effectiveReturn(e.booking));
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    lanes.set(e.booking.id, lane);
  }
  return lanes;
}

export function Timeline({
  cars,
  chains,
  now,
}: {
  cars: Car[];
  chains: Record<string, ChainEntry[]>;
  now: number;
}) {
  const start = localMidnight(now - DAY_MS);
  // Build day starts by calendar day so DST shifts don't drift the grid.
  const dayStarts = Array.from({ length: DAYS + 1 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.getTime();
  });
  const end = dayStarts[DAYS];
  const width = DAYS * DAY_W;

  // Position by calendar day + fraction of that day, so a 23h/25h DST day still fills one column.
  const x = (ms: number) => {
    const clamped = Math.min(Math.max(ms, start), end);
    let i = dayStarts.findIndex((d, idx) => clamped >= d && clamped < (dayStarts[idx + 1] ?? Infinity));
    if (i === -1 || i >= DAYS) i = DAYS - 1;
    const span = dayStarts[i + 1] - dayStarts[i];
    return i * DAY_W + ((clamped - dayStarts[i]) / span) * DAY_W;
  };
  const xIso = (iso: string) => x(Date.parse(iso));

  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Open with "now" near the left edge.
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(now) - DAY_W * 0.6);
    // Only on first mount; don't fight the user's scrolling as time ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayIdx = dayStarts.findIndex((d) => d === localMidnight(now));
  const nowX = x(now);

  return (
    <div ref={scroller} className="overflow-x-auto">
      <div style={{ width: LABEL_W + width }} className="relative">
        {/* Day header */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-white">
          <div
            style={{ width: LABEL_W }}
            className="sticky left-0 z-30 flex shrink-0 items-end border-r border-line bg-white px-5 pb-8 text-[12px] font-bold uppercase tracking-wider text-mist"
          >
            Vehicle
          </div>
          <div className="relative flex" style={{ width }}>
            {dayStarts.slice(0, DAYS).map((d, i) => (
              <div
                key={d}
                style={{ width: DAY_W }}
                className={`border-l border-line-soft px-3 pt-3 pb-8 ${i === todayIdx ? "bg-peach/60" : ""}`}
              >
                <div className={`text-[11px] font-bold uppercase tracking-wider ${i === todayIdx ? "text-brand" : "text-mist"}`}>
                  {i === todayIdx ? "Today" : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d)}
                </div>
                <div className="h-display text-[15px]">
                  {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d)}
                </div>
              </div>
            ))}
            <div className="absolute bottom-1.5 z-10 -translate-x-1/2" style={{ left: nowX }}>
              <span className="block rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white shadow-[var(--shadow-brand)]">
                NOW {fmtTime(new Date(now).toISOString())}
              </span>
            </div>
          </div>
        </div>

        {/* Rows */}
        {cars.map((car) => {
          const entries = chains[car.id] ?? [];
          const lanes = assignLanes(entries);
          const laneCount = Math.max(1, ...Array.from(lanes.values(), (l) => l + 1));
          const height = ROW_PAD + laneCount * LANE_H + 12;
          const laneTop = (id: string) => ROW_PAD + (lanes.get(id) ?? 0) * LANE_H;

          return (
            <div key={car.id} className="flex border-b border-line-soft last:border-b-0">
              <div
                style={{ width: LABEL_W, height }}
                className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-white px-5"
              >
                <CarLabel car={car} />
              </div>
              <div className="relative" style={{ width, height }}>
                {/* Day grid */}
                {dayStarts.slice(0, DAYS).map((d, i) => (
                  <div
                    key={d}
                    className={`absolute inset-y-0 border-l border-line-soft ${i === todayIdx ? "bg-peach/30" : ""}`}
                    style={{ left: i * DAY_W, width: DAY_W }}
                  />
                ))}

                {/* Turnaround buffers, shaded after each (effective) return */}
                {entries.map(({ booking }) => {
                  const back = Date.parse(effectiveReturn(booking));
                  const bufEnd = back + car.turnaroundBufferHours * HOUR_MS;
                  if (bufEnd <= start || back >= end) return null;
                  const left = x(back);
                  const w = x(bufEnd) - left;
                  return (
                    <div
                      key={`buf-${booking.id}`}
                      className="hatch absolute rounded-r-md border-y border-r border-dashed border-slate/30"
                      style={{ left, width: w, top: laneTop(booking.id) + 4, height: LANE_H - 14 }}
                      title={`${car.turnaroundBufferHours}h turnaround after ${booking.renterName}`}
                    >
                      {w > 26 && (
                        <span className="absolute inset-0 grid place-items-center text-[10px] font-bold text-slate/80">
                          {car.turnaroundBufferHours}h
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Conflict zones */}
                {entries.map(({ booking, status, conflict }) => {
                  if (status === "ok" || !conflict?.carBackAt) return null;
                  const pickup = Date.parse(booking.pickupAt);
                  const back = Date.parse(conflict.carBackAt);
                  const [a, b] = status === "critical" ? [pickup, back] : [back, pickup];
                  const left = x(a);
                  const w = Math.max(3, x(b) - left);
                  return (
                    <div
                      key={`zone-${booking.id}`}
                      className={`absolute z-[5] rounded-sm ${status === "critical" ? "hatch-danger" : "hatch-warn"}`}
                      style={{ left, width: w, top: ROW_PAD - 2, bottom: 6 }}
                    />
                  );
                })}

                {/* Bookings */}
                {entries.map((entry) => (
                  <BookingBlock
                    key={entry.booking.id}
                    entry={entry}
                    now={now}
                    top={laneTop(entry.booking.id)}
                    xIso={xIso}
                    clipStart={start}
                    clipEnd={end}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Now line */}
        <div
          className="pointer-events-none absolute bottom-0 z-[15] w-0.5 bg-brand"
          style={{ left: LABEL_W + nowX - 1, top: 0 }}
        />
      </div>
    </div>
  );
}

function BookingBlock({
  entry,
  now,
  top,
  xIso,
  clipStart,
  clipEnd,
}: {
  entry: ChainEntry;
  now: number;
  top: number;
  xIso: (iso: string) => number;
  clipStart: number;
  clipEnd: number;
}) {
  const { booking, status, conflict } = entry;
  const eff = effectiveReturn(booking);
  if (Date.parse(eff) <= clipStart || Date.parse(booking.pickupAt) >= clipEnd) return null;

  const phase = bookingPhase(booking, now);
  const left = xIso(booking.pickupAt);
  const plannedRight = xIso(booking.returnAt);
  const right = xIso(eff);
  const late = lateByMinutes(booking);
  const stuck = booking.status === "needs-action";

  const base =
    phase === "active"
      ? "bg-brand text-white border-brand"
      : phase === "returned"
        ? "bg-sand text-slate border-line"
        : "bg-peach text-navy border-brand/40";
  const ring =
    status === "critical"
      ? "ring-2 ring-danger ring-offset-1"
      : status === "warning"
        ? "ring-2 ring-warn ring-offset-1"
        : "";

  return (
    <>
      <Link
        href={`/bookings?focus=${booking.id}`}
        className={`group absolute z-10 flex flex-col justify-center overflow-hidden rounded-[10px] border px-2.5 transition-shadow hover:shadow-[var(--shadow-card)] ${base} ${ring} ${
          stuck ? "border-dashed !border-danger" : ""
        }`}
        style={{ left, width: Math.max(18, (late > 0 ? plannedRight : right) - left), top: top + 2, height: LANE_H - 10 }}
        title={`${booking.renterName} · ${fmtWhen(booking.pickupAt)} → ${fmtWhen(booking.returnAt)}`}
      >
        <span className="truncate text-[12.5px] leading-tight font-bold">{booking.renterName}</span>
        <span className={`truncate text-[11px] leading-tight ${phase === "active" ? "text-white/85" : "text-slate"}`}>
          {fmtTime(booking.pickupAt)} → {fmtTime(booking.returnAt)}
        </span>
      </Link>

      {/* Late extension: planned return to actual return */}
      {late > 0 && (
        <div
          className="hatch-danger absolute z-10 flex items-center overflow-hidden rounded-r-[10px] border border-l-0 border-danger/60 px-1.5"
          style={{ left: plannedRight, width: Math.max(4, right - plannedRight), top: top + 2, height: LANE_H - 10 }}
          title={`Returned ${fmtDuration(late)} late (${fmtWhen(eff)})`}
        >
          <span className="truncate text-[10.5px] font-bold text-danger-ink">+{fmtDuration(late)} late</span>
        </div>
      )}

      {/* Inline alert badge */}
      {(status !== "ok" || stuck) && conflict && (
        <Link
          href={`/bookings?focus=${booking.id}`}
          className={`absolute z-20 flex -translate-y-1/2 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap shadow-sm ${
            status === "critical" ? "bg-danger text-white" : "bg-warn text-white"
          }`}
          style={{ left: left + 4, top: top + 1 }}
          title={conflict.kind}
        >
          {status === "critical" ? <AlertOctagon size={11} /> : <AlertTriangle size={11} />}
          {status === "critical"
            ? stuck
              ? "Needs action · car still out"
              : `Car still out until ${fmtTime(conflict.carBackAt!)}`
            : `Rushed: ${fmtDuration(conflict.bufferHours * 60 - conflict.shortByMinutes)} of ${conflict.bufferHours}h turnaround`}
        </Link>
      )}
    </>
  );
}

export function TimelineLegend() {
  const item = (swatch: string, label: string) => (
    <span className="flex items-center gap-2">
      <span className={`inline-block h-3 w-5 rounded ${swatch}`} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-slate">
      {item("bg-peach border border-brand/40", "Booked")}
      {item("bg-brand", "Out now")}
      {item("bg-sand border border-line", "Returned")}
      {item("hatch border border-dashed border-slate/30", "Turnaround buffer")}
      {item("hatch-warn", "Rushed turnaround")}
      {item("hatch-danger", "Impossible / late")}
    </div>
  );
}
