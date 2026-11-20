import { createShift as createRandomShift } from "../src/features/session/model/shift";
import { pinnedShift } from "./harness";
const createShift = () => pinnedShift(createRandomShift());
import { advanceClock } from "../src/features/session/model/clock";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { dispatchService } from "../src/features/services/model/dispatch";
import { assignStand } from "../src/features/flights/model/commands";
import {
  releaseOutlook,
  advanceRelease,
  chooseRiskRelease,
  releaseBlockReason,
} from "../src/features/weather/lib/release";
import { standStormEvent } from "../src/features/weather/lib/impact";
import type { Shift, ServiceKind } from "../src/shared/types";

const step = (s: Shift, dt: number) => advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);
const run = (s: Shift, sec: number, dt = 0.5) => { let c = s; for (let t = 0; t < sec; t += dt) c = step(c, dt); return c; };
const assert = (ok: boolean, label: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) process.exitCode = 1; };
const noop = () => {};

function readyFlight(base: Shift, stand = "A01"): Shift {
  let s = assignStand(base, "MU2451", stand);
  const pad = s.stands.find((st) => st.id === stand)!;
  for (const v of s.vehicles) {
    v.position = { x: pad.x + 30, y: pad.y + 30 };
    v.origin = { ...v.position };
    v.target = { ...v.position };
  }
  s.services.filter(t => t.flightId === "MU2451" && t.kind !== "deice").forEach(t => t.duration = 1);
  for (const kind of ["baggage","fuel"] as ServiceKind[]) {
    const v = s.vehicles.find(x => x.kind === kind && x.status === "idle")!;
    s = dispatchService(s, "MU2451", kind, v.id);
  }
  s = run(s, 10);
  const cv = s.vehicles.find(x => x.kind === "clean" && x.status === "idle")!;
  s = dispatchService(s, "MU2451", "clean", cv.id);
  s = run(s, 10);
  return s;
}

// 1. Storm covering the stand: risk must be unavailable, wait must be offered.
// Build a fully-ready flight before the storm, then let the cell drift over it.
let s = createShift();
s = readyFlight(s, "A01");
const storm = s.weather[0];
while (!standStormEvent(s, s.stands.find(st => st.id === "A01")!) && s.time < storm.clearsAt) {
  s = step(s, 1);
}
console.log("  A01 covered at t", Math.round(s.time), "flight", s.flights.find(f=>f.id==="MU2451")!.status);
const covered = releaseBlockReason(s, s.flights.find(f => f.id === "MU2451")!);
const o1 = releaseOutlook(s, s.flights.find(f => f.id === "MU2451")!);
console.log("  storm cover block:", covered, "| hasDecision", o1.hasDecision, "risk", !!o1.risk, "wait", !!o1.wait);
assert(o1.hasDecision && !o1.risk && !!o1.wait, "storm over stand offers only a conservative wait");
assert(!!covered, "storm over stand blocks immediate departure");

// 2. Pre-onset window: both options with losses.
let p = createShift();
p = run(p, 150);
p = readyFlight(p, "A03");
p = run(p, 0);
const f2 = p.flights.find(f => f.id === "MU2451")!;
const o2 = releaseOutlook(p, f2);
console.log("  pre-onset outlook:", JSON.stringify(o2).slice(0, 240));
assert(o2.hasDecision && !!o2.risk && !!o2.wait, "pre-onset forecast offers both choices");
assert(o2.risk!.loss > 0 && o2.wait!.loss >= 0, "risk shows a possible penalty and delay loss");

// 3. Failed gamble: penalty, cooldown, no re-decision, explanation.
let g = p;
const risky = chooseRiskRelease(g, "MU2451");
const attempt = risky.flights.find(f => f.id === "MU2451")!.releaseAttempt!;
// Force the failure branch deterministically by moving the roll above the chance.
const forced = JSON.parse(JSON.stringify(risky)) as Shift;
const ff = forced.flights.find(f => f.id === "MU2451")!;
ff.releaseAttempt!.roll = Math.min(0.999, ff.releaseAttempt!.chance + 0.01);
forced.time = ff.releaseAttempt!.resolveAt;
const scoreBefore = forced.score;
const resolved = advanceRelease(forced);
const rf = resolved.flights.find(f => f.id === "MU2451")!;
console.log("  after failed roll:", rf.status, "cooldown", rf.releaseCooldownUntil, "score delta", resolved.score - scoreBefore);
assert(rf.status === "parked", "failed gamble keeps the aircraft on stand");
assert(resolved.score === scoreBefore - 25, "failed gamble applies the displayed penalty");
assert(!!rf.releaseCooldownUntil, "failed gamble enters cooldown");
assert(resolved.events.some(e => e.text.includes("冒险推出失败")), "failed gamble is explained in the log");
const blockedNow = releaseOutlook(resolved, rf);
assert(blockedNow.cooldownUntil !== undefined, "cooldown is surfaced to the decision panel");
assert(!!releaseBlockReason(resolved, rf), "cooldown blocks an immediate push");

// 4. Successful gamble on the same pre-rolled attempt.
const successForced = JSON.parse(JSON.stringify(risky)) as Shift;
const sf = successForced.flights.find(f => f.id === "MU2451")!;
sf.releaseAttempt!.roll = 0;
successForced.time = sf.releaseAttempt!.resolveAt;
const won = advanceRelease(successForced);
assert(won.flights.find(f => f.id === "MU2451")!.status === "departing", "successful gamble pushes the flight");
assert(won.events.some(e => e.text.includes("窗口内推出成功")), "successful gamble is explained");

// 5. No de-icing protection: risk unavailable, wait offered.
let n = createShift();
n = run(n, n.weather[1].onsetAt + 1);
n = readyFlight(n, "A01");
const nf = n.flights.find(f => f.id === "MU2451")!;
const o5 = releaseOutlook(n, nf);
console.log("  no-protection outlook:", o5.reason, "risk", !!o5.risk, "wait", !!o5.wait);
assert(!o5.risk && !!o5.wait && !!o5.reason, "without protection only waiting is offered, with a reason");
void noop;
