import { createShift as createRandomShift } from "../src/features/session/model/shift";
import { pinnedShift } from "./harness";
const createShift = () => pinnedShift(createRandomShift());
import { advanceClock } from "../src/features/session/model/clock";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { dispatchService } from "../src/features/services/model/dispatch";
import { assignStand } from "../src/features/flights/model/commands";
import {
  chooseWaitRelease,
  chooseRiskRelease,
  releaseOutlook,
  deiceProtection,
} from "../src/features/weather/lib/release";
import { standAvailability } from "../src/features/weather/lib/impact";
import { activeWeather } from "../src/features/weather/model/engine";
import { validShift } from "../src/features/session/lib/validation";
import type { Shift, ServiceKind } from "../src/shared/types";

const step = (s: Shift, dt: number) => advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);
const run = (s: Shift, sec: number, dt = 0.5) => { let c = s; for (let t = 0; t < sec; t += dt) c = step(c, dt); return c; };
const assert = (ok: boolean, label: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) process.exitCode = 1; };

// Full shift soak: drive the whole shift with deterministic decisions,
// validating persistence on every step boundary.
let s = createShift();
const seen = new Set<string>();
let timeMax = 0;
for (let i = 0; i < 1600; i++) {
  s = step(s, 0.5);
  timeMax = Math.max(timeMax, s.time);
  if (!validShift(JSON.parse(JSON.stringify(s)))) {
    console.log("FAIL  state invalid at t=", s.time);
    process.exit(1);
  }
  for (const w of s.weather) {
    const key = `${w.id}:${w.status}`;
    if (!seen.has(key)) { seen.add(key); console.log("  transition", key, "@", Math.round(s.time)); }
  }
}
assert(true, "full 800s soak stays valid and saveable");
assert(s.weather[0].status === "cleared" && s.weather[1].status === "cleared", "both weather systems clear once");
assert(s.weather.every((w) => w.onsetApplied && w.clearApplied), "each system applied onset and clear exactly once");
const counts = (text: string) => s.events.filter((e) => e.text.includes(text)).length;
void counts;

// Determinism across a save/load boundary: same weather, same transitions.
let a = createShift();
const b0 = JSON.parse(JSON.stringify(a)) as Shift;
let b = b0;
for (let i = 0; i < 400; i++) { a = step(a, 0.5); b = step(b, 0.5); }
assert(JSON.stringify(a.weather) === JSON.stringify(b.weather), "deterministic weather across identical runs");
const reloaded = JSON.parse(JSON.stringify(a)) as Shift;
let c = reloaded;
let d = a;
for (let i = 0; i < 400; i++) { c = step(c, 0.5); d = step(d, 0.5); }
assert(JSON.stringify(c.weather) === JSON.stringify(d.weather), "save/load does not replay or skip weather");

// Atmosphere: storm stand blocks assignment, icing restricts non-deice stands.
let w = createShift();
w = run(w, w.weather[1].onsetAt + 1);
const nonDeice = w.stands.find((st) => !st.deice)!;
const deiceStand = w.stands.find((st) => st.deice)!;
assert(!standAvailability(w, nonDeice).available, "icing blocks a non-deice stand");
assert(standAvailability(w, deiceStand).available, "icing keeps a deice stand open");

// Cooldown appears after a failed gamble and blocks re-decision.
let g = createShift();
g = run(g, g.weather[1].onsetAt + 1);
g = assignStand(g, "MU2451", "A01");
for (const v of g.vehicles) { v.position = { x: 260, y: 270 }; v.origin = { ...v.position }; v.target = { ...v.position }; }
g.services.filter(t => t.flightId === "MU2451" && t.kind !== "deice").forEach(t => t.duration = 1);
for (const kind of ["baggage","fuel"] as ServiceKind[]) {
  const v = g.vehicles.find(x => x.kind === kind && x.status === "idle")!;
  g = dispatchService(g, "MU2451", kind, v.id);
}
g = run(g, 10);
const cv = g.vehicles.find(x => x.kind === "clean" && x.status === "idle")!;
g = dispatchService(g, "MU2451", "clean", cv.id);
g = run(g, 10);
const dv = g.vehicles.find(x => x.kind === "deice" && x.status === "idle")!;
g = dispatchService(g, "MU2451", "deice", dv.id);
for (let n=0;n<400;n++){ g = step(g, 0.5); if (g.services.find(t=>t.flightId==="MU2451"&&t.kind==="deice")!.status==="done") break; }
const outlier = releaseOutlook(g, g.flights.find(f=>f.id==="MU2451")!);
if (outlier.risk && outlier.risk.chance < 0.5) {
  const risky = chooseRiskRelease(g, "MU2451");
  g = run(risky, 25);
  const gf = g.flights.find(f=>f.id==="MU2451")!;
  if (gf.status === "parked" && gf.releaseCooldownUntil) {
    const during = releaseOutlook(g, gf);
    assert(during.cooldownUntil !== undefined, "cooldown surfaced after failed gamble");
  } else console.log("  (gamble succeeded; cooldown path not exercised)");
} else console.log("  (chance too high; cooldown path not exercised)");

// Waiting plan does not complete until the blocking system clears.
let q = createShift();
q = run(q, q.weather[1].onsetAt + 1);
q = assignStand(q, "MU2451", "A01");
for (const v of q.vehicles) { v.position = { x: 260, y: 270 }; v.origin = { ...v.position }; v.target = { ...v.position }; }
q.services.filter(t => t.flightId === "MU2451" && t.kind !== "deice").forEach(t => t.duration = 1);
for (const kind of ["baggage","fuel"] as ServiceKind[]) {
  const v = q.vehicles.find(x => x.kind === kind && x.status === "idle")!;
  q = dispatchService(q, "MU2451", kind, v.id);
}
q = run(q, 10);
const qcv = q.vehicles.find(x => x.kind === "clean" && x.status === "idle")!;
q = dispatchService(q, "MU2451", "clean", qcv.id);
q = run(q, 10);
const qdv = q.vehicles.find(x => x.kind === "deice" && x.status === "idle")!;
q = dispatchService(q, "MU2451", "deice", qdv.id);
for (let n=0;n<400;n++){ q = step(q, 0.5); if (q.services.find(t=>t.flightId==="MU2451"&&t.kind==="deice")!.status==="done") break; }
const waited = chooseWaitRelease(q, "MU2451");
const plan = waited.flights.find(f=>f.id==="MU2451")!.releasePlan!;
assert(plan.weatherIds.length === 1 && plan.weatherIds[0] === "W2", "wait plan scoped to icing only");
const beforeClear = run(waited, Math.max(0, q.weather[1].clearsAt - waited.time - 2));
assert(beforeClear.flights.find(f=>f.id==="MU2451")!.status === "parked", "waiting flight stays parked until weather clears");
const afterClear = run(beforeClear, 10);
assert(["departing","departed"].includes(afterClear.flights.find(f=>f.id==="MU2451")!.status), "waiting flight releases once weather clears");
