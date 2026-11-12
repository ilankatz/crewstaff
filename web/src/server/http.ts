import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const notFound = (what = "Not found") => new HttpError(404, what);
export const forbidden = (msg = "Not allowed") => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw bad("Request body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw bad(`${first.path.join(".") || "body"}: ${first.message}`);
  }
  return parsed.data;
}

export function csv(filename: string, rows: (string | number | null | undefined)[][]) {
  const text = rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
  return new Response(text + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export function intId(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}

// Common field validators
export const zStr = (max = 200) => z.string().trim().max(max);
export const zReq = (max = 200) => z.string().trim().min(1, "is required").max(max);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const zTime = z.string().regex(/^\d{2}:\d{2}$/, "must be HH:MM");
export const zId = z.number().int().positive();
