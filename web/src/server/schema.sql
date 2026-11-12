-- CrewStaff database schema (SQLite). Applied idempotently on startup.
-- Timestamps are ISO-8601 UTC strings. Scheduled call dates/times are local wall-clock.

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_steward  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS workers (
  id          INTEGER PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS worker_roles (
  worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (worker_id, role_id)
);

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash         TEXT NOT NULL,
  name                  TEXT NOT NULL DEFAULT '',
  is_admin              INTEGER NOT NULL DEFAULT 0,
  worker_id             INTEGER UNIQUE REFERENCES workers(id) ON DELETE CASCADE,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS worker_documents (
  id            INTEGER PRIMARY KEY,
  worker_id     INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('certification','document')),
  title         TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime          TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL DEFAULT 0,
  expires_on    TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  payment_terms   TEXT NOT NULL DEFAULT 'Net 30',
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS client_contacts (
  id          INTEGER PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  is_billing  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS venues (
  id          INTEGER PRIMARY KEY,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS client_worker_flags (
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  flag        TEXT NOT NULL CHECK (flag IN ('preferred','banned')),
  PRIMARY KEY (client_id, worker_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  venue_id    INTEGER REFERENCES venues(id),
  contact_id  INTEGER REFERENCES client_contacts(id) ON DELETE SET NULL,
  notes       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Pay rate per role for a job (all Stagehands on a job earn the same).
CREATE TABLE IF NOT EXISTS job_rates (
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id),
  pay_rate    REAL NOT NULL,
  PRIMARY KEY (job_id, role_id)
);

CREATE TABLE IF NOT EXISTS calls (
  id              INTEGER PRIMARY KEY,
  job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  call_date       TEXT NOT NULL,           -- YYYY-MM-DD
  start_time      TEXT NOT NULL,           -- HH:MM (local)
  end_time        TEXT,                    -- HH:MM (estimated, optional)
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','in_progress','ended','signed_off','approved','cancelled')),
  started_at      TEXT, started_by    INTEGER REFERENCES users(id),
  ended_at        TEXT, ended_by      INTEGER REFERENCES users(id),
  signed_off_at   TEXT, signed_off_by INTEGER REFERENCES users(id),
  approved_at     TEXT, approved_by   INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id          INTEGER PRIMARY KEY,
  call_id     INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id),
  quantity    INTEGER NOT NULL CHECK (quantity >= 0),
  UNIQUE (call_id, role_id)
);

-- One row per worker per call. Offers are first come, first served:
-- accepting a full position puts the worker on standby.
CREATE TABLE IF NOT EXISTS assignments (
  id            INTEGER PRIMARY KEY,
  position_id   INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  call_id       INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  worker_id     INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('offered','accepted','standby','declined','cancelled','removed')),
  offered_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  responded_at  TEXT,
  UNIQUE (call_id, worker_id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id            INTEGER PRIMARY KEY,
  call_id       INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  worker_id     INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  clock_in      TEXT,
  clock_out     TEXT,
  no_show       INTEGER NOT NULL DEFAULT 0,
  clock_in_by   INTEGER REFERENCES users(id),
  clock_out_by  INTEGER REFERENCES users(id),
  edited        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (call_id, worker_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  call_id     INTEGER REFERENCES calls(id) ON DELETE CASCADE,
  worker_id   INTEGER REFERENCES workers(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- thread_worker_id NULL = group chat for everyone on the call;
-- otherwise the private thread between that worker and the Steward/admins.
CREATE TABLE IF NOT EXISTS messages (
  id                INTEGER PRIMARY KEY,
  call_id           INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  thread_worker_id  INTEGER REFERENCES workers(id) ON DELETE CASCADE,
  sender_user_id    INTEGER NOT NULL REFERENCES users(id),
  body              TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(call_id, thread_worker_id, id);

CREATE TABLE IF NOT EXISTS message_reads (
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id           INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  thread_key        TEXT NOT NULL,          -- 'group' or worker id
  last_read_id      INTEGER NOT NULL,
  PRIMARY KEY (user_id, call_id, thread_key)
);

CREATE TABLE IF NOT EXISTS invoices (
  id              INTEGER PRIMARY KEY,
  job_id          INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  number          TEXT NOT NULL UNIQUE,
  markup_pct      REAL NOT NULL,
  issue_date      TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  terms           TEXT NOT NULL,
  bill_to_contact_id INTEGER REFERENCES client_contacts(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
  labor_cost      REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id          INTEGER PRIMARY KEY,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  call_id     INTEGER REFERENCES calls(id) ON DELETE SET NULL,
  role_id     INTEGER REFERENCES roles(id),
  description TEXT NOT NULL,
  hours       REAL NOT NULL,
  pay_rate    REAL NOT NULL,
  bill_rate   REAL NOT NULL,
  amount      REAL NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS push_tokens (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL DEFAULT 'android',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- In-app notification inbox (also what the app polls when push is unavailable).
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
