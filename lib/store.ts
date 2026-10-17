// Server-side access to the mock JSON "database" in data/. Reads are per request;
// writes are serialized and atomic (temp file + rename) so concurrent actions can't interleave.

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "next/server";
import type { Booking, Car } from "./types";

const DATA_DIR = join(process.cwd(), "data");
const CARS_FILE = join(DATA_DIR, "cars.json");
const BOOKINGS_FILE = join(DATA_DIR, "bookings.json");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/** For Server Components: always fresh, never prerendered. */
export async function loadFleet(): Promise<{ cars: Car[]; bookings: Booking[] }> {
  await connection();
  return readFleet();
}

export async function readFleet(): Promise<{ cars: Car[]; bookings: Booking[] }> {
  const [cars, bookings] = await Promise.all([readJson<Car[]>(CARS_FILE), readJson<Booking[]>(BOOKINGS_FILE)]);
  return { cars, bookings };
}

async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, file);
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs a read-modify-write on the fleet data with no other write in between. */
export function updateFleet<T>(
  fn: (fleet: { cars: Car[]; bookings: Booking[] }) => { cars?: Car[]; bookings?: Booking[]; result: T },
): Promise<T> {
  const run = queue.then(async () => {
    const fleet = await readFleet();
    const next = fn(fleet);
    if (next.cars) await writeJson(CARS_FILE, next.cars);
    if (next.bookings) await writeJson(BOOKINGS_FILE, next.bookings);
    return next.result;
  });
  queue = run.catch(() => undefined);
  return run;
}
