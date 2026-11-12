import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const DATA_DIR = process.env.CREWSTAFF_DATA_DIR || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

type DB = Database.Database;
const g = globalThis as unknown as { __crewstaffDb?: DB };

function init(): DB {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "crewstaff.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const schema = fs.readFileSync(path.join(process.cwd(), "src/server/schema.sql"), "utf8");
  db.exec(schema);
  bootstrap(db);
  return db;
}

/** First run: create the Steward role and a default admin login. */
function bootstrap(db: DB) {
  const hasRoles = db.prepare("SELECT COUNT(*) n FROM roles").get() as { n: number };
  if (hasRoles.n === 0) {
    const ins = db.prepare("INSERT INTO roles (name, is_steward) VALUES (?, ?)");
    ins.run("Steward", 1);
    for (const r of ["Stagehand", "Rigger", "Forklift Driver", "Truck Loader", "Carpenter", "Audio", "Lighting", "Video"]) ins.run(r, 0);
  }
  const hasAdmin = db.prepare("SELECT COUNT(*) n FROM users WHERE is_admin = 1").get() as { n: number };
  if (hasAdmin.n === 0) {
    const email = process.env.CREWSTAFF_ADMIN_EMAIL || "admin@crewstaff.local";
    const password = process.env.CREWSTAFF_ADMIN_PASSWORD || "crewstaff";
    db.prepare("INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, 1)").run(
      email,
      bcrypt.hashSync(password, 10),
      "Admin",
    );
    console.log(`[crewstaff] Created admin login ${email} / ${password}`);
  }
}

export function db(): DB {
  if (!g.__crewstaffDb) g.__crewstaffDb = init();
  return g.__crewstaffDb;
}

/** Stable secret for signing login tokens, generated once per install. */
export function authSecret(): Uint8Array {
  const file = path.join(DATA_DIR, "auth-secret.key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
  }
  return new TextEncoder().encode(fs.readFileSync(file, "utf8").trim());
}

// Small typed helpers around prepared statements.
export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...params);
}
export function tx<T>(fn: () => T): T {
  return db().transaction(fn)();
}
export function nowIso() {
  return new Date().toISOString();
}
