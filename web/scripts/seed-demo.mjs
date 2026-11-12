// Loads demo data into a running CrewStaff server through its API.
// Usage: node scripts/seed-demo.mjs [http://localhost:3000]
// Demo crew logins all use the password "crewstaff1".
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "") + "/api";
const ADMIN = { email: process.env.CREWSTAFF_ADMIN_EMAIL || "admin@crewstaff.local", password: process.env.CREWSTAFF_ADMIN_PASSWORD || "crewstaff" };
const CREW_PASSWORD = "crewstaff1";

async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error ?? ""}`);
  return data;
}
const login = async (email, password) => (await api(null, "POST", "/auth/login", { email, password })).token;
const ymd = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00`).toISOString();

const admin = await login(ADMIN.email, ADMIN.password);
if ((await api(admin, "GET", "/admin/jobs?status=all")).length) {
  console.log("This database already has jobs; demo data not loaded. Use a fresh data folder to seed.");
  process.exit(0);
}
let roles = await api(admin, "GET", "/admin/roles");
const R = Object.fromEntries(roles.map((r) => [r.name, r.id]));

// --- clients, contacts, venues
const northstar = (await api(admin, "POST", "/admin/clients", { name: "Northstar Live", phone: "212-555-0140", email: "ap@northstarlive.example", billing_address: "250 W 57th St, Suite 900\nNew York, NY 10107", payment_terms: "Net 30" })).id;
await api(admin, "POST", `/admin/clients/${northstar}/contacts`, { name: "Dana Whitfield", title: "Production Manager", email: "dana@northstarlive.example", phone: "212-555-0141", is_billing: false });
await api(admin, "POST", `/admin/clients/${northstar}/contacts`, { name: "Luis Romero", title: "Accounts Payable", email: "ap@northstarlive.example", phone: "212-555-0142", is_billing: true });
const msg = (await api(admin, "POST", "/admin/venues", { client_id: northstar, name: "Madison Square Garden", address: "4 Pennsylvania Plaza, New York, NY 10001", notes: "Crew entrance on 33rd St loading dock." })).id;

const bluewave = (await api(admin, "POST", "/admin/clients", { name: "Bluewave Touring Logistics", phone: "310-555-0177", email: "billing@bluewave.example", billing_address: "1200 Aviation Blvd\nLos Angeles, CA 90045", payment_terms: "Net 15" })).id;
await api(admin, "POST", `/admin/clients/${bluewave}/contacts`, { name: "Priya Shah", title: "Tour Logistics Lead", email: "priya@bluewave.example", phone: "310-555-0178", is_billing: true });
const sofi = (await api(admin, "POST", "/admin/venues", { client_id: bluewave, name: "SoFi Stadium", address: "1001 Stadium Dr, Inglewood, CA 90301" })).id;

// --- labor pool
const people = [
  ["Marcus", "Reed", ["Steward", "Rigger", "Stagehand"]],
  ["Tanya", "Brooks", ["Steward", "Stagehand"]],
  ["Jordan", "Alvarez", ["Stagehand", "Forklift Driver"]],
  ["Kim", "Nguyen", ["Stagehand", "Lighting"]],
  ["Devon", "Carter", ["Stagehand", "Truck Loader"]],
  ["Sofia", "Martinez", ["Stagehand", "Audio"]],
  ["Andre", "Williams", ["Rigger"]],
  ["Hannah", "Kowalski", ["Rigger", "Stagehand"]],
  ["Malik", "Johnson", ["Forklift Driver", "Truck Loader"]],
  ["Rosa", "Delgado", ["Stagehand"]],
  ["Ethan", "Park", ["Stagehand", "Video"]],
  ["Grace", "Okafor", ["Stagehand", "Carpenter"]],
  ["Tyler", "Brennan", ["Forklift Driver"]],
  ["Nina", "Sorensen", ["Stagehand", "Lighting"]],
  ["Chris", "Delaney", ["Truck Loader", "Stagehand"]],
  ["Imani", "Scott", ["Stagehand"]],
  ["Luke", "Harrison", ["Rigger", "Forklift Driver"]],
  ["Maya", "Chen", ["Stagehand", "Audio"]],
];
const W = {};
for (const [first, last, rs] of people) {
  const email = `${first}.${last}@crew.example`.toLowerCase();
  const r = await api(admin, "POST", "/admin/workers", { first_name: first, last_name: last, email, phone: `555-01${String(Object.keys(W).length + 10).padStart(2, "0")}`, role_ids: rs.map((n) => R[n]), password: CREW_PASSWORD });
  W[first] = { id: r.id, email, token: await login(email, CREW_PASSWORD) };
}
await api(admin, "PUT", `/admin/clients/${northstar}/flags/${W.Kim.id}`, { flag: "preferred" });
await api(admin, "PUT", `/admin/clients/${northstar}/flags/${W.Chris.id}`, { flag: "banned" });

// A certification expiring soon, to show on the dashboard
{
  const fd = new FormData();
  fd.append("file", new Blob(["Forklift operator certification (demo)"], { type: "text/plain" }), "forklift-cert.txt");
  fd.append("title", "OSHA forklift operator certification");
  fd.append("kind", "certification");
  fd.append("expires_on", ymd(12));
  await fetch(`${BASE}/admin/workers/${W.Tyler.id}/documents`, { method: "POST", headers: { authorization: `Bearer ${admin}` }, body: fd });
}

const accept = async (who, callId) => {
  const offer = (await api(W[who].token, "GET", "/me/offers")).find((o) => o.call_id === callId);
  if (offer) await api(W[who].token, "POST", `/me/assignments/${offer.assignment_id}/accept`);
};
const pos = (job, callIdx, role) => job.calls[callIdx].positions.find((p) => p.role_id === R[role]);

// --- Job 1: finished last week, approved and ready to bill
const past = ymd(-6);
const j1 = (await api(admin, "POST", "/admin/jobs", {
  name: "Monster Truck Rally at SoFi Stadium", client_id: bluewave, venue_id: sofi, notes: "Steel-toe boots required. Park in Lot L.",
  rates: [{ role_id: R.Steward, pay_rate: 42 }, { role_id: R.Stagehand, pay_rate: 28 }, { role_id: R["Forklift Driver"], pay_rate: 34 }],
  calls: [{ name: "Load-in", call_date: past, start_time: "07:00", end_time: "15:00", positions: [{ role_id: R.Steward, quantity: 1 }, { role_id: R.Stagehand, quantity: 4 }, { role_id: R["Forklift Driver"], quantity: 1 }] }],
})).id;
let job1 = await api(admin, "GET", `/admin/jobs/${j1}`);
const c1 = job1.calls[0].id;
await api(admin, "POST", `/admin/positions/${pos(job1, 0, "Steward").id}/offers`, { worker_ids: [W.Tanya.id], direct: true });
await api(admin, "POST", `/admin/positions/${pos(job1, 0, "Stagehand").id}/offers`, { worker_ids: [W.Jordan.id, W.Devon.id, W.Rosa.id, W.Ethan.id] });
await api(admin, "POST", `/admin/positions/${pos(job1, 0, "Forklift Driver").id}/offers`, { worker_ids: [W.Malik.id] });
for (const who of ["Jordan", "Devon", "Rosa", "Ethan", "Malik"]) await accept(who, c1);
const steward1 = W.Tanya.token;
await api(steward1, "POST", `/calls/${c1}/start`);
const times = { Tanya: ["06:45", "15:30"], Jordan: ["06:55", "15:15"], Devon: ["07:12", "15:15"], Rosa: ["06:58", "13:00"], Malik: ["06:50", "15:20"] };
for (const [who, [i, o]] of Object.entries(times)) {
  await api(steward1, "PATCH", `/calls/${c1}/workers/${W[who].id}`, { clock_in: at(past, i), clock_out: at(past, o) });
}
await api(steward1, "PATCH", `/calls/${c1}/workers/${W.Ethan.id}`, { no_show: true });
await api(steward1, "POST", `/calls/${c1}/messages?thread=group`, { body: "Morning crew — meet at the north tunnel. Coffee on the dock." });
await api(steward1, "POST", `/calls/${c1}/end`, { clock_out_remaining: true });
await api(steward1, "POST", `/calls/${c1}/sign-off`);
await api(admin, "POST", `/admin/calls/${c1}/approve`);

// --- Job 2: upcoming, multi-call, partly staffed with offers out
const d1 = ymd(2), d2 = ymd(3), d3 = ymd(4);
const j2 = (await api(admin, "POST", "/admin/jobs", {
  name: "Bruce Springsteen at MSG", client_id: northstar, venue_id: msg, notes: "Blacks required. Check in with the Steward at the 33rd St dock.",
  rates: [{ role_id: R.Steward, pay_rate: 48 }, { role_id: R.Stagehand, pay_rate: 32 }, { role_id: R.Rigger, pay_rate: 45 }, { role_id: R["Forklift Driver"], pay_rate: 36 }],
  calls: [
    { name: "Load-in", call_date: d1, start_time: "08:00", end_time: "18:00", positions: [{ role_id: R.Steward, quantity: 1 }, { role_id: R.Rigger, quantity: 3 }, { role_id: R.Stagehand, quantity: 6 }, { role_id: R["Forklift Driver"], quantity: 2 }] },
    { name: "Show", call_date: d2, start_time: "16:00", end_time: "23:30", positions: [{ role_id: R.Steward, quantity: 1 }, { role_id: R.Stagehand, quantity: 4 }] },
    { name: "Load-out", call_date: d3, start_time: "23:00", positions: [{ role_id: R.Steward, quantity: 1 }, { role_id: R.Rigger, quantity: 2 }, { role_id: R.Stagehand, quantity: 6 }, { role_id: R["Forklift Driver"], quantity: 2 }] },
  ],
})).id;
const job2 = await api(admin, "GET", `/admin/jobs/${j2}`);
const loadIn = job2.calls[0].id;
await api(admin, "POST", `/admin/positions/${pos(job2, 0, "Steward").id}/offers`, { worker_ids: [W.Marcus.id], direct: true });
await api(admin, "POST", `/admin/positions/${pos(job2, 0, "Rigger").id}/offers`, { all: true });
await api(admin, "POST", `/admin/positions/${pos(job2, 0, "Stagehand").id}/offers`, { all: true });
await api(admin, "POST", `/admin/positions/${pos(job2, 0, "Forklift Driver").id}/offers`, { all: true });
for (const who of ["Andre", "Hannah", "Kim", "Sofia", "Grace", "Nina", "Imani", "Tyler"]) await accept(who, loadIn);
await api(W.Rosa.token, "POST", `/me/assignments/${(await api(W.Rosa.token, "GET", "/me/offers")).find((o) => o.call_id === loadIn).assignment_id}/decline`);
await api(admin, "POST", `/admin/positions/${pos(job2, 1, "Steward").id}/offers`, { worker_ids: [W.Marcus.id], direct: true });
await api(admin, "POST", `/admin/positions/${pos(job2, 1, "Stagehand").id}/offers`, { all: true });
await api(W.Marcus.token, "POST", `/calls/${loadIn}/messages?thread=group`, { body: "See everyone Thursday 8am sharp. Bring gloves." });

// --- Job 3: today, ready for the Steward to start from the phone
const today = ymd(0);
const j3 = (await api(admin, "POST", "/admin/jobs", {
  name: "Corporate Gala at MSG Theater", client_id: northstar, venue_id: msg,
  rates: [{ role_id: R.Steward, pay_rate: 45 }, { role_id: R.Stagehand, pay_rate: 30 }],
  calls: [{ name: "Set", call_date: today, start_time: "09:00", end_time: "17:00", positions: [{ role_id: R.Steward, quantity: 1 }, { role_id: R.Stagehand, quantity: 3 }] }],
})).id;
const job3 = await api(admin, "GET", `/admin/jobs/${j3}`);
const c3 = job3.calls[0].id;
await api(admin, "POST", `/admin/positions/${pos(job3, 0, "Steward").id}/offers`, { worker_ids: [W.Marcus.id], direct: true });
await api(admin, "POST", `/admin/positions/${pos(job3, 0, "Stagehand").id}/offers`, { worker_ids: [W.Jordan.id, W.Maya.id, W.Devon.id], direct: true });

console.log(`Demo data loaded.
  Admin (web):        ${ADMIN.email} / ${ADMIN.password}
  Steward (phone):    marcus.reed@crew.example / ${CREW_PASSWORD}   (runs today's "Corporate Gala" call)
  Crew (phone):       jordan.alvarez@crew.example / ${CREW_PASSWORD}
  Has open offers:    rosa.delgado@crew.example, jordan.alvarez@crew.example / ${CREW_PASSWORD}`);
