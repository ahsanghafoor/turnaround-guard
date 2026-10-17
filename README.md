# Turnaround Guard

Fleet turnaround and conflict checks for rental operators. Next.js App Router + Tailwind, no auth, no database: data lives in `data/cars.json` and `data/bookings.json`.

```bash
npm install
npm run seed   # rewrite data/*.json anchored to the current hour
npm run dev
npm test       # availability engine verification (44 cases)
```

All datetimes are stored as UTC ISO strings and shown in the browser's local timezone.

## Layout

- `lib/availability.ts`: the pure availability engine (overlap, buffer checks, severity, late-return cascade, alternatives, operator-driven state transitions)
- `lib/seed.ts`: demo fleet and bookings, defined in hours relative to an anchor
- `lib/store.ts`: JSON read/write (serialized, atomic writes)
- `app/actions.ts`: server actions that wrap the engine
- `app/page.tsx`: fleet timeline · `app/bookings/page.tsx`: bookings list · `app/bookings/new/page.tsx`: new booking

## Demo script

1. **Fleet**: Daniel Okafor on the Tesla Model 3 is critical and stuck as *Needs action* (double-booked, no sedan free). On the bookings list, **Resolve** offers **Reschedule** (enter new pickup and return times, checked live) or **Cancel booking**. Elena Rossi on the RAV4 is a rushed 3h-of-6h turnaround. The Camry handoff from Jordan Ellis to Priya Raman is exactly the 4h buffer, so it's clear.
2. **Bookings → Maya Thompson → Mark returned late**: enter a time about 11h after the planned return. The preview shows Liam Brooks going critical. Save, then **Reassign car → Toyota RAV4**.
3. **New booking**: pick the Camry with a pickup 2h after Jordan Ellis returns to see the plain-word warning and the Honda Accord offered as an alternative.

Use **Reset demo** in the header to restore the data between takes.
