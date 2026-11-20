import type { Shift, WeatherEvent } from "../src/shared/types";

/** A fixed weather script so behaviour checks do not depend on the random seed. */
export function pinnedShift(base: Shift): Shift {
  const s = structuredClone(base);
  s.weatherSeed = 0x5a17c0de;
  const storm: WeatherEvent = {
    id: "W1",
    kind: "storm",
    title: "雷雨单体过境",
    forecastFrom: 90,
    onsetRange: [190, 250],
    durationRange: [95, 135],
    onsetAt: 203,
    clearsAt: 318,
    status: "forecast",
    forecastIssued: false,
    onsetApplied: false,
    clearApplied: false,
    severity: 2,
    from: { x: 1100, y: 120 },
    to: { x: -160, y: 470 },
    radius: 244,
    radiusRange: [200, 250],
  };
  const icing: WeatherEvent = {
    id: "W2",
    kind: "icing",
    title: "低温结冰",
    forecastFrom: 330,
    onsetRange: [420, 470],
    durationRange: [110, 150],
    onsetAt: 450,
    clearsAt: 567,
    status: "forecast",
    forecastIssued: false,
    onsetApplied: false,
    clearApplied: false,
    severity: 2,
    radius: 0,
    radiusRange: [0, 0],
  };
  s.weather = [storm, icing];
  return s;
}
