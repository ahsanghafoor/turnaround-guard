// Demo fleet, laid out in hours relative to an anchor (the current hour when seeded),
// so the "active" booking is always mid-rental whenever `npm run seed` is run.
//
// Scenarios baked in (hours relative to anchor):
//   Tight but valid  Camry: Ellis returns +20, Raman picks up +24 = exactly the 4h buffer.
//   Impossible       Model 3: Okafor picks up +48 while Alvarez has it until +54. No sedan
//                    is free for that window, so it is seeded as needs-action.
//   Rushed (warning) RAV4: Nguyen returns +64, Rossi picks up +67, 3h inside a 6h buffer.
//   Late-return demo Explorer: Thompson is out now, due back +3. Brooks picks up +10.
//                    Mark Thompson returned at +14 and Brooks goes critical; the RAV4 is
//                    free for Brooks' window (ends exactly on its 6h buffer).

import type { Booking, Car } from "./types";

const HOUR_MS = 3_600_000;

export const seedCars: Car[] = [
  { id: "car-camry", name: "Toyota Camry", class: "sedan", turnaroundBufferHours: 4 },
  { id: "car-accord", name: "Honda Accord", class: "sedan", turnaroundBufferHours: 4 },
  { id: "car-model3", name: "Tesla Model 3", class: "sedan", turnaroundBufferHours: 8 },
  { id: "car-rav4", name: "Toyota RAV4", class: "SUV", turnaroundBufferHours: 6 },
  { id: "car-explorer", name: "Ford Explorer", class: "SUV", turnaroundBufferHours: 6 },
];

type SeedRow = Omit<Booking, "pickupAt" | "returnAt" | "actualReturnAt"> & {
  pickup: number;
  ret: number;
  actual?: number;
};

const rows: SeedRow[] = [
  { id: "bk-1001", carId: "car-camry", renterName: "Jordan Ellis", pickup: 2, ret: 20, status: "confirmed" },
  { id: "bk-1002", carId: "car-camry", renterName: "Priya Raman", pickup: 24, ret: 60, status: "confirmed" },
  { id: "bk-1003", carId: "car-accord", renterName: "Marcus Chen", pickup: 40, ret: 80, status: "confirmed" },
  { id: "bk-1004", carId: "car-model3", renterName: "Sofia Alvarez", pickup: 30, ret: 54, status: "confirmed" },
  { id: "bk-1005", carId: "car-model3", renterName: "Daniel Okafor", pickup: 48, ret: 72, status: "needs-action" },
  { id: "bk-1006", carId: "car-rav4", renterName: "Hannah Weiss", pickup: -30, ret: -4, actual: -5, status: "completed" },
  { id: "bk-1007", carId: "car-rav4", renterName: "Kenji Nguyen", pickup: 40, ret: 64, status: "confirmed" },
  { id: "bk-1008", carId: "car-rav4", renterName: "Elena Rossi", pickup: 67, ret: 90, status: "confirmed" },
  { id: "bk-1009", carId: "car-explorer", renterName: "Maya Thompson", pickup: -22, ret: 3, status: "confirmed" },
  { id: "bk-1010", carId: "car-explorer", renterName: "Liam Brooks", pickup: 10, ret: 34, status: "confirmed" },
  { id: "bk-1011", carId: "car-explorer", renterName: "Ava Martinez", pickup: 120, ret: 150, status: "confirmed" },
];

/** Floors a timestamp to the start of its UTC hour. */
export function hourAnchor(nowMs: number): number {
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
}

export function buildSeedBookings(anchorMs: number): Booking[] {
  const at = (h: number) => new Date(anchorMs + h * HOUR_MS).toISOString();
  return rows.map(({ pickup, ret, actual, ...rest }) => ({
    ...rest,
    pickupAt: at(pickup),
    returnAt: at(ret),
    actualReturnAt: actual === undefined ? null : at(actual),
  }));
}
