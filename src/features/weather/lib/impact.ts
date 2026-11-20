import type { Point, Shift, Stand, WeatherEvent } from "../../../shared/types";
import { activeWeather, isIcingActive, stormCenter } from "../model/engine";

/** Extra clearance around a storm cell for parked aircraft. */
export const STAND_STORM_MARGIN = 58;
/** A vehicle is treated as inside slightly before the cell reaches it. */
export const VEHICLE_STORM_MARGIN = 14;
export const DECISION_LEAD = 150;

export function stormAt(
  state: Shift,
  point: Point,
  margin = 0,
): WeatherEvent | undefined {
  return activeWeather(state, "storm").find((event) => {
    const centre = stormCenter(event, state.time);
    return (
      centre !== undefined &&
      Math.hypot(point.x - centre.x, point.y - centre.y) <=
        event.radius + margin
    );
  });
}

export function standStormEvent(
  state: Shift,
  stand: Stand,
): WeatherEvent | undefined {
  return stormAt(state, stand, STAND_STORM_MARGIN);
}

export interface StandAvailability {
  available: boolean;
  reason?: string;
}

/** Weather changes which stands can accept a new arrival. */
export function standAvailability(
  state: Shift,
  stand: Stand,
): StandAvailability {
  if (standStormEvent(state, stand))
    return { available: false, reason: "雷雨影响区：机位暂停接收" };
  if (isIcingActive(state) && !stand.deice)
    return { available: false, reason: "结冰条件：仅除冰机位可接收" };
  return { available: true };
}

export function vehicleInStorm(
  state: Shift,
  point: Point,
): WeatherEvent | undefined {
  return stormAt(state, point, VEHICLE_STORM_MARGIN);
}

/** Icing slows every ground movement; storm does not (vehicles evacuate). */
export function travelRate(state: Shift): number {
  return isIcingActive(state) ? 0.62 : 1;
}

export function protectionSeconds(state: Shift): number {
  const icing = activeWeather(state, "icing");
  return icing.some((w) => w.severity >= 3) ? 90 : 120;
}

export interface SafeHaven {
  point: Point;
  name: string;
  reason: string;
}

const shelterCandidates: { point: Point; name: string }[] = [
  { point: { x: 60, y: 620 }, name: "西侧机库避险区" },
  { point: { x: 900, y: 100 }, name: "东侧维修区" },
  { point: { x: 470, y: 60 }, name: "T1 廊桥下通道" },
];

/**
 * Picks a shelter outside every active storm cell. If (unexpectedly) all are
 * affected, the one with the largest clearance is used and the reason says so.
 */
export function safeHaven(state: Shift): SafeHaven {
  const storms = activeWeather(state, "storm");
  if (!storms.length) {
    return {
      point: { x: 830, y: 480 },
      name: "GSE 车场",
      reason: "天气正常，返回车场",
    };
  }
  const scored = shelterCandidates
    .map((s) => {
      const clearance = Math.min(
        ...storms.map((w) => {
          const centre = stormCenter(w, state.time)!;
          return (
            Math.hypot(s.point.x - centre.x, s.point.y - centre.y) -
            w.radius
          );
        }),
      );
      return { ...s, clearance };
    })
    .sort((a, b) => b.clearance - a.clearance);
  const best = scored[0];
  return {
    point: { ...best.point },
    name: best.name,
    reason:
      best.clearance > 0
        ? `撤离雷雨影响区，前往${best.name}`
        : `避险区亦受雷雨影响，沿最安全路线撤往${best.name}`,
  };
}
