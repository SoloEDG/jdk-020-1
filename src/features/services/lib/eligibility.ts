import type { ServiceKind, Shift } from "../../../shared/types";
import { serviceCatalog } from "../model/catalog";
import { isIcingActive, standStormEvent } from "../../weather";

export function serviceBlockReason(
  s: Shift,
  flightId: string,
  kind: ServiceKind,
): string | undefined {
  const f = s.flights.find((x) => x.id === flightId),
    task = s.services.find((x) => x.flightId === flightId && x.kind === kind),
    stand = s.stands.find((x) => x.id === f?.standId);
  if (!f || f.status !== "parked") return "请先分配机位";
  if (kind === "deice" && task?.status === "done") {
    if ((task.protectionUntil ?? 0) > s.time) return "除冰保护仍然有效";
    return undefined;
  }
  if (!task || (task.status !== "pending" && task.status !== "interrupted"))
    return "任务已派遣";
  if (stand && standStormEvent(s, stand))
    return "雷雨覆盖机位，保障已暂停";
  if (kind === "deice") {
    const icing = isIcingActive(s);
    const relevant = s.weather.some(
      (w) => w.kind === "icing" && w.status !== "cleared" && w.forecastIssued,
    );
    if (!icing && !relevant)
      return "当前无结冰预报，无需除冰";
  }
  if (
    serviceCatalog[kind].requires.some(
      (k) =>
        !s.services.some(
          (t) => t.flightId === flightId && t.kind === k && t.status === "done",
        ),
    )
  )
    return "等待行李装卸完成";
  const active = s.services.filter(
    (t) =>
      t.flightId === flightId &&
      (t.status === "travel" || t.status === "working"),
  ).length;
  if (active >= 2) return "机位的两个服务位均已占用";
  return undefined;
}
