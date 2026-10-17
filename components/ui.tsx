import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDot, Clock, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ChainStatus } from "@/lib/availability";
import type { Phase } from "@/lib/format";
import type { Car } from "@/lib/types";

type Tone = "neutral" | "brand" | "success" | "warn" | "danger" | "navy";

const tones: Record<Tone, string> = {
  neutral: "bg-sand text-slate",
  brand: "bg-peach text-brand-hover",
  success: "bg-success-tint text-success-ink",
  warn: "bg-warn-tint text-warn-ink",
  danger: "bg-danger-tint text-danger-ink",
  navy: "bg-navy text-white",
};

export function Pill({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

export function SeverityPill({ status }: { status: ChainStatus }) {
  if (status === "critical")
    return (
      <Pill tone="danger" icon={<AlertOctagon size={13} />}>
        Critical
      </Pill>
    );
  if (status === "warning")
    return (
      <Pill tone="warn" icon={<AlertTriangle size={13} />}>
        Rushed turnaround
      </Pill>
    );
  return (
    <Pill tone="success" icon={<CheckCircle2 size={13} />}>
      Clear
    </Pill>
  );
}

export function PhasePill({ phase }: { phase: Phase }) {
  switch (phase) {
    case "active":
      return (
        <Pill tone="brand" icon={<CircleDot size={13} />}>
          Out now
        </Pill>
      );
    case "overdue":
      return (
        <Pill tone="danger" icon={<Clock size={13} />}>
          Overdue
        </Pill>
      );
    case "upcoming":
      return <Pill tone="neutral">Upcoming</Pill>;
    case "returned":
      return (
        <Pill tone="neutral" icon={<Undo2 size={13} />}>
          Returned
        </Pill>
      );
    case "cancelled":
      return <Pill tone="neutral">Cancelled</Pill>;
  }
}

export function NeedsActionPill() {
  return (
    <Pill tone="navy" icon={<AlertOctagon size={13} />}>
      Needs action
    </Pill>
  );
}

export function CarLabel({ car, compact = false }: { car: Car; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold text-navy">{car.name}</div>
      <div className="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-slate">
        <span className="uppercase tracking-wide">{car.class}</span>
        {!compact && (
          <>
            <span className="text-line">•</span>
            <span>{car.turnaroundBufferHours}h turnaround</span>
          </>
        )}
      </div>
    </div>
  );
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-line-soft ${className}`} />;
}
