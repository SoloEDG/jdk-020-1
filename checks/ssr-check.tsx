import React from "react";
import { renderToString } from "react-dom/server";
import { createShift as createRandomShift } from "../src/features/session/model/shift";
import { pinnedShift } from "./harness";
import { advanceClock } from "../src/features/session/model/clock";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { dispatchService } from "../src/features/services/model/dispatch";
import { assignStand } from "../src/features/flights/model/commands";
import { ApronMap } from "../src/features/apron";
import { WeatherPanel, ReleaseDecision } from "../src/features/weather";
import { Inspector } from "../src/app/Inspector";
import { FlightBoard } from "../src/features/flights";
import { FleetPanel } from "../src/features/fleet";
import { ScoreStrip, SessionBar } from "../src/features/session";
import type { Shift, ServiceKind } from "../src/shared/types";

const createShift = () => pinnedShift(createRandomShift());

const step = (s: Shift, dt: number) => advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);
const run = (s: Shift, sec: number, dt = 0.5) => { let c = s; for (let t = 0; t < sec; t += dt) c = step(c, dt); return c; };
const noop = () => {};

function render(state: Shift, label: string) {
  const html = [
    renderToString(<SessionBar state={state} onPause={noop} onSpeed={noop} onSave={noop} onLoad={noop} onReset={noop} />),
    renderToString(<ScoreStrip state={state} />),
    renderToString(<WeatherPanel state={state} />),
    renderToString(<FlightBoard state={state} onSelect={noop} />),
    renderToString(<ApronMap state={state} onStand={noop} onFlight={noop} />),
    renderToString(<FleetPanel state={state} onSelect={noop} />),
    renderToString(<Inspector state={state} onChange={noop} onStand={noop} onAssign={noop} onDispatch={noop} />),
    renderToString(<ReleaseDecision state={state} onChange={noop} />),
  ].join("");
  console.log(`PASS  ${label} rendered (${html.length} chars)`);
  return html;
}

let s = createShift();
render(s, "initial shift");

// forecast issued + storm active
s = run(s, s.weather[0].forecastFrom + 2);
render(s, "storm forecast issued");
s = run(s, s.weather[0].onsetAt - s.time + 60);
const stormHtml = render(s, "storm active");
if (!stormHtml.includes("storm-cell")) console.log("FAIL  storm cell missing from map");
else console.log("PASS  storm cell rendered on map");

// icing decision state
let i = createShift();
i = run(i, i.weather[1].onsetAt + 1);
i = assignStand(i, "MU2451", "A01");
for (const v of i.vehicles) { v.position = { x: 260, y: 270 }; v.origin = { ...v.position }; v.target = { ...v.position }; }
i.services.filter(t => t.flightId === "MU2451" && t.kind !== "deice").forEach(t => t.duration = 1);
for (const kind of ["baggage","fuel"] as ServiceKind[]) {
  const v = i.vehicles.find(x => x.kind === kind && x.status === "idle")!;
  i = dispatchService(i, "MU2451", kind, v.id);
}
i = run(i, 10);
const cv = i.vehicles.find(x => x.kind === "clean" && x.status === "idle")!;
i = dispatchService(i, "MU2451", "clean", cv.id);
i = run(i, 10);
const dv = i.vehicles.find(x => x.kind === "deice" && x.status === "idle")!;
i = dispatchService(i, "MU2451", "deice", dv.id);
for (let n=0;n<400;n++){ i = step(i, 0.5); if (i.services.find(t=>t.flightId==="MU2451"&&t.kind==="deice")!.status==="done") break; }
const decisionHtml = render(i, "icing with de-ice protection");
if (!decisionHtml.includes("release-risk") || !decisionHtml.includes("release-wait"))
  console.log("FAIL  risk/wait buttons missing");
else console.log("PASS  both release choices rendered");
