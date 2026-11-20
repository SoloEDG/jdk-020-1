import type { Shift, Vehicle } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { routePosition } from "../lib/routing";
import {
  travelRate,
  vehicleInStorm,
  standStormEvent,
  safeHaven,
} from "../../weather";

export function advanceFleet(state: Shift, seconds: number): Shift {
  const s = copyShift(state);
  let rate = travelRate(s);
  for (const v of s.vehicles) {
    // A vehicle inside a storm cell must start (or continue) evacuating.
    const task = v.serviceId
      ? s.services.find((t) => t.id === v.serviceId)
      : undefined;
    // A crew whose job was interrupted by weather must leave the stand area
    // even if the cell edge has not reached the vehicle yet.
    const interruptedAtStand =
      task?.status === "interrupted" &&
      (() => {
        const flight = s.flights.find((f) => f.id === task.flightId);
        const stand = s.stands.find((st) => st.id === flight?.standId);
        return !!stand && !!standStormEvent(s, stand);
      })();
    if (
      (v.status === "travel" ||
        v.status === "working" ||
        v.status === "returning" ||
        v.status === "idle") &&
      (interruptedAtStand || vehicleInStorm(s, v.position))
    ) {
      evacuate(s, v);
      rate = travelRate(s);
    }
    // An evacuation route must also stay clear. If the chosen shelter has
    // drifted into the cell, reroute; otherwise keep driving towards it.
    if (v.status === "evading" && vehicleInStorm(s, v.target)) {
      evacuate(s, v, true);
    }
    // Once the airfield is clear again, sheltered crews return to standby.
    if (v.status === "sheltered" && !vehicleInStorm(s, v.position)) {
      v.status = "idle";
      v.avoidReason = undefined;
      record(s, `${v.id} 天气转好，在${v.safePointName ?? "避险区"}恢复待命`, "info");
      continue;
    }
    if (
      v.status !== "travel" &&
      v.status !== "returning" &&
      v.status !== "evading"
    )
      continue;
    const duration = Math.max(0.5, v.tripDuration);
    v.progress = Math.min(100, v.progress + (seconds / duration) * 100 * rate);
    v.position = routePosition(v);
    if (v.progress < 100) continue;
    if (v.status === "evading") {
      if (vehicleInStorm(s, v.position) && vehicleInStorm(s, v.target)) {
        if (evacuate(s, v, true)) continue;
        // Every shelter is inside the cell: sheltering here beats driving in
        // circles, and the log explains why.
        v.status = "sheltered";
        v.serviceId = undefined;
        v.avoidReason = undefined;
        record(
          s,
          `${v.id} 所有避险区均受雷雨影响，就近停靠${v.safePointName ?? "避险点"}并等待雷达更新`,
          "warning",
        );
        continue;
      }
      v.status = "sheltered";
      v.serviceId = undefined;
      v.avoidReason = undefined;
      record(
        s,
        `${v.id} 已抵达${v.safePointName ?? "避险区"}，待天气好转后可重新派遣`,
        "info",
      );
      continue;
    }
    if (v.status === "returning") {
      v.status = "idle";
      v.serviceId = undefined;
      continue;
    }
    if (vehicleInStorm(s, v.position)) {
      evacuate(s, v);
      continue;
    }
    const destination = arrivedStand(s, v);
    if (destination && standStormEvent(s, destination)) {
      evacuate(s, v);
      continue;
    }
    v.status = "working";
    const arrived = s.services.find((t) => t.id === v.serviceId);
    if (arrived && arrived.status === "travel") arrived.status = "working";
  }
  return s;
}

function arrivedStand(s: Shift, v: Vehicle) {
  const task = s.services.find((t) => t.id === v.serviceId);
  const flight = task
    ? s.flights.find((f) => f.id === task.flightId)
    : undefined;
  return s.stands.find((st) => st.id === flight?.standId);
}

/**
 * An explainable evacuation: keep the interrupted task (progress preserved)
 * and drive the vehicle out of the cell to the safest available shelter.
 */
/** Returns true if the vehicle's route changed. */
function evacuate(s: Shift, v: Vehicle, reroute = false): boolean {
  if (v.status === "evading" && !reroute) return false;
  const task = s.services.find((t) => t.id === v.serviceId);
  if (task && (task.status === "travel" || task.status === "working")) {
    task.status = "interrupted";
    task.interruptReason = "雷雨逼近，车辆撤离";
    record(
      s,
      `${task.flightId} ${task.kind === "deice" ? "除冰" : "地勤"}保障中断：车辆驶离雷雨影响区，已保留 ${Math.floor(task.progress)}% 进度`,
      "warning",
    );
  }
  const haven = safeHaven(s);
  const alreadyEvading = v.status === "evading";
  // Do not re-log or restart an unchanged route every tick.
  if (alreadyEvading && v.target.x === haven.point.x && v.target.y === haven.point.y)
    return false;
  v.status = "evading";
  v.avoidReason = haven.reason;
  v.safePointName = haven.name;
  v.origin = { ...v.position };
  v.target = haven.point;
  v.progress = 0;
  v.tripDuration =
    (5 + Math.hypot(v.target.x - v.origin.x, v.target.y - v.origin.y) / 50) /
    travelRate(s);
  record(
    s,
    alreadyEvading
      ? `${v.id} 避险点受雷雨影响，改道前往${haven.name}`
      : `${v.id} 驶入避险路线：${haven.reason}`,
    "warning",
  );
  return true;
}
