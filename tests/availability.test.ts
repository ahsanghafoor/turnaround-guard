import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeCarChain,
  analyzeFleet,
  cancelBooking,
  checkBooking,
  explainConflict,
  findAlternatives,
  hasOverlap,
  markReturnedLate,
  planResolution,
  reassignBooking,
  recheckAfterLateReturn,
  reconcileStatuses,
  rescheduleBooking,
} from "../lib/availability";
import { buildSeedBookings, seedCars } from "../lib/seed";
import type { Booking, Car } from "../lib/types";

// Fixtures: hours relative to a fixed UTC anchor, so results never depend on the clock.
const T0 = Date.parse("2026-10-18T00:00:00.000Z");
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();

const sedan4: Car = { id: "s4", name: "Sedan 4h", class: "sedan", turnaroundBufferHours: 4 };
const sedan4b: Car = { id: "s4b", name: "Sedan 4h B", class: "sedan", turnaroundBufferHours: 4 };
const sedan8: Car = { id: "s8", name: "Sedan 8h", class: "sedan", turnaroundBufferHours: 8 };
const suv6: Car = { id: "u6", name: "SUV 6h", class: "SUV", turnaroundBufferHours: 6 };

function bk(id: string, carId: string, pickup: number, ret: number, extra: Partial<Booking> = {}): Booking {
  return {
    id,
    carId,
    renterName: `Renter ${id}`,
    pickupAt: at(pickup),
    returnAt: at(ret),
    actualReturnAt: null,
    status: "confirmed",
    ...extra,
  };
}

const draft = (carId: string, pickup: number, ret: number) => ({ carId, pickupAt: at(pickup), returnAt: at(ret) });

// 12-hour clock in UTC, "8:00pm" style, to mirror what the UI shows in local time.
const fmtUtc = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" })
    .format(new Date(iso))
    .replace(/\s?(AM|PM)$/, (_, p: string) => p.toLowerCase());

describe("hasOverlap", () => {
  const a = { pickupAt: at(0), returnAt: at(10) };
  test("disjoint intervals do not overlap", () => {
    assert.equal(hasOverlap(a, { pickupAt: at(12), returnAt: at(20) }), false);
  });
  test("touching endpoints (return == next pickup) do not overlap", () => {
    assert.equal(hasOverlap(a, { pickupAt: at(10), returnAt: at(20) }), false);
  });
  test("partial overlap overlaps, in both argument orders", () => {
    const b = { pickupAt: at(9), returnAt: at(20) };
    assert.equal(hasOverlap(a, b), true);
    assert.equal(hasOverlap(b, a), true);
  });
  test("containment overlaps", () => {
    assert.equal(hasOverlap(a, { pickupAt: at(2), returnAt: at(3) }), true);
  });
});

describe("checkBooking", () => {
  // Previous booking returns 20:00 on day 0; next booking picks up 10:00 on day 2 (h=34).
  const existing = [bk("prev", "s4", 8, 20), bk("next", "s4", 34, 40)];

  test("clean gap on both sides is ok", () => {
    assert.deepEqual(checkBooking(draft("s4", 25, 28), existing, sedan4), { ok: true, severity: null, conflicts: [] });
  });

  test("tight but valid: pickup exactly at return + buffer, return exactly at next pickup - buffer", () => {
    assert.equal(checkBooking(draft("s4", 24, 30), existing, sedan4).ok, true);
  });

  test("WARNING rushed-pickup: car is back, pickup 1 minute inside the buffer", () => {
    const r = checkBooking({ carId: "s4", pickupAt: at(24 - 1 / 60), returnAt: at(28) }, existing, sedan4);
    assert.equal(r.ok, false);
    assert.equal(r.severity, "warning");
    assert.equal(r.conflicts[0].kind, "rushed-pickup");
    assert.equal(r.conflicts[0].earliestPickup, at(24));
    assert.equal(r.conflicts[0].shortByMinutes, 1);
  });

  test("WARNING (not critical) when pickup is exactly at the previous return", () => {
    const r = checkBooking(draft("s4", 20, 28), existing, sedan4);
    assert.equal(r.severity, "warning");
    assert.equal(r.conflicts[0].kind, "rushed-pickup");
  });

  test("CRITICAL car-still-out: pickup before the previous return; physical check wins over buffer", () => {
    const r = checkBooking(draft("s4", 19, 28), existing, sedan4);
    assert.equal(r.severity, "critical");
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.conflicts[0].kind, "car-still-out");
    assert.equal(r.conflicts[0].other?.id, "prev");
    assert.equal(r.conflicts[0].carBackAt, at(20));
  });

  test("WARNING rushed-handoff: return + buffer runs past the next pickup", () => {
    const r = checkBooking(draft("s4", 25, 31), existing, sedan4);
    assert.equal(r.severity, "warning");
    assert.equal(r.conflicts[0].kind, "rushed-handoff");
    assert.equal(r.conflicts[0].latestReturn, at(30));
  });

  test("CRITICAL overruns-next: return after the next booking's pickup", () => {
    const r = checkBooking(draft("s4", 25, 35), existing, sedan4);
    assert.equal(r.severity, "critical");
    assert.equal(r.conflicts[0].kind, "overruns-next");
  });

  test("CRITICAL when the new booking swallows an existing one", () => {
    const r = checkBooking(draft("s4", 6, 22), existing, sedan4);
    assert.equal(r.severity, "critical");
  });

  test("reports both sides, critical first, overall severity critical", () => {
    const r = checkBooking(draft("s4", 22, 35), existing, sedan4);
    assert.deepEqual(
      r.conflicts.map((c) => [c.kind, c.severity]),
      [
        ["overruns-next", "critical"],
        ["rushed-pickup", "warning"],
      ],
    );
    assert.equal(r.severity, "critical");
  });

  test("buffer comes from the car: same window ok on a 4h car, warning on an 8h car", () => {
    const window = draft("x", 25, 28);
    assert.equal(checkBooking({ ...window, carId: "s4" }, existing, sedan4).ok, true);
    const on8 = checkBooking({ ...window, carId: "s8" }, existing.map((b) => ({ ...b, carId: "s8" })), sedan8);
    assert.equal(on8.severity, "warning");
    assert.equal(on8.conflicts[0].earliestPickup, at(28));
  });

  test("ignores cancelled bookings, other cars' bookings, and the booking itself", () => {
    const noise = [
      bk("cancelled", "s4", 22, 26, { status: "cancelled" }),
      bk("othercar", "s4b", 22, 26),
      bk("self", "s4", 22, 26),
    ];
    assert.equal(checkBooking({ ...draft("s4", 25, 28), id: "self" }, [...existing, ...noise], sedan4).ok, true);
  });

  test("uses the previous booking's actual return when set", () => {
    const late = [bk("prev", "s4", 8, 20, { actualReturnAt: at(26) })];
    const r = checkBooking(draft("s4", 25, 28), late, sedan4);
    assert.equal(r.conflicts[0].kind, "car-still-out");
    assert.equal(r.conflicts[0].carBackAt, at(26));
  });

  test("return not after pickup is rejected", () => {
    assert.equal(checkBooking(draft("s4", 28, 28), [], sedan4).conflicts[0].kind, "invalid-window");
  });

  test("plain-word explanation matches the operator wording", () => {
    const r = checkBooking(draft("s4", 22, 23), [bk("prev", "s4", 8, 20)], sedan4);
    assert.equal(
      explainConflict(r.conflicts[0], fmtUtc),
      "Previous booking returns 8:00pm, this car needs 4h turnaround, earliest pickup 12:00am.",
    );
  });
});

describe("late-return re-check (cascading)", () => {
  // A 0-10, B 14-20, C 26-40 on a 4h car. All clean on plan.
  const plan = [bk("A", "s4", 0, 10), bk("B", "s4", 14, 20), bk("C", "s4", 26, 40)];
  const lateA = (h: number) => plan.map((b) => (b.id === "A" ? { ...b, actualReturnAt: at(h) } : b));
  const statuses = (entries: ReturnType<typeof recheckAfterLateReturn>) =>
    Object.fromEntries(entries.map((e) => [e.booking.id, e.status]));

  test("on plan, every booking is ok", () => {
    assert.deepEqual(analyzeCarChain(sedan4, plan).map((e) => e.status), ["ok", "ok", "ok"]);
  });
  test("A 2h late: B rushed (warning), C ok", () => {
    assert.deepEqual(statuses(recheckAfterLateReturn(lateA(12), sedan4, "A")), { B: "warning", C: "ok" });
  });
  test("A 5h late: B critical (car still out), C ok against B's planned return", () => {
    const r = recheckAfterLateReturn(lateA(15), sedan4, "A");
    assert.deepEqual(statuses(r), { B: "critical", C: "ok" });
    assert.equal(r[0].conflict?.other?.id, "A");
  });
  test("A 13h late: blows past B entirely, C is now rushed against A's actual return", () => {
    const r = recheckAfterLateReturn(lateA(23), sedan4, "A");
    assert.deepEqual(statuses(r), { B: "critical", C: "warning" });
    assert.equal(r[1].conflict?.other?.id, "A");
    assert.equal(r[1].conflict?.earliestPickup, at(27));
  });
  test("A 20h late: B and C both critical", () => {
    assert.deepEqual(statuses(recheckAfterLateReturn(lateA(30), sedan4, "A")), { B: "critical", C: "critical" });
  });
  test("a downstream actual return also cascades (B late, A on time: C checked against B's actual)", () => {
    const chain = plan.map((b) => (b.id === "B" ? { ...b, actualReturnAt: at(24) } : b));
    const r = recheckAfterLateReturn(chain, sedan4, "B");
    assert.deepEqual(statuses(r), { C: "warning" });
    assert.equal(r[0].conflict?.carBackAt, at(24));
  });
  test("only later bookings are re-checked", () => {
    const chain = plan.map((b) => (b.id === "B" ? { ...b, actualReturnAt: at(21) } : b));
    assert.deepEqual(Object.keys(statuses(recheckAfterLateReturn(chain, sedan4, "B"))), ["C"]);
  });
});

describe("findAlternatives", () => {
  const cars = [sedan4, sedan4b, sedan8, suv6];

  test("offers same-class cars that are clean for the window; never another class", () => {
    const bookings = [bk("busy", "s4", 0, 30)];
    const alt = findAlternatives(draft("s4", 20, 26), cars, bookings);
    assert.equal(alt.kind, "cars");
    assert.deepEqual(alt.kind === "cars" && alt.cars.map((c) => c.id), ["s4b", "s8"]);
  });

  test("excludes a same-class car that would only be a rushed (warning) turnaround", () => {
    const bookings = [bk("busy", "s4", 0, 30), bk("tight", "s4b", 0, 18), bk("block", "s8", 21, 40)];
    // s4b back at 18 -> earliest 22 > 20: warning, excluded. s8 overlaps: excluded.
    const alt = findAlternatives(draft("s4", 20, 26), cars, bookings);
    assert.notEqual(alt.kind, "cars");
  });

  test("no same-class car free: nearest later 30-minute slot on the requested car", () => {
    const bookings = [bk("busy", "s4", 0, 21.25), bk("b2", "s4b", 0, 60), bk("b3", "s8", 0, 60)];
    const alt = findAlternatives(draft("s4", 20, 26), cars, bookings);
    // Back 21:15, +4h = 25:15 -> first 30-min step at or after is 25:30.
    assert.deepEqual(alt, { kind: "slot", carId: "s4", pickupAt: at(25.5), returnAt: at(31.5) });
    assert.equal(checkBooking({ carId: "s4", pickupAt: at(25.5), returnAt: at(31.5) }, bookings, sedan4).ok, true);
  });

  test("slot also respects the next booking's buffer (skips gaps that are too short)", () => {
    const bookings = [
      bk("busy", "s4", 0, 21),
      bk("next", "s4", 33, 50), // gap 25..29 is too short for a 6h rental + buffers
      bk("b2", "s4b", 0, 200),
      bk("b3", "s8", 0, 200),
    ];
    const alt = findAlternatives(draft("s4", 20, 26), cars, bookings);
    assert.deepEqual(alt, { kind: "slot", carId: "s4", pickupAt: at(54), returnAt: at(60) });
  });

  test("nothing within 7 days: none", () => {
    const wall = [bk("w1", "s4", 0, 400), bk("w2", "s4b", 0, 400), bk("w3", "s8", 0, 400)];
    assert.deepEqual(findAlternatives(draft("s4", 20, 26), cars, wall), { kind: "none" });
  });
});

describe("resolution: operator-driven, never automatic", () => {
  const cars = [sedan4, sedan4b, suv6];

  test("late return making B critical offers reassign; markReturnedLate changes no car assignment", () => {
    const bookings = [bk("A", "s4", 0, 10), bk("B", "s4", 14, 20)];
    const { bookings: after, downstream } = markReturnedLate(bookings, cars, "A", at(16), at(17));
    assert.deepEqual(downstream.map((e) => [e.booking.id, e.status]), [["B", "critical"]]);
    assert.deepEqual(after.map((b) => b.carId), ["s4", "s4"]);
    assert.equal(after.find((b) => b.id === "A")?.status, "completed");
    assert.equal(after.find((b) => b.id === "B")?.status, "confirmed");
    const plan = planResolution(after.find((b) => b.id === "B")!, cars, after);
    assert.equal(plan.action, "reassign");
    assert.deepEqual(plan.action === "reassign" && plan.cars.map((c) => c.id), ["s4b"]);
  });

  test("operator reassigns: booking moves, conflict clears on both cars", () => {
    const bookings = markReturnedLate([bk("A", "s4", 0, 10), bk("B", "s4", 14, 20)], cars, "A", at(16), at(17)).bookings;
    const moved = reassignBooking(bookings, cars, "B", "s4b");
    assert.equal(moved.find((b) => b.id === "B")?.carId, "s4b");
    const fleet = analyzeFleet(cars, moved);
    assert.ok(Object.values(fleet).flat().every((e) => e.status === "ok"));
  });

  test("reassign refuses a busy car and a different class", () => {
    const bookings = [bk("A", "s4", 0, 10, { actualReturnAt: at(16) }), bk("B", "s4", 14, 20), bk("X", "s4b", 12, 30)];
    assert.throws(() => reassignBooking(bookings, cars, "B", "s4b"), /not free/);
    assert.throws(() => reassignBooking(bookings, cars, "B", "u6"), /not a sedan/);
  });

  test("no alternative car: booking becomes needs-action and stays on its car", () => {
    const bookings = [bk("A", "s4", 0, 10), bk("B", "s4", 14, 20), bk("X", "s4b", 12, 30)];
    const { bookings: after } = markReturnedLate(bookings, cars, "A", at(16), at(17));
    const b = after.find((x) => x.id === "B")!;
    assert.equal(b.status, "needs-action");
    assert.equal(b.carId, "s4");
    const plan = planResolution(b, cars, after);
    assert.equal(plan.action, "needs-action");
    assert.deepEqual(plan.action === "needs-action" && plan.slot, { pickupAt: at(20), returnAt: at(26) });
  });

  test("rescheduling a needs-action booking into the suggested slot clears it", () => {
    const bookings = [bk("A", "s4", 0, 10), bk("B", "s4", 14, 20), bk("X", "s4b", 12, 30)];
    const stuck = markReturnedLate(bookings, cars, "A", at(16), at(17)).bookings;
    const fixed = rescheduleBooking(stuck, cars, "B", { pickupAt: at(20), returnAt: at(26) });
    assert.equal(fixed.find((b) => b.id === "B")?.status, "confirmed");
    assert.ok(analyzeCarChain(sedan4, fixed).every((e) => e.status === "ok"));
  });

  test("cancelling a stuck booking frees it; cancelling its blocker un-sticks it instead", () => {
    const bookings = [bk("A", "s4", 0, 10), bk("B", "s4", 14, 20), bk("X", "s4b", 12, 30)];
    const stuck = markReturnedLate(bookings, cars, "A", at(16), at(11)).bookings; // A still out, B needs-action
    assert.equal(stuck.find((b) => b.id === "B")?.status, "needs-action");

    const cancelB = cancelBooking(stuck, cars, "B");
    assert.equal(cancelB.find((b) => b.id === "B")?.status, "cancelled");
    assert.ok(analyzeCarChain(sedan4, cancelB).every((e) => e.status === "ok"));

    const cancelX = cancelBooking(stuck, cars, "X"); // s4b frees up -> B can be reassigned, so no longer stuck
    assert.equal(cancelX.find((b) => b.id === "B")?.status, "confirmed");
    assert.equal(planResolution(cancelX.find((b) => b.id === "B")!, cars, cancelX).action, "reassign");
  });

  test("completed or cancelled bookings can't be cancelled", () => {
    const bookings = [bk("A", "s4", 0, 10, { status: "completed" }), bk("C", "s4", 20, 30, { status: "cancelled" })];
    assert.throws(() => cancelBooking(bookings, cars, "A"), /completed/);
    assert.throws(() => cancelBooking(bookings, cars, "C"), /cancelled/);
  });

  test("actual return in the future keeps the booking open (not completed)", () => {
    const { bookings: after } = markReturnedLate([bk("A", "s4", 0, 10)], cars, "A", at(16), at(12));
    assert.equal(after[0].status, "confirmed");
    assert.equal(after[0].actualReturnAt, at(16));
  });
});

describe("seed scenarios", () => {
  const ANCHOR = Date.parse("2026-10-17T09:00:00.000Z");
  const h = (n: number) => new Date(ANCHOR + n * 3_600_000).toISOString();
  const bookings = buildSeedBookings(ANCHOR);
  const car = (id: string) => seedCars.find((c) => c.id === id)!;
  const entry = (bookingId: string) => {
    const b = bookings.find((x) => x.id === bookingId)!;
    return analyzeCarChain(car(b.carId), bookings).find((e) => e.booking.id === bookingId)!;
  };

  test("fleet: 3 sedans (4h, 4h, custom 8h) and 2 SUVs (6h)", () => {
    assert.deepEqual(
      seedCars.map((c) => [c.class, c.turnaroundBufferHours]),
      [["sedan", 4], ["sedan", 4], ["sedan", 8], ["SUV", 6], ["SUV", 6]],
    );
  });

  test("bookings fall within the next 7 days (plus history and the active rental)", () => {
    assert.equal(bookings.length, 11);
    assert.ok(bookings.every((b) => Date.parse(b.pickupAt) < ANCHOR + 7 * 24 * 3_600_000));
  });

  test("tight but valid: Camry handoff is exactly the 4h buffer and is ok", () => {
    assert.equal(Date.parse(bookings.find((b) => b.id === "bk-1002")!.pickupAt) - Date.parse(bookings.find((b) => b.id === "bk-1001")!.returnAt), 4 * 3_600_000);
    assert.equal(entry("bk-1002").status, "ok");
  });

  test("impossible: Model 3 double-booked, no sedan free, needs-action with nearest slot", () => {
    const e = entry("bk-1005");
    assert.equal(e.status, "critical");
    assert.equal(e.conflict?.kind, "car-still-out");
    const plan = planResolution(e.booking, seedCars, bookings);
    assert.deepEqual(plan, { action: "needs-action", slot: { pickupAt: h(62), returnAt: h(86) } });
    assert.equal(e.booking.status, "needs-action");
  });

  test("rushed: RAV4 Rossi pickup 3h after return on a 6h car is a warning", () => {
    assert.equal(entry("bk-1008").status, "warning");
  });

  test("only those two bookings are flagged; seeded statuses already match the engine", () => {
    const flagged = Object.values(analyzeFleet(seedCars, bookings)).flat().filter((e) => e.status !== "ok");
    assert.deepEqual(flagged.map((e) => [e.booking.id, e.status]).sort(), [["bk-1005", "critical"], ["bk-1008", "warning"]]);
    assert.deepEqual(reconcileStatuses(bookings, seedCars), bookings);
  });

  test("late-return demo: Thompson (active) back at +14 -> Brooks critical -> RAV4 offered -> reassign clears it", () => {
    const thompson = bookings.find((b) => b.id === "bk-1009")!;
    assert.ok(Date.parse(thompson.pickupAt) < ANCHOR && ANCHOR < Date.parse(thompson.returnAt), "is mid-rental");

    const { bookings: after, downstream } = markReturnedLate(bookings, seedCars, "bk-1009", h(14), h(1));
    assert.deepEqual(downstream.map((e) => [e.booking.id, e.status]), [["bk-1010", "critical"], ["bk-1011", "ok"]]);

    const brooks = after.find((b) => b.id === "bk-1010")!;
    const plan = planResolution(brooks, seedCars, after);
    assert.deepEqual(plan.action === "reassign" && plan.cars.map((c) => c.id), ["car-rav4"]);

    const fixed = reassignBooking(after, seedCars, "bk-1010", "car-rav4");
    assert.equal(fixed.find((b) => b.id === "bk-1010")?.carId, "car-rav4");
    const criticals = Object.values(analyzeFleet(seedCars, fixed)).flat().filter((e) => e.status === "critical");
    assert.deepEqual(criticals.map((e) => e.booking.id), ["bk-1005"]);
  });

  test("data/*.json on disk matches the seed shape and is engine-consistent", () => {
    const dir = join(process.cwd(), "data");
    const cars: Car[] = JSON.parse(readFileSync(join(dir, "cars.json"), "utf8"));
    const disk: Booking[] = JSON.parse(readFileSync(join(dir, "bookings.json"), "utf8"));
    assert.deepEqual(cars, seedCars);
    const isUtc = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s);
    for (const b of disk) {
      assert.ok(isUtc(b.pickupAt) && isUtc(b.returnAt) && (b.actualReturnAt === null || isUtc(b.actualReturnAt)), b.id);
    }
    assert.deepEqual(reconcileStatuses(disk, cars), disk);
  });
});
