// Core data model. Every datetime is a UTC ISO-8601 string (e.g. "2026-10-17T14:00:00.000Z").
// Conversion to the viewer's local timezone happens only at display time, in client components.

export type CarClass = "sedan" | "SUV";

export interface Car {
  id: string;
  name: string;
  class: CarClass;
  /** Hours the car needs between a return and the next pickup (cleaning, inspection, charging). */
  turnaroundBufferHours: number;
}

export type BookingStatus = "confirmed" | "completed" | "cancelled" | "needs-action";

export interface Booking {
  id: string;
  carId: string;
  renterName: string;
  pickupAt: string;
  returnAt: string;
  /** Set when the car actually came back (or is confirmed to come back) at a different time. */
  actualReturnAt: string | null;
  status: BookingStatus;
}
