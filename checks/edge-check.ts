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
  releaseOutlook,
  deiceProtection,
} from "../src/features/weather/lib/release";
import { serviceBlockReason } from "../src/features/services/lib/eligibility";
import type { Shift, ServiceKind } from "../src/shared/types";
const step = (s: Shift, dt: number) => advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);
const run = (s: Shift, sec: number, dt = 0.5) => { let c = s; for (let t = 0; t < sec; t += dt) c = step(c, dt); return c; };
const assert = (ok: boolean, label: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) process.exitCode = 1; };

// De-ice during the forecast window so its protection expires before icing clears.
let s = createShift();
const icing = s.weather[1];
console.log("icing forecast", icing.forecastFrom, "onset", icing.onsetAt, "clear", icing.clearsAt);
s = run(s, icing.forecastFrom + 2);
s = assignStand(s, "MU2451", "A03");
for (const v of s.vehicles) { v.position = { x: 690, y: 270 }; v.origin = { ...v.position }; v.target = { ...v.position }; }
s.services.filter(t => t.flightId === "MU2451" && t.kind !== "deice").forEach(t => t.duration = 1);
for (const kind of ["baggage","fuel"] as ServiceKind[]) {
  const v = s.vehicles.find(x => x.kind === kind && x.status === "idle")!;
  s = dispatchService(s, "MU2451", kind, v.id);
}
s = run(s, 10);
const cv = s.vehicles.find(x => x.kind === "clean" && x.status === "idle")!;
s = dispatchService(s, "MU2451", "clean", cv.id);
s = run(s, 10);
const dv = s.vehicles.find(x => x.kind === "deice" && x.status === "idle")!;
s = dispatchService(s, "MU2451", "deice", dv.id);
for (let i=0;i<400;i++){ s = step(s, 0.5); if (s.services.find(t=>t.flightId==="MU2451"&&t.kind==="deice")!.status==="done") break; }
const deice = s.services.find(t=>t.flightId==="MU2451"&&t.kind==="deice")!;
console.log("deice done", deice.completedAt, "protection", deice.protectionUntil, "icing clear", icing.clearsAt);
assert(deice.protectionUntil! < icing.clearsAt, "constructed case: protection ends before icing clears");
// Fast-forward until icing is active (no more work needed)
for (let i=0;i<400;i++){ s = step(s, 0.5); if (s.weather[1].status === "active") break; }
const f = s.flights.find(x=>x.id==="MU2451")!;
const outlook = releaseOutlook(s, f);
assert(outlook.wait !== undefined, "wait option available");
assert(outlook.risk === undefined || outlook.risk.chance > 0, "risk option reports a real chance");
const waited = chooseWaitRelease(s, "MU2451");
const plan = waited.flights.find(x=>x.id==="MU2451")!.releasePlan!;
const after = run(waited, (icing.clearsAt - waited.time) + 5);
const af = after.flights.find(x=>x.id==="MU2451")!;
console.log("after wait:", af.status, "time", after.time, "deice:", after.services.find(t=>t.flightId==="MU2451"&&t.kind==="deice")!.status);
assert(af.status === "parked", "expired protection prevents auto-release after weather clears");
assert(after.events.some(e => e.text.includes("除冰保护在等待中过期")), "expired protection during wait is explained");
const block = serviceBlockReason(after, "MU2451", "deice");
console.log("redispatch block reason:", block ?? "(none)");
assert(!block, "expired de-icing can be dispatched again");

// Interrupted task requires explicit redispatch after weather clears
let t = createShift();
t = assignStand(t, "MU2451", "A03");
t.services.find(x=>x.flightId==="MU2451"&&x.kind==="fuel")!.duration = 500;
const fv = t.vehicles.find(x=>x.kind==="fuel"&&x.status==="idle")!;
t = dispatchService(t, "MU2451", "fuel", fv.id);
t = run(t, t.weather[0].onsetAt - t.time + 20);
const mid = t.services.find(x=>x.flightId==="MU2451"&&x.kind==="fuel")!;
const prog = mid.progress;
console.log("fuel after onset:", mid.status, Math.round(prog), "vehicle:", t.vehicles.find(v=>v.id===fv.id)!.status);
t = run(t, t.weather[0].clearsAt - t.time + 30);
const post = t.services.find(x=>x.flightId==="MU2451"&&x.kind==="fuel")!;
console.log("fuel after clear:", post.status, Math.round(post.progress), "vehicle:", t.vehicles.find(v=>v.id===fv.id)!.status);
assert(post.status === "interrupted" && Math.abs(post.progress - prog) < 0.001, "work stays interrupted with retained progress after weather clears");
const re = dispatchService(t, "MU2451", "fuel", fv.id);
const retask = re.services.find(x=>x.flightId==="MU2451"&&x.kind==="fuel")!;
assert(retask.status === "travel" && Math.abs(retask.progress - prog) < 0.001, "redispatch resumes from retained progress");
