import { Suspense } from "react";
import { NewBookingForm } from "@/components/NewBookingForm";
import { SkeletonBlock } from "@/components/ui";
import { loadFleet } from "@/lib/store";

async function BookingFormData() {
  const { cars, bookings } = await loadFleet();
  return <NewBookingForm cars={cars} bookings={bookings} />;
}

export default function NewBookingPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow mb-2">New booking</div>
        <h1 className="h-display text-[34px] sm:text-[40px]">Book a car</h1>
        <p className="mt-2 max-w-xl text-[16px]">
          Availability is checked as you type, including each car&apos;s turnaround buffer.
        </p>
      </div>
      <Suspense fallback={<SkeletonBlock className="h-[460px]" />}>
        <BookingFormData />
      </Suspense>
    </div>
  );
}
