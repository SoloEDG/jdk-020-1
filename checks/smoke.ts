// End-to-end-ish: run the same reducer pipeline the UI uses while issuing
// decisions at plausible moments, then validate and serialize the result.
import { createShift as createRandomShift } from "../src/features/session/model/shift";
import { pinnedShift } from "./harness";
const createShift = () => pinnedShift(createRandomShift());
import { advanceClock } from "../src/features/session/model/clock";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { dispatchService } from "../src/features/services/model/dispatch";
import { assignStand, departFlight } from "../src/features/flights/model/commands";
import {
  releaseOutlook,
  releaseBlockReason,
  chooseWaitRelease,
} from "../src/features/weather/lib/release";
import { serviceBlockReason } from "../src/features/services/lib/eligibility";
import { standAvailability } from "../src/features/weather/lib/impact";
import { validShift } from "../src/features/session/lib/validation";
import type { Shift } from "../src/shared/types";

const step = (s: Shift, dt: number) => advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);

function policy(s: Shift): Shift {
  // Stand assignment for incoming flights on any weather-open compatible stand.
  for (const f of s.flights) {
    if (f.status !== "incoming") continue;
    const stand = s.stands.find(
      (st) => standAvailability(s, st).available && !s.flights.some(o => o.standId === st.id && o.status !== "departed") && (f.size === "narrow" || st.size === "wide"),
    );
    if (stand) s = assignStand(s, f.id, stand.id);
  }
  // Dispatch any legal service when a matching idle vehicle exists.
  for (const t of s.services) {
    if (t.status !== "pending" && t.status !== "interrupted") continue;
    if (serviceBlockReason(s, t.flightId, t.kind)) continue;
    const v = s.vehicles.find(v => v.kind === t.kind && v.status === "idle");
    if (v) s = dispatchService(s, t.flightId, t.kind, v.id);
  }
  // Conservative release when possible, otherwise try direct approval.
  for (const f of s.flights) {
    if (f.status !== "parked") continue;
    const o = releaseOutlook(s, f);
    if (o.wait) { s = chooseWaitRelease(s, f.id); continue; }
    if (releaseBlockReason(s, f)) continue;
    s = departFlight(s, f.id);
  }
  return s;
}

let s = createShift();
let decisions = 0;
for (let i = 0; i < 1800; i++) {
  const before = s;
  s = step(s, 0.5);
  if (i % 10 === 0) {
    s = policy(s);
    if (s !== before) decisions++;
  }
  if (!validShift(JSON.parse(JSON.stringify(s)))) {
    console.log("FAIL  invalid state at", s.time);
    process.exit(1);
  }
}
const departed = s.flights.filter(f => f.status === "departed" || f.status === "departing").length;
console.log("PASS  soak with automatic policy: 900s, decisions", decisions, "departed/departing", departed, "/6, score", s.score, "conflicts", s.conflicts);
console.log("PASS  final state savable:", validShift(JSON.parse(JSON.stringify(s))));
console.log("  weather:", s.weather.map(w => `${w.id}:${w.status}`).join(" "));
console.log("  task states:", s.services.map(t => t.status).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {} as Record<string, number>));
console.log("  vehicles:", s.vehicles.map(v => v.status).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {} as Record<string, number>));
console.log("  final statuses:", s.flights.map(f => `${f.id}:${f.status}`).join(" "));
