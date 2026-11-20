import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { serviceCatalog } from "./catalog";
import { protectionSeconds, standStormEvent } from "../../weather";

export function advanceServices(state: Shift, seconds: number): Shift {
  const s = copyShift(state);
  for (const task of s.services) {
    if (task.status === "working") {
      const flight = s.flights.find((f) => f.id === task.flightId);
      const stand = s.stands.find((st) => st.id === flight?.standId);
      if (stand && standStormEvent(s, stand)) {
        interruptTask(s, task, "雷雨覆盖机位");
        continue;
      }
      task.progress = Math.min(
        100,
        task.progress + (seconds / task.duration) * 100,
      );
      if (task.progress === 100) {
        finishService(s, task);
      }
      continue;
    }
    if (
      task.status === "done" &&
      task.protectionUntil !== undefined &&
      !task.expiryNotified &&
      s.time >= task.protectionUntil
    ) {
      task.expiryNotified = true;
      record(
        s,
        `${task.flightId} 除冰保护已过期：如仍处结冰条件，推出前须重新保障`,
        "warning",
      );
    }
  }
  return s;
}

function finishService(s: Shift, task: Shift["services"][number]): void {
  task.status = "done";
  task.completedAt = s.time;
  if (task.kind === "deice") {
    task.protectionUntil = s.time + protectionSeconds(s);
    const flight = s.flights.find((f) => f.id === task.flightId);
    if (flight)
      record(
        s,
        `${task.flightId} 除冰完成 · 保护期至 ${Math.round(task.protectionUntil)}s 后`,
        "success",
      );
  } else {
    record(
      s,
      `${task.flightId} ${serviceCatalog[task.kind].label}完成`,
      "success",
    );
  }
  const v = s.vehicles.find((x) => x.id === task.vehicleId);
  if (v) {
    // Returning home; the fleet step reroutes it if a storm is in the way.
    v.status = "returning";
    v.origin = { ...v.position };
    v.target = { x: 830, y: 480 };
    v.progress = 0;
    v.tripDuration = 10;
  }
}

/**
 * Interrupted work keeps its progress; it never completes by itself. The
 * vehicle evacuation itself is handled by the fleet step, which publishes its
 * own route message.
 */
export function interruptTask(
  s: Shift,
  task: Shift["services"][number],
  reason: string,
): void {
  if (task.status !== "working" && task.status !== "travel") return;
  task.status = "interrupted";
  task.interruptReason = reason;
  record(
    s,
    `${task.flightId} ${serviceCatalog[task.kind].label}中断（${reason}）：已保留 ${Math.floor(task.progress)}% 进度，天气转好后需重新派遣`,
    "warning",
  );
}
