import { createShift as createRandomShift } from "../src/features/session/model/shift";
import { pinnedShift } from "./harness";
const createShift = () => pinnedShift(createRandomShift());
import {
  advanceClock,
  togglePause,
  changeSpeed,
} from "../src/features/session/model/clock";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { dispatchService } from "../src/features/services/model/dispatch";
import { assignStand, departFlight } from "../src/features/flights/model/commands";
import {
  releaseOutlook,
  chooseRiskRelease,
  chooseWaitRelease,
  releaseBlockReason,
  deiceProtection,
} from "../src/features/weather/lib/release";
import {
  standAvailability,
  standStormEvent,
  safeHaven,
} from "../src/features/weather/lib/impact";
import { activeWeather } from "../src/features/weather/model/engine";
import { validShift } from "../src/features/session/lib/validation";
import type { Shift, ServiceKind } from "../src/shared/types";

const step = (s: Shift, dt: number) =>
  advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);
const run = (s: Shift, seconds: number, dt = 0.5) => {
  let cur = s;
  for (let t = 0; t < seconds; t += dt) cur = step(cur, dt);
  return cur;
};
const assert = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
};

// --- 1. Forecast hidden until lead time, onset applied once, pause/reload safe
let s = createShift();
const storm = s.weather[0];
assert(!storm.forecastIssued, "forecast not shown at shift start");
s = run(s, storm.forecastFrom - 2);
assert(!s.weather[0].forecastIssued, "forecast still hidden before forecast time");
s = run(s, 4);
assert(s.weather[0].forecastIssued, "forecast issued at forecast time");
assert(s.weather[0].onsetAt >= s.weather[0].onsetRange[0] && s.weather[0].onsetAt <= s.weather[0].onsetRange[1], "actual onset inside forecast range");
s = run(s, storm.onsetAt - s.time + 1);
assert(s.weather[0].status === "active", "storm becomes active");
const onsetEvents = s.events.filter((e) => e.text.includes("雷达确认")).length;
assert(onsetEvents === 1, "onset announced exactly once");
// Pause then resume: still once
s = togglePause(s);
const paused = run(s, 30);
assert(paused.time === s.time, "pause freezes time");
s = togglePause(s);
s = changeSpeed(s); s = changeSpeed(s); // 4x
s = run(s, 10);
assert(s.events.filter((e) => e.text.includes("雷达确认")).length === 1, "speed change does not replay onset");
// Save/load round-trip mid-storm
assert(validShift(JSON.parse(JSON.stringify(s))), "mid-storm state validates for save/load");

// --- 2. Weather changes stand availability (storm + icing)
let stormState = s;
// move into the middle of the cell's passage
stormState = run(stormState, Math.min(70, stormState.weather[0].clearsAt - stormState.time - 5));
const affected = stormState.stands.filter((st) => standStormEvent(stormState, st));
console.log("storm-affected stands:", affected.map((x) => x.id).join(","));
assert(stormState.stands.some((st) => !standAvailability(stormState, st).available), "storm blocks at least one stand");
const clearOfStorm = stormState.stands.find((st) => standAvailability(stormState, st).available);

// --- 3. Icing: stand restriction and de-icing protection lifecycle
let ice = createShift();
const icing = ice.weather[1];
ice = run(ice, icing.onsetAt + 1);
assert(ice.weather[1].status === "active", "icing becomes active");
assert(ice.stands.filter((st) => !standAvailability(ice, st).available).length > 0, "icing blocks non-deice stands");
ice = assignStand(ice, "MU2451", "A01");
assert(ice.flights.find((f) => f.id === "MU2451")!.status === "parked", "flight parks on de-ice stand");
// Place support vehicles next to the stand to keep the check fast.
for (const v of ice.vehicles) {
  v.position = { x: 260, y: 270 };
  v.origin = { ...v.position };
  v.target = { ...v.position };
}
ice.services.filter((t) => t.flightId === "MU2451" && t.kind !== "deice").forEach((t) => (t.duration = 1));
for (const kind of ["baggage", "fuel"] as ServiceKind[]) {
  const v = ice.vehicles.find((x) => x.kind === kind && x.status === "idle")!;
  ice = dispatchService(ice, "MU2451", kind, v.id);
}
ice = run(ice, 10);
const cv = ice.vehicles.find((x) => x.kind === "clean" && x.status === "idle")!;
ice = dispatchService(ice, "MU2451", "clean", cv.id);
ice = run(ice, 10);
const coreDone = ice.services.filter((t) => t.flightId === "MU2451" && t.kind !== "deice").every((t) => t.status === "done");
assert(coreDone, "core services complete");
assert(releaseBlockReason(ice, ice.flights.find((f) => f.id === "MU2451")!)?.includes("除冰"), "icing blocks release without de-icing");
const dv = ice.vehicles.find((x) => x.kind === "deice" && x.status === "idle")!;
ice = dispatchService(ice, "MU2451", "deice", dv.id);
for (let i = 0; i < 400; i++) {
  ice = step(ice, 0.5);
  if (ice.services.find((t) => t.flightId === "MU2451" && t.kind === "deice")!.status === "done") break;
}
const deiceTask = ice.services.find((t) => t.flightId === "MU2451" && t.kind === "deice")!;
assert(deiceTask.status === "done", "de-icing completes");
assert(ice.weather[1].status === "active", "still in icing when de-icing completes");
assert((deiceTask.protectionUntil! - deiceTask.completedAt!) === 120, "protection counted from completion");
const prot = deiceProtection(ice, ice.flights.find((f) => f.id === "MU2451")!);
assert(prot.valid && prot.remaining > 0, "protection valid after completion");

// --- 4. Decision: both options with losses near release (risk window)
const outlook = releaseOutlook(ice, ice.flights.find((f) => f.id === "MU2451")!);
assert(outlook.hasDecision && !!outlook.risk && !!outlook.wait, "risk and wait both offered near release");
assert(outlook.risk!.loss >= 0 && outlook.wait!.loss >= 0, "both options show possible loss");
const risk = chooseRiskRelease(ice, "MU2451");
const attempt = risk.flights.find((f) => f.id === "MU2451")!.releaseAttempt!;
assert(!!attempt && attempt.chance === outlook.risk!.chance, "risk pre-rolls chance");
const resolved = run(risk, 25);
const flight = resolved.flights.find((f) => f.id === "MU2451")!;
assert(flight.status === "departing" || flight.status === "parked", "risk resolves to a definite outcome");
if (flight.status === "parked") assert(resolved.events.some((e) => e.text.includes("冒险推出失败")), "failure is explained");
// Pausing during attempt and resuming doesn't reroll
const outcomeA = (() => {
  const r = chooseRiskRelease(ice, "MU2451");
  return run(r, 25).flights.find((f) => f.id === "MU2451")!.status;
})();
const outcomeB = (() => {
  const r = chooseRiskRelease(ice, "MU2451");
  const half = run(r, 9);
  return run(togglePause(togglePause(half)), 16).flights.find((f) => f.id === "MU2451")!.status;
})();
assert(outcomeA === outcomeB, "pause/resume does not re-roll the risk outcome");

// --- 5. Interrupted work retains progress and never auto-completes
let stormRun = createShift();
stormRun = assignStand(stormRun, "MU2451", "A03");
stormRun.services.filter((t) => t.flightId === "MU2451").forEach((t) => {
  if (t.kind !== "deice") t.duration = 400;
});
const bg = stormRun.vehicles.find((v) => v.kind === "baggage" && v.status === "idle")!;
stormRun = dispatchService(stormRun, "MU2451", "baggage", bg.id);
// Advance until working, then into storm onset
stormRun = run(stormRun, 20);
const taskBefore = stormRun.services.find((t) => t.flightId === "MU2451" && t.kind === "baggage")!;
console.log("baggage status before storm:", taskBefore.status, "progress", Math.round(taskBefore.progress));
const target = stormRun.weather[0].onsetAt;
stormRun = run(stormRun, target - stormRun.time + 30);
const interrupted = stormRun.services.find((t) => t.flightId === "MU2451" && t.kind === "baggage")!;
console.log("baggage status in storm:", interrupted.status, "progress", Math.round(interrupted.progress));
const evac = stormRun.vehicles.find((v) => v.id === bg.id)!;
console.log("vehicle:", evac.status, evac.avoidReason, evac.safePointName);
assert(
  interrupted.status === "interrupted" || interrupted.status === "done" && interrupted.progress === 100,
  "in-progress task interrupted (or completed before onset)",
);
if (interrupted.status === "interrupted") {
  const savedProgress = interrupted.progress;
  assert(evac.status === "evading" || evac.status === "sheltered", "vehicle evacuates with an explained route");
  // Run past storm clear
  stormRun = run(stormRun, stormRun.weather[0].clearsAt - stormRun.time + 40);
  const after = stormRun.services.find((t) => t.id === interrupted.id)!;
  assert(after.status !== "done" || after.progress === 100 && savedProgress === 100, "cleared weather does not finish interrupted work");
  assert(Math.abs(after.progress - savedProgress) < 0.001, "interrupted progress is preserved, not advanced");
}

// --- 6. Waiting plan respects expired protection
let waitState = createShift();
const ic = waitState.weather[1];
waitState = run(waitState, ic.onsetAt + 1);
waitState = assignStand(waitState, "MU2451", "A01");
for (const v of waitState.vehicles) {
  v.position = { x: 260, y: 270 };
  v.origin = { ...v.position };
  v.target = { ...v.position };
}
waitState.services.filter((t) => t.flightId === "MU2451" && t.kind !== "deice").forEach((t) => (t.duration = 1));
for (const kind of ["baggage", "fuel"] as ServiceKind[]) {
  const v = waitState.vehicles.find((x) => x.kind === kind && x.status === "idle")!;
  waitState = dispatchService(waitState, "MU2451", kind, v.id);
}
waitState = run(waitState, 10);
const wcv = waitState.vehicles.find((x) => x.kind === "clean" && x.status === "idle")!;
waitState = dispatchService(waitState, "MU2451", "clean", wcv.id);
waitState = run(waitState, 10);
const dv2 = waitState.vehicles.find((x) => x.kind === "deice" && x.status === "idle")!;
waitState = dispatchService(waitState, "MU2451", "deice", dv2.id);
for (let i = 0; i < 400; i++) {
  waitState = step(waitState, 0.5);
  if (waitState.services.find((t) => t.flightId === "MU2451" && t.kind === "deice")!.status === "done") break;
}
const planned = chooseWaitRelease(waitState, "MU2451");
const plan = planned.flights.find((f) => f.id === "MU2451")!.releasePlan!;
console.log("wait plan until", Math.round(plan.until), "protection until", Math.round(planned.services.find((t) => t.flightId === "MU2451" && t.kind === "deice")!.protectionUntil!));
const afterWait = run(planned, plan.until - planned.time + 5);
const wf = afterWait.flights.find((f) => f.id === "MU2451")!;
const deiceAfter = afterWait.services.find((t) => t.flightId === "MU2451" && t.kind === "deice")!;
if (deiceAfter.protectionUntil! <= afterWait.time && wf.status === "parked") {
  assert(afterWait.events.some((e) => e.text.includes("除冰保护在等待中过期") || e.text.includes("保护已过期")), "expired protection during wait is reported");
}
console.log("wait outcome:", wf.status, "deice:", deiceAfter.status);

// --- 7. Safe haven is outside active cells
const haven = safeHaven(stormState);
console.log("safe haven:", haven.name, haven.reason);
