export const money = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;

export function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function fmtTime(t: string | null | undefined) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function clock(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function elapsed(fromIso: string, to = Date.now()) {
  const mins = Math.max(0, Math.floor((to - new Date(fromIso).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

export function isToday(d: string) {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return d === `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

/** Monday of the week for a YYYY-MM-DD date. */
export function weekOf(d: string) {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/** "HH:MM" typed by the Steward on a given call date → ISO. Times before `after` roll to the next day. */
export function hhmmToIso(date: string, hhmm: string, after?: string | null) {
  const m = hhmm.trim().match(/^(\d{1,2}):?(\d{2})\s*([ap]m?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap?.startsWith("p") && h < 12) h += 12;
  if (ap?.startsWith("a") && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const d = new Date(`${date}T00:00:00`);
  d.setHours(h, min, 0, 0);
  if (after && d.getTime() <= new Date(after).getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export function isoToHhmm(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
