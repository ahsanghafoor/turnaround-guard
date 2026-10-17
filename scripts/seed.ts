// Writes data/cars.json and data/bookings.json, anchored to the current UTC hour.
// Override the anchor for a reproducible dataset: SEED_ANCHOR=2026-10-17T09:00:00Z npm run seed

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeedBookings, hourAnchor, seedCars } from "../lib/seed";

const anchor = hourAnchor(process.env.SEED_ANCHOR ? Date.parse(process.env.SEED_ANCHOR) : Date.now());
if (Number.isNaN(anchor)) throw new Error(`Bad SEED_ANCHOR: ${process.env.SEED_ANCHOR}`);

const dir = join(process.cwd(), "data");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "cars.json"), JSON.stringify(seedCars, null, 2) + "\n");
writeFileSync(join(dir, "bookings.json"), JSON.stringify(buildSeedBookings(anchor), null, 2) + "\n");

console.log(`Seeded ${seedCars.length} cars and bookings anchored at ${new Date(anchor).toISOString()}`);
