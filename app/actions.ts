"use server";

// Thin wrappers: validate input, run the pure engine transition, persist, refresh the router.
// No auth by design (local demo tool).

import { refresh } from "next/cache";
import {
  cancelBooking,
  checkBooking,
  markReturnedLate,
  reassignBooking,
  reconcileStatuses,
  rescheduleBooking,
  type ChainEntry,
} from "@/lib/availability";
import { buildSeedBookings, hourAnchor, seedCars } from "@/lib/seed";
import { updateFleet } from "@/lib/store";
import type { Booking } from "@/lib/types";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const asIso = (v: string) => new Date(v).toISOString();

/** Bookings can't start in the past. One minute of grace: the form works at minute precision. */
function assertNotPast(pickupAt: string) {
  if (Date.parse(pickupAt) < Math.floor(Date.now() / 60_000) * 60_000) {
    throw new Error("Pickup can't be in the past");
  }
}

async function run<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const result = await fn();
    refresh();
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function createBookingAction(input: {
  carId: string;
  renterName: string;
  pickupAt: string;
  returnAt: string;
  allowRushed: boolean;
}): Promise<ActionResult<{ id: string }>> {
  return run(() =>
    updateFleet(({ cars, bookings }) => {
      const renterName = input.renterName?.trim();
      if (!renterName) throw new Error("Renter name is required");
      if (!isIso(input.pickupAt) || !isIso(input.returnAt)) throw new Error("Pickup and return times are required");
      assertNotPast(input.pickupAt);
      const car = cars.find((c) => c.id === input.carId);
      if (!car) throw new Error("Pick a car");

      const draft = { carId: car.id, pickupAt: asIso(input.pickupAt), returnAt: asIso(input.returnAt) };
      const check = checkBooking(draft, bookings, car);
      if (check.severity === "critical") throw new Error(`${car.name} can't take this booking`);
      if (check.severity === "warning" && !input.allowRushed) {
        throw new Error("This booking leaves a rushed turnaround. Confirm to book anyway.");
      }

      const id = `bk-${Date.now().toString(36)}`;
      const booking: Booking = { id, renterName, ...draft, actualReturnAt: null, status: "confirmed" };
      return { bookings: reconcileStatuses([...bookings, booking], cars), result: { id } };
    }),
  );
}

export async function markReturnedLateAction(
  bookingId: string,
  actualReturnAt: string,
): Promise<ActionResult<{ downstream: ChainEntry[] }>> {
  return run(() =>
    updateFleet(({ cars, bookings }) => {
      if (!isIso(actualReturnAt)) throw new Error("Enter the actual return time");
      const target = bookings.find((b) => b.id === bookingId);
      if (!target) throw new Error("Booking not found");
      if (Date.parse(actualReturnAt) <= Date.parse(target.returnAt)) {
        throw new Error("A late return must be after the planned return");
      }
      const next = markReturnedLate(bookings, cars, bookingId, asIso(actualReturnAt), new Date().toISOString());
      return { bookings: next.bookings, result: { downstream: next.downstream } };
    }),
  );
}

export async function reassignAction(bookingId: string, carId: string): Promise<ActionResult> {
  return run(() =>
    updateFleet(({ cars, bookings }) => ({ bookings: reassignBooking(bookings, cars, bookingId, carId), result: {} })),
  );
}

export async function rescheduleAction(bookingId: string, pickupAt: string, returnAt: string): Promise<ActionResult> {
  return run(() =>
    updateFleet(({ cars, bookings }) => {
      if (!isIso(pickupAt) || !isIso(returnAt)) throw new Error("Enter a new pickup and return time");
      assertNotPast(pickupAt);
      const window = { pickupAt: asIso(pickupAt), returnAt: asIso(returnAt) };
      return { bookings: rescheduleBooking(bookings, cars, bookingId, window), result: {} };
    }),
  );
}

export async function cancelBookingAction(bookingId: string): Promise<ActionResult> {
  return run(() =>
    updateFleet(({ cars, bookings }) => ({ bookings: cancelBooking(bookings, cars, bookingId), result: {} })),
  );
}

/** Restores the demo fleet, re-anchored to the current hour. */
export async function resetDemoAction(): Promise<ActionResult> {
  return run(() =>
    updateFleet(() => ({ cars: seedCars, bookings: buildSeedBookings(hourAnchor(Date.now())), result: {} })),
  );
}
