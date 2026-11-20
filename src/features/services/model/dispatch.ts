import type { Shift, ServiceKind } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { serviceBlockReason } from "../lib/eligibility";
import { serviceCatalog, serviceDuration } from "./catalog";

export function dispatchService(
  state: Shift,
  flightId: string,
  kind: ServiceKind,
  vehicleId: string,
): Shift {
  const s = copyShift(state),
    reason = serviceBlockReason(s, flightId, kind),
    v = s.vehicles.find((x) => x.id === vehicleId),
    f = s.flights.find((x) => x.id === flightId),
    stand = s.stands.find((x) => x.id === f?.standId),
    task = s.services.find((x) => x.flightId === flightId && x.kind === kind);
  if (
    reason ||
    !v ||
    v.status !== "idle" ||
    v.kind !== kind ||
    !stand ||
    !task
  ) {
    s.conflicts++;
    s.score -= 10;
    record(s, reason ?? "车辆不可用或车辆类型不匹配", "warning");
    return s;
  }
  // Re-dispatch keeps any retained progress (interrupted work). A completed
  // but expired de-icing task starts over, because its protection is gone.
  if (task.status === "done") {
    task.progress = 0;
    task.completedAt = undefined;
    task.protectionUntil = undefined;
    task.expiryNotified = false;
  }
  if (kind === "deice" && f)
    task.duration = serviceDuration(kind, f, stand.deice);
  task.status = "travel";
  task.vehicleId = v.id;
  task.interruptReason = undefined;
  v.status = "travel";
  v.serviceId = task.id;
  v.origin = { ...v.position };
  v.target = { x: stand.x + 42, y: stand.y + 22 };
  v.progress = 0;
  // Icing slows movement dynamically in the fleet step; do not bake it in.
  v.tripDuration =
    5 + Math.hypot(v.target.x - v.origin.x, v.target.y - v.origin.y) / 50;
  record(s, `${v.id} → ${flightId} · ${serviceCatalog[kind].label}`);
  return s;
}
