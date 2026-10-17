"use client";

import { useState, useTransition } from "react";
import { AlertOctagon, AlertTriangle, ArrowRight, Ban, CalendarClock, CarFront, CheckCircle2, Clock } from "lucide-react";
import { cancelBookingAction, markReturnedLateAction, reassignAction, rescheduleAction } from "@/app/actions";
import {
  HOUR_MS,
  checkBooking,
  explainConflict,
  markReturnedLate,
  planResolution,
  type ChainEntry,
  type Interval,
} from "@/lib/availability";
import { fmtDuration, fmtWhen, fromLocalInput, toLocalInput } from "@/lib/format";
import type { Booking, Car } from "@/lib/types";
import { Modal } from "./Modal";
import { CarLabel, NeedsActionPill, SeverityPill } from "./ui";

type Fleet = { cars: Car[]; bookings: Booking[]; chainById: Map<string, ChainEntry> };

// ---------------------------------------------------------------------------
// Mark returned late

export function MarkLateDialog({
  booking,
  fleet,
  now,
  report,
  onReport,
  onReassign,
  onClose,
}: {
  booking: Booking;
  fleet: Fleet;
  now: number;
  /** Re-check results from the server, once the late return is saved. */
  report: ChainEntry[] | null;
  onReport: (downstream: ChainEntry[]) => void;
  onReassign: (bookingId: string) => void;
  onClose: () => void;
}) {
  const car = fleet.cars.find((c) => c.id === booking.carId);
  const [actualLocal, setActualLocal] = useState(() =>
    toLocalInput(booking.actualReturnAt ?? Date.parse(booking.returnAt) + 2 * HOUR_MS),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const actualAt = fromLocalInput(actualLocal);
  const isLate = !!actualAt && Date.parse(actualAt) > Date.parse(booking.returnAt);
  const late = actualAt ? (Date.parse(actualAt) - Date.parse(booking.returnAt)) / 60_000 : 0;

  // Preview the re-check locally with the same pure engine the server will run.
  let preview: ChainEntry[] | null = null;
  if (isLate && !report) {
    try {
      preview = markReturnedLate(fleet.bookings, fleet.cars, booking.id, actualAt!, new Date(now).toISOString()).downstream;
    } catch {
      preview = null;
    }
  }

  function save() {
    if (!actualAt || !isLate) return;
    setError(null);
    startSaving(async () => {
      const res = await markReturnedLateAction(booking.id, actualAt);
      if (res.ok) onReport(res.downstream);
      else setError(res.error);
    });
  }

  if (report) {
    const criticals = report.filter((e) => fleet.chainById.get(e.booking.id)?.status === "critical").length;
    return (
      <Modal eyebrow="Re-check complete" title={`${car?.name ?? "Car"} after ${booking.renterName}`} onClose={onClose} wide>
        <p className="mb-4 text-[15px]">
          {booking.renterName} marked back at <strong className="text-navy">{fmtWhen(booking.actualReturnAt ?? actualAt!)}</strong>.{" "}
          {report.length === 0
            ? "No later bookings on this car, so nothing else is affected."
            : `Re-checked ${report.length} later booking${report.length === 1 ? "" : "s"} on this car in pickup order.`}
        </p>
        <ul className="space-y-3">
          {report.map((e) => (
            <ReportRow key={e.booking.id} reported={e} fleet={fleet} onReassign={onReassign} />
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
          <span className="text-[13px]">
            {criticals > 0 ? `${criticals} critical conflict${criticals === 1 ? "" : "s"} still open` : "No open critical conflicts"}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal eyebrow="Mark returned late" title={booking.renterName} onClose={onClose}>
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-sand p-4 text-[14px]">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-mist">Vehicle</div>
          <div className="font-semibold text-navy">{car?.name}</div>
        </div>
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-mist">Planned return</div>
          <div className="font-semibold text-navy">{fmtWhen(booking.returnAt)}</div>
        </div>
      </div>

      <label className="label" htmlFor="actual">
        Actual return time
      </label>
      <input
        id="actual"
        type="datetime-local"
        className="field"
        value={actualLocal}
        onChange={(e) => {
          setActualLocal(e.target.value);
          setError(null);
        }}
      />
      <p className="mt-2 flex items-center gap-1.5 text-[13px]">
        <Clock size={14} />
        {actualAt && isLate
          ? `${fmtDuration(late)} late. Use a future time if the renter has told you when they'll be back.`
          : "Must be after the planned return."}
      </p>

      {preview && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <div className="eyebrow mb-2">Impact preview</div>
          {preview.length === 0 ? (
            <p className="text-[14px]">No later bookings on this car.</p>
          ) : (
            <ul className="space-y-2">
              {preview.map((e) => (
                <li key={e.booking.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
                  <span>
                    <span className="font-semibold text-navy">{e.booking.renterName}</span>
                    <span className="text-mist"> · picks up {fmtWhen(e.booking.pickupAt)}</span>
                  </span>
                  <SeverityPill status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="mt-4 rounded-xl bg-danger-tint px-4 py-3 text-[14px] text-danger-ink">{error}</div>}

      <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!isLate || saving} onClick={save}>
          {saving ? "Re-checking…" : "Save and re-check"} <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}

function ReportRow({
  reported,
  fleet,
  onReassign,
}: {
  reported: ChainEntry;
  fleet: Fleet;
  onReassign: (bookingId: string) => void;
}) {
  const current = fleet.bookings.find((b) => b.id === reported.booking.id);
  const live = fleet.chainById.get(reported.booking.id);
  const moved = current && current.carId !== reported.booking.carId;
  const movedTo = moved ? fleet.cars.find((c) => c.id === current.carId) : null;
  const status = moved ? "ok" : (live?.status ?? reported.status);
  const conflict = live?.conflict ?? reported.conflict;
  const resolution =
    current && status === "critical" ? planResolution(current, fleet.cars, fleet.bookings) : { action: "none" as const };

  const tone =
    status === "critical" ? "border-danger/50 bg-danger-tint/50" : status === "warning" ? "border-warn/50 bg-warn-tint/60" : "border-line";

  return (
    <li className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-navy">{reported.booking.renterName}</span>
        <span className="text-[13px] text-mist">picks up {fmtWhen(reported.booking.pickupAt)}</span>
        <span className="ml-auto flex gap-1.5">
          {current?.status === "needs-action" && <NeedsActionPill />}
          <SeverityPill status={status} />
        </span>
      </div>
      {moved ? (
        <p className="mt-2 flex items-center gap-1.5 text-[14px] text-success-ink">
          <CheckCircle2 size={16} /> Reassigned to {movedTo?.name}. Conflict cleared.
        </p>
      ) : (
        conflict && status !== "ok" && <p className="mt-2 text-[14px]">{explainConflict(conflict, fmtWhen)}</p>
      )}
      {resolution.action === "reassign" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[13px]">
            {resolution.cars.length} same-class car{resolution.cars.length === 1 ? " is" : "s are"} free for this window.
          </span>
          <button type="button" className="btn btn-danger btn-sm ml-auto" onClick={() => onReassign(reported.booking.id)}>
            <CarFront size={14} /> Reassign car
          </button>
        </div>
      )}
      {resolution.action === "needs-action" && (
        <p className="mt-2 text-[13px] font-medium text-danger-ink">
          No same-class car is free, so this booking is marked Needs action and stays on its car until you resolve it
          from the bookings list.
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Resolve a critical booking: reassign to a free same-class car if there is one,
// otherwise reschedule (operator enters new times) or cancel.

type ResolveStage = "choose" | "reschedule" | "cancel";

export function ReassignDialog({
  booking,
  fleet,
  now,
  onDone,
  onClose,
}: {
  booking: Booking;
  fleet: Fleet;
  now: number;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<ResolveStage>("choose");
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  const car = fleet.cars.find((c) => c.id === booking.carId);
  const entry = fleet.chainById.get(booking.id);
  const resolution = planResolution(booking, fleet.cars, fleet.bookings);

  function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) {
    setError(null);
    startPending(async () => {
      const res = await fn();
      if (res.ok) onDone(message);
      else setError(res.error);
    });
  }

  const title =
    stage === "reschedule" ? "Reschedule booking" : stage === "cancel" ? "Cancel booking" : booking.renterName;
  const eyebrow =
    resolution.action === "reassign" ? "Reassign car" : stage === "choose" ? "Resolve conflict" : booking.renterName;

  return (
    <Modal eyebrow={eyebrow} title={title} onClose={onClose} wide>
      <div className="mb-4 rounded-xl bg-danger-tint/60 p-4 text-[14px]">
        <div className="mb-1 flex items-center gap-2 font-semibold text-danger-ink">
          <AlertOctagon size={16} /> {car?.name}: {fmtWhen(booking.pickupAt)} → {fmtWhen(booking.returnAt)}
        </div>
        {entry?.conflict && entry.status !== "ok"
          ? explainConflict(entry.conflict, fmtWhen)
          : "This booking has no open conflict."}
      </div>

      {resolution.action === "reassign" && (
        <>
          <p className="mb-3 text-[14px]">
            Pick a car. These {car?.class === "SUV" ? "SUVs" : "sedans"} are free for the whole window with their full
            turnaround on both sides. Nothing moves until you choose.
          </p>
          <ul className="space-y-2">
            {resolution.cars.map((alt) => (
              <li key={alt.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-success-tint text-success-ink">
                  <CarFront size={20} />
                </span>
                <CarLabel car={alt} />
                <button
                  type="button"
                  className="btn btn-primary btn-sm ml-auto"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => reassignAction(booking.id, alt.id),
                      `${booking.renterName} moved to ${alt.name}. Conflict cleared.`,
                    )
                  }
                >
                  Move to {alt.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {resolution.action === "needs-action" && stage === "choose" && (
        <div className="space-y-3 text-[14px]">
          <p>
            No other {car?.class === "SUV" ? "SUV" : "sedan"} is free for this window, so there&apos;s no car to reassign
            to. Reschedule the booking or cancel it. Until then it stays marked{" "}
            <strong className="text-navy">Needs action</strong>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStage("reschedule")}
              className="flex flex-col items-start gap-2 rounded-xl border border-line p-4 text-left transition-colors hover:border-brand hover:bg-peach/40"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-peach text-brand">
                <CalendarClock size={20} />
              </span>
              <span className="font-semibold text-navy">Reschedule</span>
              <span className="text-[13px]">
                Enter a new pickup and return time on {car?.name}.
                {resolution.slot && ` Nearest clean slot: ${fmtWhen(resolution.slot.pickupAt)}.`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStage("cancel")}
              className="flex flex-col items-start gap-2 rounded-xl border border-line p-4 text-left transition-colors hover:border-danger hover:bg-danger-tint/40"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-danger-tint text-danger">
                <Ban size={20} />
              </span>
              <span className="font-semibold text-navy">Cancel booking</span>
              <span className="text-[13px]">Release the booking so it no longer holds the car.</span>
            </button>
          </div>
        </div>
      )}

      {resolution.action === "needs-action" && stage === "reschedule" && car && (
        <RescheduleForm
          booking={booking}
          car={car}
          fleet={fleet}
          now={now}
          suggested={resolution.slot}
          pending={pending}
          onBack={() => setStage("choose")}
          onSubmit={(window) =>
            act(
              () => rescheduleAction(booking.id, window.pickupAt, window.returnAt),
              `${booking.renterName} rescheduled to ${fmtWhen(window.pickupAt)}. Conflict cleared.`,
            )
          }
        />
      )}

      {resolution.action === "needs-action" && stage === "cancel" && (
        <div className="space-y-4 text-[14px]">
          <p>
            Cancel <strong className="text-navy">{booking.renterName}</strong>&apos;s booking on {car?.name} (
            {fmtWhen(booking.pickupAt)} → {fmtWhen(booking.returnAt)})? It stays in the bookings list as cancelled and
            no longer holds the car. Let the renter know.
          </p>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" className="btn btn-secondary" onClick={() => setStage("choose")} disabled={pending}>
              Keep booking
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending}
              onClick={() =>
                act(() => cancelBookingAction(booking.id), `${booking.renterName}'s booking was cancelled.`)
              }
            >
              <Ban size={16} /> {pending ? "Cancelling…" : "Cancel booking"}
            </button>
          </div>
        </div>
      )}

      {resolution.action === "none" && (
        <p className="flex items-center gap-2 text-[14px] text-success-ink">
          <CheckCircle2 size={16} /> This booking no longer has a critical conflict.
        </p>
      )}

      {error && <div className="mt-4 rounded-xl bg-danger-tint px-4 py-3 text-[14px] text-danger-ink">{error}</div>}
    </Modal>
  );
}

function RescheduleForm({
  booking,
  car,
  fleet,
  now,
  suggested,
  pending,
  onBack,
  onSubmit,
}: {
  booking: Booking;
  car: Car;
  fleet: Fleet;
  now: number;
  suggested: Interval | null;
  pending: boolean;
  onBack: () => void;
  onSubmit: (window: Interval) => void;
}) {
  const start = suggested ?? booking;
  const [pickupLocal, setPickupLocal] = useState(() => toLocalInput(start.pickupAt));
  const [returnLocal, setReturnLocal] = useState(() => toLocalInput(start.returnAt));
  const minLocal = toLocalInput(now);

  const pickupAt = fromLocalInput(pickupLocal);
  const returnAt = fromLocalInput(returnLocal);
  const inPast = !!pickupAt && Date.parse(pickupAt) < now;
  const result =
    pickupAt && returnAt && !inPast ? checkBooking({ ...booking, pickupAt, returnAt }, fleet.bookings, car) : null;

  return (
    <div className="space-y-4">
      <p className="text-[14px]">
        New times on <strong className="text-navy">{car.name}</strong> ({car.turnaroundBufferHours}h turnaround).
        {suggested && " Prefilled with the nearest clean slot."} Confirm the new time with the renter first.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rs-pickup">
            New pickup
          </label>
          <input
            id="rs-pickup"
            type="datetime-local"
            className="field"
            min={minLocal}
            value={pickupLocal}
            onChange={(e) => setPickupLocal(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="rs-return">
            New return
          </label>
          <input
            id="rs-return"
            type="datetime-local"
            className="field"
            min={pickupLocal || minLocal}
            value={returnLocal}
            onChange={(e) => setReturnLocal(e.target.value)}
          />
        </div>
      </div>

      {inPast && <CheckLine tone="danger">Pickup can&apos;t be in the past.</CheckLine>}
      {result?.ok && <CheckLine tone="success">{car.name} is free, with the full turnaround on both sides.</CheckLine>}
      {result &&
        !result.ok &&
        result.conflicts.map((c, i) => (
          <CheckLine key={i} tone={c.severity === "critical" ? "danger" : "warn"}>
            {explainConflict(c, fmtWhen)}
          </CheckLine>
        ))}

      <div className="flex justify-between gap-2 border-t border-line pt-4">
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={pending}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!result?.ok || pending}
          onClick={() => onSubmit({ pickupAt: pickupAt!, returnAt: returnAt! })}
        >
          {pending ? "Saving…" : "Reschedule"} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function CheckLine({ tone, children }: { tone: "success" | "warn" | "danger"; children: React.ReactNode }) {
  const styles = {
    success: "bg-success-tint text-success-ink",
    warn: "bg-warn-tint text-warn-ink",
    danger: "bg-danger-tint text-danger-ink",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : tone === "warn" ? AlertTriangle : AlertOctagon;
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[14px] ${styles}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
