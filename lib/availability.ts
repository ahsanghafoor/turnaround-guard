// Availability engine: pure functions, no I/O, no clock reads, no timezone logic.
// Inputs and outputs are UTC ISO strings; callers format for display.

import type { Booking, Car } from "./types";

export const HOUR_MS = 3_600_000;
export const SLOT_STEP_MS = 30 * 60_000;
export const SLOT_HORIZON_MS = 7 * 24 * HOUR_MS;

export type Severity = "warning" | "critical";
export type ChainStatus = "ok" | Severity;

export interface Interval {
  pickupAt: string;
  returnAt: string;
}

/** A booking being checked: a saved booking, or a draft from the new-booking form. */
export type BookingDraft = Pick<Booking, "carId" | "pickupAt" | "returnAt"> &
  Partial<Pick<Booking, "id" | "actualReturnAt">>;

export type ConflictKind =
  /** Return is not after pickup. */
  | "invalid-window"
  /** CRITICAL: pickup is before an earlier booking's return. The car is still out. */
  | "car-still-out"
  /** CRITICAL: this return is after a later booking's pickup. The next renter has no car. */
  | "overruns-next"
  /** WARNING: car is back, but pickup falls inside the turnaround buffer. */
  | "rushed-pickup"
  /** WARNING: return leaves less than the turnaround buffer before the next pickup. */
  | "rushed-handoff";

export interface Conflict {
  kind: ConflictKind;
  severity: Severity;
  /** The booking this one clashes with (null for invalid-window). */
  other: Booking | null;
  bufferHours: number;
  /** Previous side: when the car is back from `other` (actual return if set, else planned). */
  carBackAt: string | null;
  /** Previous side: carBackAt + buffer. */
  earliestPickup: string | null;
  /** Next side: other's pickup. */
  nextPickupAt: string | null;
  /** Next side: nextPickupAt - buffer. */
  latestReturn: string | null;
  /** How many minutes the booking must shift to clear this conflict. */
  shortByMinutes: number;
}

export type CheckResult =
  | { ok: true; severity: null; conflicts: [] }
  | { ok: false; severity: Severity; conflicts: Conflict[] };

export interface ChainEntry {
  booking: Booking;
  status: ChainStatus;
  /** Why this booking is not ok, measured against the earlier booking that holds the car longest. */
  conflict: Conflict | null;
}

export type Alternatives =
  | { kind: "cars"; cars: Car[] }
  | { kind: "slot"; carId: string; pickupAt: string; returnAt: string }
  | { kind: "none" };

export type Resolution =
  | { action: "none" }
  | { action: "reassign"; cars: Car[] }
  | { action: "needs-action"; slot: Interval | null };

// ---------------------------------------------------------------------------
// Primitives

const ms = (iso: string) => Date.parse(iso);
const toIso = (n: number) => new Date(n).toISOString();
const toMinutes = (n: number) => Math.round(n / 60_000);

const byPickup = (a: Booking, b: Booking) =>
  ms(a.pickupAt) - ms(b.pickupAt) || a.id.localeCompare(b.id);

/** When the car is actually back: the recorded actual return if set, else the planned return. */
export function effectiveReturn(b: Pick<Booking, "returnAt"> & { actualReturnAt?: string | null }): string {
  return b.actualReturnAt ?? b.returnAt;
}

/** Standard interval overlap. Touching endpoints (a returns exactly when b picks up) is not an overlap. */
export function hasOverlap(a: Interval, b: Interval): boolean {
  return ms(a.pickupAt) < ms(b.returnAt) && ms(b.pickupAt) < ms(a.returnAt);
}

/** Bookings that occupy a car: same car, not cancelled, excluding the booking being checked. */
export function carBookings(carId: string, bookings: Booking[], excludeId?: string): Booking[] {
  return bookings
    .filter((b) => b.carId === carId && b.status !== "cancelled" && b.id !== excludeId)
    .sort(byPickup);
}

function emptyConflict(kind: ConflictKind, severity: Severity, bufferHours: number): Conflict {
  return {
    kind,
    severity,
    other: null,
    bufferHours,
    carBackAt: null,
    earliestPickup: null,
    nextPickupAt: null,
    latestReturn: null,
    shortByMinutes: 0,
  };
}

function previousSideConflict(pickup: number, other: Booking, bufferHours: number): Conflict | null {
  const back = ms(effectiveReturn(other));
  const earliest = back + bufferHours * HOUR_MS;
  // Physical possibility first: is the car even back?
  const kind: ConflictKind | null =
    pickup < back ? "car-still-out" : pickup < earliest ? "rushed-pickup" : null;
  if (!kind) return null;
  return {
    ...emptyConflict(kind, kind === "car-still-out" ? "critical" : "warning", bufferHours),
    other,
    carBackAt: toIso(back),
    earliestPickup: toIso(earliest),
    shortByMinutes: toMinutes(earliest - pickup),
  };
}

function nextSideConflict(ret: number, other: Booking, bufferHours: number): Conflict | null {
  const next = ms(other.pickupAt);
  const latest = next - bufferHours * HOUR_MS;
  const kind: ConflictKind | null =
    ret > next ? "overruns-next" : ret > latest ? "rushed-handoff" : null;
  if (!kind) return null;
  return {
    ...emptyConflict(kind, kind === "overruns-next" ? "critical" : "warning", bufferHours),
    other,
    nextPickupAt: toIso(next),
    latestReturn: toIso(latest),
    shortByMinutes: toMinutes(ret - latest),
  };
}

// ---------------------------------------------------------------------------
// checkBooking

/**
 * Valid only if there is no overlap AND pickup >= previous return + buffer
 * AND return + buffer <= next pickup. The buffer comes from `car`.
 * Every clashing booking on the car is reported; criticals sort first.
 */
export function checkBooking(draft: BookingDraft, existing: Booking[], car: Car): CheckResult {
  const buffer = car.turnaroundBufferHours;
  const pickup = ms(draft.pickupAt);
  const ret = ms(effectiveReturn(draft));

  if (!(ret > pickup)) {
    return { ok: false, severity: "critical", conflicts: [emptyConflict("invalid-window", "critical", buffer)] };
  }

  const conflicts: Conflict[] = [];
  for (const other of carBookings(car.id, existing, draft.id)) {
    // An existing booking that picks up no later than this one is "previous"; otherwise "next".
    const conflict =
      ms(other.pickupAt) <= pickup
        ? previousSideConflict(pickup, other, buffer)
        : nextSideConflict(ret, other, buffer);
    if (conflict) conflicts.push(conflict);
  }

  if (conflicts.length === 0) return { ok: true, severity: null, conflicts: [] };
  conflicts.sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));
  return { ok: false, severity: conflicts[0].severity, conflicts };
}

// ---------------------------------------------------------------------------
// Chain analysis and the late-return re-check

/**
 * Walks a car's bookings in pickup order. The car is free once the latest effective
 * return so far has passed, so a late return keeps blocking every later booking it
 * runs past, not just the immediate next one. Each booking is classified against that.
 */
export function analyzeCarChain(car: Car, bookings: Booking[]): ChainEntry[] {
  let blocker: Booking | null = null;
  let freeAt = -Infinity;

  return carBookings(car.id, bookings).map((booking) => {
    const conflict = blocker ? previousSideConflict(ms(booking.pickupAt), blocker, car.turnaroundBufferHours) : null;
    const back = ms(effectiveReturn(booking));
    if (back > freeAt) {
      freeAt = back;
      blocker = booking;
    }
    return { booking, status: conflict?.severity ?? "ok", conflict };
  });
}

export function analyzeFleet(cars: Car[], bookings: Booking[]): Record<string, ChainEntry[]> {
  return Object.fromEntries(cars.map((car) => [car.id, analyzeCarChain(car, bookings)]));
}

/**
 * After `bookingId` has an actualReturnAt, re-run the engine over the same car's later
 * bookings. `bookings` must already contain the actual return.
 */
export function recheckAfterLateReturn(bookings: Booking[], car: Car, bookingId: string): ChainEntry[] {
  const late = bookings.find((b) => b.id === bookingId);
  if (!late) throw new Error(`Unknown booking ${bookingId}`);
  if (!late.actualReturnAt) throw new Error(`Booking ${bookingId} has no actual return time`);
  return analyzeCarChain(car, bookings).filter(
    (e) => e.booking.id !== late.id && byPickup(e.booking, late) > 0,
  );
}

// ---------------------------------------------------------------------------
// Alternatives and resolution

/**
 * Same-class cars that take the booking's window with no overlap and no buffer violation.
 * If there are none, the nearest later slot on the requested car (30-minute steps, up to 7 days).
 */
export function findAlternatives(booking: BookingDraft, cars: Car[], bookings: Booking[]): Alternatives {
  const requested = cars.find((c) => c.id === booking.carId);
  if (!requested) throw new Error(`Unknown car ${booking.carId}`);

  const freeCars = cars.filter(
    (c) =>
      c.id !== requested.id &&
      c.class === requested.class &&
      checkBooking({ ...booking, carId: c.id }, bookings, c).ok,
  );
  if (freeCars.length > 0) return { kind: "cars", cars: freeCars };

  const start = ms(booking.pickupAt);
  const duration = ms(booking.returnAt) - start;
  for (let offset = SLOT_STEP_MS; offset <= SLOT_HORIZON_MS; offset += SLOT_STEP_MS) {
    const candidate = {
      id: booking.id,
      carId: requested.id,
      pickupAt: toIso(start + offset),
      returnAt: toIso(start + offset + duration),
    };
    if (checkBooking(candidate, bookings, requested).ok) {
      return { kind: "slot", carId: requested.id, pickupAt: candidate.pickupAt, returnAt: candidate.returnAt };
    }
  }
  return { kind: "none" };
}

/**
 * What the operator can do about a booking. Nothing here changes data: a critical booking
 * is offered a reassign (operator picks the car), or, if no same-class car is free, it is
 * needs-action, with the nearest later slot on its own car suggested if one exists.
 */
export function planResolution(booking: Booking, cars: Car[], bookings: Booking[]): Resolution {
  const car = cars.find((c) => c.id === booking.carId);
  if (!car) return { action: "needs-action", slot: null };
  const entry = analyzeCarChain(car, bookings).find((e) => e.booking.id === booking.id);
  if (entry?.status !== "critical") return { action: "none" };

  const alt = findAlternatives(booking, cars, bookings);
  if (alt.kind === "cars") return { action: "reassign", cars: alt.cars };
  return {
    action: "needs-action",
    slot: alt.kind === "slot" ? { pickupAt: alt.pickupAt, returnAt: alt.returnAt } : null,
  };
}

// ---------------------------------------------------------------------------
// State transitions (pure: take bookings, return new bookings)

const OPEN_STATUSES = new Set(["confirmed", "needs-action"]);

/**
 * Brings statuses in line with the engine: a critical booking with no free same-class car
 * becomes "needs-action"; a needs-action booking that is no longer stuck goes back to
 * "confirmed". Never touches carId or times.
 */
export function reconcileStatuses(bookings: Booking[], cars: Car[]): Booking[] {
  return bookings.map((b) => {
    if (!OPEN_STATUSES.has(b.status)) return b;
    const stuck = planResolution(b, cars, bookings).action === "needs-action";
    const status = stuck ? "needs-action" : "confirmed";
    return status === b.status ? b : { ...b, status };
  });
}

export function markReturnedLate(
  bookings: Booking[],
  cars: Car[],
  bookingId: string,
  actualReturnAt: string,
  now: string,
): { bookings: Booking[]; downstream: ChainEntry[] } {
  const target = bookings.find((b) => b.id === bookingId);
  if (!target) throw new Error(`Unknown booking ${bookingId}`);
  if (!(ms(actualReturnAt) > ms(target.pickupAt))) throw new Error("Actual return must be after pickup");
  const car = cars.find((c) => c.id === target.carId);
  if (!car) throw new Error(`Unknown car ${target.carId}`);

  const returned = ms(actualReturnAt) <= ms(now);
  const updated = bookings.map((b) =>
    b.id === bookingId ? { ...b, actualReturnAt, status: returned ? ("completed" as const) : b.status } : b,
  );
  const next = reconcileStatuses(updated, cars);
  return { bookings: next, downstream: recheckAfterLateReturn(next, car, bookingId) };
}

/** Operator-chosen move to another car. Refuses anything the engine would not accept. */
export function reassignBooking(bookings: Booking[], cars: Car[], bookingId: string, newCarId: string): Booking[] {
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) throw new Error(`Unknown booking ${bookingId}`);
  const from = cars.find((c) => c.id === booking.carId);
  const to = cars.find((c) => c.id === newCarId);
  if (!to) throw new Error(`Unknown car ${newCarId}`);
  if (from && from.class !== to.class) throw new Error(`${to.name} is not a ${from.class}`);
  const check = checkBooking({ ...booking, carId: to.id }, bookings, to);
  if (!check.ok) throw new Error(`${to.name} is not free for this booking (${check.severity})`);

  const moved = bookings.map((b) => (b.id === bookingId ? { ...b, carId: to.id, status: "confirmed" as const } : b));
  return reconcileStatuses(moved, cars);
}

/** Operator-chosen move to a different window on the same car. */
export function rescheduleBooking(
  bookings: Booking[],
  cars: Car[],
  bookingId: string,
  window: Interval,
): Booking[] {
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) throw new Error(`Unknown booking ${bookingId}`);
  const car = cars.find((c) => c.id === booking.carId);
  if (!car) throw new Error(`Unknown car ${booking.carId}`);
  const check = checkBooking({ ...booking, ...window }, bookings, car);
  if (!check.ok) throw new Error(`That window is not free on ${car.name} (${check.severity})`);

  const moved = bookings.map((b) => (b.id === bookingId ? { ...b, ...window, status: "confirmed" as const } : b));
  return reconcileStatuses(moved, cars);
}

/** Operator-chosen cancellation. Frees the car; anything it was blocking is re-reconciled. */
export function cancelBooking(bookings: Booking[], cars: Car[], bookingId: string): Booking[] {
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) throw new Error(`Unknown booking ${bookingId}`);
  if (!OPEN_STATUSES.has(booking.status)) throw new Error(`A ${booking.status} booking can't be cancelled`);
  const cancelled = bookings.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" as const } : b));
  return reconcileStatuses(cancelled, cars);
}

// ---------------------------------------------------------------------------
// Plain-word explanations. The caller supplies `fmt` so formatting happens in the
// viewer's timezone (client side); the engine never formats dates itself.

export function explainConflict(c: Conflict, fmt: (iso: string) => string): string {
  const who = c.other ? `${c.other.renterName}'s booking` : "The other booking";
  switch (c.kind) {
    case "invalid-window":
      return "Return must be after pickup.";
    case "car-still-out":
      return `Car is still out: ${who} returns ${fmt(c.carBackAt!)}, after this pickup. This car needs ${c.bufferHours}h turnaround, earliest pickup ${fmt(c.earliestPickup!)}.`;
    case "rushed-pickup":
      return `Previous booking returns ${fmt(c.carBackAt!)}, this car needs ${c.bufferHours}h turnaround, earliest pickup ${fmt(c.earliestPickup!)}.`;
    case "overruns-next":
      return `Next renter is left without a car: ${who} picks up ${fmt(c.nextPickupAt!)}, before this return. This car needs ${c.bufferHours}h turnaround, latest return ${fmt(c.latestReturn!)}.`;
    case "rushed-handoff":
      return `Next booking picks up ${fmt(c.nextPickupAt!)}, this car needs ${c.bufferHours}h turnaround, latest return ${fmt(c.latestReturn!)}.`;
  }
}
