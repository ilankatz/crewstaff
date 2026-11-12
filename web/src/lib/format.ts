export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const hrs = (n: number | null | undefined) => `${(n ?? 0).toFixed(2)} h`;

/** "2026-11-14" → "Sat, Nov 14" */
export function fmtDate(d: string | null | undefined, withYear = false) {
  if (!d) return "—";
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "14:30" → "2:30 PM" */
export function fmtTime(t: string | null | undefined) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** ISO timestamp → local "2:31 PM" */
export function clock(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function stamp(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** ISO → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null;
}

export function todayYmd(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const CALL_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: "Scheduled", tone: "slate" },
  in_progress: { label: "Live", tone: "green" },
  ended: { label: "Ended – awaiting sign-off", tone: "amber" },
  signed_off: { label: "Signed off – needs approval", tone: "blue" },
  approved: { label: "Approved", tone: "violet" },
  cancelled: { label: "Cancelled", tone: "red" },
};

export type Tone = "slate" | "green" | "amber" | "blue" | "violet" | "red";
