"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertOctagon, AlertTriangle, ArrowRight, CalendarClock, CarFront, CheckCircle2, Info } from "lucide-react";
import { createBookingAction } from "@/app/actions";
import {
  HOUR_MS,
  carBookings,
  checkBooking,
  effectiveReturn,
  explainConflict,
  findAlternatives,
} from "@/lib/availability";
import { fmtDuration, fmtWhen, fromLocalInput, toLocalInput, useHydrated, useNow } from "@/lib/format";
import type { Booking, Car } from "@/lib/types";
import { CarLabel, SkeletonBlock } from "./ui";

export function NewBookingForm({ cars, bookings }: { cars: Car[]; bookings: Booking[] }) {
  // Default times depend on the viewer's clock and timezone, so render only on the client.
  if (!useHydrated()) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <SkeletonBlock className="h-[460px]" />
        <SkeletonBlock className="h-[460px]" />
      </div>
    );
  }
  return <Form cars={cars} bookings={bookings} />;
}

function defaultWindow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return { pickup: toLocalInput(d.getTime()), ret: toLocalInput(d.getTime() + 24 * HOUR_MS) };
}

function Form({ cars, bookings }: { cars: Car[]; bookings: Booking[] }) {
  const router = useRouter();
  const [initial] = useState(defaultWindow);
  const [renterName, setRenterName] = useState("");
  const [carId, setCarId] = useState(cars[0]?.id ?? "");
  const [pickupLocal, setPickupLocal] = useState(initial.pickup);
  const [returnLocal, setReturnLocal] = useState(initial.ret);
  const [acceptRushed, setAcceptRushed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const now = useNow() ?? 0;
  const minLocal = toLocalInput(now);

  const car = cars.find((c) => c.id === carId);
  const pickupAt = fromLocalInput(pickupLocal);
  const returnAt = fromLocalInput(returnLocal);
  // Bookings can't start in the past; don't run the availability check until the pickup is valid.
  const inPast = !!pickupAt && Date.parse(pickupAt) < now;
  const draft = car && pickupAt && returnAt && !inPast ? { carId: car.id, pickupAt, returnAt } : null;
  const result = draft && car ? checkBooking(draft, bookings, car) : null;
  const alternatives =
    draft && result && !result.ok && result.conflicts[0].kind !== "invalid-window"
      ? findAlternatives(draft, cars, bookings)
      : null;

  const blocked = !result || result.severity === "critical" || (result.severity === "warning" && !acceptRushed);
  const canSubmit = !!renterName.trim() && !blocked && !saving;

  // Reset the rushed confirmation whenever the inputs change what is being booked.
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setAcceptRushed(false);
      setError(null);
    };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !canSubmit) return;
    startSaving(async () => {
      const res = await createBookingAction({ ...draft, renterName, allowRushed: acceptRushed });
      if (res.ok) router.push(`/bookings?focus=${res.id}`);
      else setError(res.error);
    });
  }

  const classes = Array.from(new Set(cars.map((c) => c.class)));

  return (
    <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-[1fr_1.1fr]">
      <section className="card space-y-5 p-6">
        <h2 className="h-display text-[20px]">Booking details</h2>
        <div>
          <label className="label" htmlFor="renter">
            Renter name
          </label>
          <input
            id="renter"
            className="field"
            placeholder="e.g. Alex Morgan"
            value={renterName}
            onChange={(e) => {
              setRenterName(e.target.value);
              setError(null);
            }}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label" htmlFor="car">
            Vehicle
          </label>
          <select id="car" className="field" value={carId} onChange={(e) => change(setCarId)(e.target.value)}>
            {classes.map((cls) => (
              <optgroup key={cls} label={cls === "SUV" ? "SUVs" : "Sedans"}>
                {cars
                  .filter((c) => c.class === cls)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.turnaroundBufferHours}h turnaround
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pickup">
              Pickup
            </label>
            <input
              id="pickup"
              type="datetime-local"
              className="field"
              min={minLocal}
              value={pickupLocal}
              onChange={(e) => change(setPickupLocal)(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="return">
              Return
            </label>
            <input
              id="return"
              type="datetime-local"
              className="field"
              min={pickupLocal || minLocal}
              value={returnLocal}
              onChange={(e) => change(setReturnLocal)(e.target.value)}
            />
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-[13px]">
          <Info size={14} /> Times are in your local timezone.
        </p>

        {result?.severity === "warning" && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-warn/50 bg-warn-tint p-3.5 text-[14px] text-warn-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
              checked={acceptRushed}
              onChange={(e) => setAcceptRushed(e.target.checked)}
            />
            <span>
              <strong>Book anyway with a rushed turnaround.</strong> The car will be back, but the team gets less than
              the full {car?.turnaroundBufferHours}h to turn it around.
            </span>
          </label>
        )}

        {error && (
          <div className="rounded-xl bg-danger-tint px-4 py-3 text-[14px] font-medium text-danger-ink">{error}</div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
          <span className="text-[13px]">{!renterName.trim() ? "Add the renter's name to continue." : ""}</span>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {saving ? "Booking…" : "Confirm booking"} <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <AvailabilityPanel car={car} result={result} inPast={inPast} />

        {alternatives && (
          <div className="card p-5">
            <div className="eyebrow mb-3">Alternatives</div>
            {alternatives.kind === "cars" && (
              <>
                <p className="mb-3 text-[14px]">
                  These {car?.class === "SUV" ? "SUVs" : "sedans"} are free for this exact window with a full
                  turnaround on both sides:
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {alternatives.cars.map((alt) => (
                    <button
                      key={alt.id}
                      type="button"
                      onClick={() => change(setCarId)(alt.id)}
                      className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 text-left transition-colors hover:border-brand hover:bg-peach/40"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-success-tint text-success-ink">
                        <CarFront size={18} />
                      </span>
                      <CarLabel car={alt} />
                      <span className="ml-auto text-[13px] font-semibold text-brand">Switch</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {alternatives.kind === "slot" && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-[14px]">
                  No other {car?.class === "SUV" ? "SUV" : "sedan"} is free for this window. The nearest clean slot on{" "}
                  <strong className="text-navy">{car?.name}</strong> is{" "}
                  <strong className="text-navy">
                    {fmtWhen(alternatives.pickupAt)} → {fmtWhen(alternatives.returnAt)}
                  </strong>
                  .
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    change(setPickupLocal)(toLocalInput(alternatives.pickupAt));
                    setReturnLocal(toLocalInput(alternatives.returnAt));
                  }}
                >
                  <CalendarClock size={14} /> Use this slot
                </button>
              </div>
            )}
            {alternatives.kind === "none" && (
              <p className="text-[14px]">
                No same-class car is free and {car?.name} has no clean slot in the next 7 days.
              </p>
            )}
          </div>
        )}

        {car && <CarSchedule car={car} bookings={bookings} />}
      </section>
    </form>
  );
}

function AvailabilityPanel({
  car,
  result,
  inPast,
}: {
  car?: Car;
  result: ReturnType<typeof checkBooking> | null;
  inPast: boolean;
}) {
  if (inPast) {
    return (
      <div className="card border-danger/60 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger-tint text-danger">
            <AlertOctagon size={22} />
          </span>
          <div>
            <div className="eyebrow mb-1 !text-danger-ink">Pickup in the past</div>
            <p className="h-display text-[18px]">Pick a time from now onwards</p>
            <p className="mt-1 text-[14px]">Bookings can&apos;t be placed in the past.</p>
          </div>
        </div>
      </div>
    );
  }
  if (!car || !result) {
    return (
      <div className="card p-5 text-[14px]">
        <div className="eyebrow mb-2">Availability</div>
        Pick a vehicle, pickup and return to check availability.
      </div>
    );
  }
  if (result.ok) {
    return (
      <div className="card border-success/60 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success-tint text-success-ink">
            <CheckCircle2 size={22} />
          </span>
          <div>
            <div className="eyebrow mb-1 !text-success-ink">Available</div>
            <p className="h-display text-[18px]">{car.name} is free</p>
            <p className="mt-1 text-[14px]">
              No overlap, and the full {car.turnaroundBufferHours}h turnaround is kept before pickup and after return.
            </p>
          </div>
        </div>
      </div>
    );
  }
  const critical = result.severity === "critical";
  return (
    <div className={`card p-5 ${critical ? "border-danger/60" : "border-warn/60"}`}>
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
            critical ? "bg-danger-tint text-danger" : "bg-warn-tint text-warn"
          }`}
        >
          {critical ? <AlertOctagon size={22} /> : <AlertTriangle size={22} />}
        </span>
        <div className="min-w-0">
          <div className={`eyebrow mb-1 ${critical ? "!text-danger-ink" : "!text-warn-ink"}`}>
            {critical ? "Critical · not possible" : "Warning · rushed turnaround"}
          </div>
          <p className="h-display text-[18px]">
            {critical ? `${car.name} can't take this booking` : `${car.name} is back, but the turnaround is short`}
          </p>
          <ul className="mt-2 space-y-1.5 text-[14px]">
            {result.conflicts.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    c.severity === "critical" ? "bg-danger" : "bg-warn"
                  }`}
                />
                <span>
                  {explainConflict(c, fmtWhen)}
                  {c.shortByMinutes > 0 && (
                    <span className="text-mist"> ({fmtDuration(c.shortByMinutes)} short)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CarSchedule({ car, bookings }: { car: Car; bookings: Booking[] }) {
  const now = useNow() ?? 0;
  const upcoming = carBookings(car.id, bookings)
    .filter((b) => Date.parse(effectiveReturn(b)) > now)
    .slice(0, 5);
  return (
    <div className="card p-5">
      <div className="eyebrow mb-3">{car.name} schedule</div>
      {upcoming.length === 0 ? (
        <p className="text-[14px]">No upcoming bookings.</p>
      ) : (
        <ul className="space-y-2 text-[14px]">
          {upcoming.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg bg-sand px-3 py-2">
              <span className="font-semibold text-navy">{b.renterName}</span>
              <span className="text-[13px]">
                {fmtWhen(b.pickupAt)} → {fmtWhen(effectiveReturn(b))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
