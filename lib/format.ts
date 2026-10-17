// Display helpers. Import these ONLY from client components: they format in the browser's
// timezone and locale, which the server doesn't know. Hooks return null during SSR so the
// server HTML and the first client render match (no hydration mismatch).

import { useSyncExternalStore } from "react";
import { effectiveReturn } from "./availability";
import type { Booking } from "./types";

const noopSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const MINUTE = 60_000;
function subscribeMinute(cb: () => void) {
  const id = setInterval(cb, 15_000);
  return () => clearInterval(id);
}

/** Current time floored to the minute, ticking; null on the server. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / MINUTE) * MINUTE,
    () => null,
  );
}

const timeFmt = () => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFmt = () => new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayFmt = () => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "8:00 PM" */
export const fmtTime = (iso: string) => timeFmt().format(new Date(iso));
/** "Sat 8:00 PM" */
export const fmtWhen = (iso: string) => `${weekdayFmt().format(new Date(iso))} ${fmtTime(iso)}`;
/** "Sat, Oct 17" */
export const fmtDay = (iso: string | number) => dayFmt().format(new Date(iso));
/** "Sat, Oct 17 · 8:00 PM" */
export const fmtDateTime = (iso: string) => `${fmtDay(iso)} · ${fmtTime(iso)}`;

/** Short name of the viewer's timezone, e.g. "GMT+5" or "PDT". */
export function tzLabel(): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function fmtDuration(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC ISO -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | number): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) -> UTC ISO, or null if empty/invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type Phase = "upcoming" | "active" | "overdue" | "returned" | "cancelled";

/** Where a booking is in its life, relative to now. */
export function bookingPhase(b: Booking, now: number): Phase {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "completed") return "returned";
  if (Date.parse(b.pickupAt) > now) return "upcoming";
  if (Date.parse(effectiveReturn(b)) > now) return "active";
  return b.actualReturnAt ? "returned" : "overdue";
}

export function lateByMinutes(b: Booking): number {
  return b.actualReturnAt ? (Date.parse(b.actualReturnAt) - Date.parse(b.returnAt)) / MINUTE : 0;
}
