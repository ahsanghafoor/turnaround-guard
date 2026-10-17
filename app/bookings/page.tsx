import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { BookingsList } from "@/components/BookingsList";
import { SkeletonBlock } from "@/components/ui";
import { analyzeFleet } from "@/lib/availability";
import { loadFleet } from "@/lib/store";

async function BookingsData({ searchParams }: { searchParams: PageProps<"/bookings">["searchParams"] }) {
  const [{ cars, bookings }, params] = await Promise.all([loadFleet(), searchParams]);
  const focus = typeof params.focus === "string" ? params.focus : null;
  return <BookingsList cars={cars} bookings={bookings} chains={analyzeFleet(cars, bookings)} focus={focus} />;
}

export default function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Bookings</div>
          <h1 className="h-display text-[34px] sm:text-[40px]">All bookings</h1>
          <p className="mt-2 max-w-xl text-[16px]">
            Mark late returns to re-check every later booking on that car. Conflicts are never moved automatically.
          </p>
        </div>
        <Link href="/bookings/new" className="btn btn-primary">
          <Plus size={16} strokeWidth={2.5} /> New booking
        </Link>
      </div>
      <Suspense fallback={<SkeletonBlock className="h-[560px]" />}>
        <BookingsData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
