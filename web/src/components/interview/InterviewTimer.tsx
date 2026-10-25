import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface InterviewTimerProps {
  totalSeconds: number;
  startedAt?: string | null;
  onExpired?: () => void;
  running: boolean;
}

function formatTime(s: number) {
  const clamped = Math.max(0, s);
  const m = Math.floor(clamped / 60);
  const sec = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function computeInitialRemaining(totalSeconds: number, startedAt?: string | null): number {
  if (!startedAt) return totalSeconds;
  const startedMs = Date.parse(startedAt);
  if (Number.isNaN(startedMs)) return totalSeconds;
  const elapsedSeconds = Math.floor((Date.now() - startedMs) / 1000);
  return Math.max(0, totalSeconds - Math.max(0, elapsedSeconds));
}

export default function InterviewTimer({
  totalSeconds,
  startedAt,
  onExpired,
  running,
}: InterviewTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    computeInitialRemaining(totalSeconds, startedAt)
  );

  useEffect(() => {
    setRemaining(computeInitialRemaining(totalSeconds, startedAt));
  }, [totalSeconds, startedAt]);

  useEffect(() => {
    if (!running) return;
    if (remaining <= 0) {
      onExpired?.();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [running, remaining, onExpired]);

  const isWarning = remaining <= 300; // <=5 min
  const isUrgent = remaining <= 60;

  return (
    <span
      className={cn(
        "font-mono text-sm font-medium tabular-nums",
        isUrgent ? "text-destructive" : isWarning ? "text-amber-500" : "text-foreground"
      )}
    >
      ⏱ {formatTime(remaining)}
    </span>
  );
}
