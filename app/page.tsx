import { Suspense } from "react";
import { FleetOverview } from "@/components/FleetOverview";
import { SkeletonBlock } from "@/components/ui";
import { analyzeFleet } from "@/lib/availability";
import { loadFleet } from "@/lib/store";

async function FleetData() {
  const { cars, bookings } = await loadFleet();
  return <FleetOverview cars={cars} bookings={bookings} chains={analyzeFleet(cars, bookings)} />;
}

export default function FleetPage() {
  return (
    <Suspense fallback={<SkeletonBlock className="h-[640px]" />}>
      <FleetData />
    </Suspense>
  );
}
