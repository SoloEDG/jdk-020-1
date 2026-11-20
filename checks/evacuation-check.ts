import { createShift as createRandomShift } from "../src/features/session/model/shift";
import { pinnedShift } from "./harness";
import { advanceClock } from "../src/features/session/model/clock";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { dispatchService } from "../src/features/services/model/dispatch";
import { assignStand } from "../src/features/flights/model/commands";
import { vehicleInStorm, safeHaven } from "../src/features/weather/lib/impact";
import type { Shift } from "../src/shared/types";
const createShift = () => pinnedShift(createRandomShift());
const step = (s: Shift, dt: number) => advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);
const run = (s: Shift, sec: number, dt = 0.5) => { let c = s; for (let t = 0; t < sec; t += dt) c = step(c, dt); return c; };
const assert = (ok: boolean, label: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) process.exitCode = 1; };

let s = createShift();
s = assignStand(s, "MU2451", "A03");
s.services.filter(t => t.flightId === "MU2451" && t.kind !== "deice").forEach(t => (t.duration = 900));
const v = s.vehicles.find(x => x.kind === "fuel" && x.status === "idle")!;
s = dispatchService(s, "MU2451", "fuel", v.id);
s = run(s, s.weather[0].onsetAt + 20);
const evac = s.vehicles.find(x => x.id === v.id)!;
assert(evac.status === "evading" || evac.status === "sheltered", "vehicle leaves the storm area");
const evacEvents = s.events.filter(e => e.text.includes(v.id) && (e.text.includes("避险") || e.text.includes("撤离")));
assert(evacEvents.length >= 1, "evacuation reason is logged");
assert(evac.avoidReason !== undefined || evac.status === "sheltered", "evacuation reason attached to vehicle");

// Every 5 simulated seconds, an evacuating vehicle must make progress or be
// parked at shelter. It must never be stuck mid-route for long.
let last = evac.position, lastT = s.time, maxStall = 0;
let cur = s;
for (let i = 0; i < 200; i++) {
  cur = step(cur, 0.5);
  const cv = cur.vehicles.find(x => x.id === v.id)!;
  if (cv.status === "evading") {
    const moved = Math.hypot(cv.position.x - last.x, cv.position.y - last.y);
    if (moved < 0.01) maxStall = Math.max(maxStall, cur.time - lastT);
    else { last = cv.position; lastT = cur.time; }
  } else { last = cv.position; lastT = cur.time; }
}
assert(maxStall < 6, `evacuating vehicle never stalls (max stall ${maxStall.toFixed(1)}s)`);

// All shelters are inside the cell at some point; ensure no infinite loop and
// that the "all shelters affected" case is explained rather than silent.
const haven = safeHaven(cur);
console.log("  current safest haven:", haven.name, "|", haven.reason);
const stuck = cur.vehicles.filter(vv => vv.status === "evading" && vehicleInStorm(cur, vv.position) && vehicleInStorm(cur, vv.target));
if (stuck.length) {
  console.log("  stuck vehicles:", stuck.map(x => x.id).join(","));
  assert(cur.events.some(e => e.text.includes("所有避险区")), "all-shelters-stormed case is explained");
} else {
  assert(true, "no vehicle stranded inside a storm at checkpoints");
}
const end = run(cur, 120);
assert(end.vehicles.every(vv => vv.status === "idle"), "after the storm all crews return to standby");
