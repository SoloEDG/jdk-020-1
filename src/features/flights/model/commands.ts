import type { Shift } from "../../../shared/types";
import { copyShift, departurePoints, record } from "../../../shared/document";
import { releaseBlockReason, standAvailability } from "../../weather";

export function assignStand(state: Shift, id: string, standId: string): Shift {
  const s = copyShift(state),
    f = s.flights.find((x) => x.id === id),
    stand = s.stands.find((x) => x.id === standId);
  if (!f || !stand) return state;
  const occupied = s.flights.some(
    (x) => x.standId === standId && x.status !== "departed",
  );
  const availability = standAvailability(s, stand);
  if (
    f.status !== "incoming" ||
    occupied ||
    !availability.available ||
    (f.size === "wide" && stand.size !== "wide")
  ) {
    s.conflicts++;
    s.score -= 10;
    record(
      s,
      !availability.available
        ? `机位指令冲突：${availability.reason}`
        : "机位指令冲突：请检查尺寸、占用与航班状态",
      "warning",
    );
    return s;
  }
  f.standId = standId;
  f.status = "parked";
  s.selectedStandId = standId;
  record(
    s,
    `${id} 已停靠 ${standId}，可开始保障${stand.deice ? "（固定除冰位）" : ""}`,
    "success",
  );
  return s;
}

/** Immediate approval; weather must not block the push and no gamble. */
export function departFlight(state: Shift, id: string): Shift {
  const s = copyShift(state),
    f = s.flights.find((x) => x.id === id);
  if (!f) return state;
  const block = releaseBlockReason(s, f);
  if (block) {
    s.conflicts++;
    s.score -= 5;
    record(s, `${id} 离港未获许可：${block}`, "warning");
    return s;
  }
  f.status = "departing";
  f.departureAt = s.time;
  const delay = Math.max(0, s.time - f.deadline);
  const points = departurePoints(delay);
  s.score += points;
  record(
    s,
    `${id} 获准推出 · +${points} 分${delay > 0 ? ` · 延误 ${Math.round(delay)}s` : ""}`,
    "success",
  );
  return s;
}

export function selectFlight(state: Shift, id: string): Shift {
  return {
    ...state,
    selectedFlightId: id,
    selectedStandId: state.flights.find((f) => f.id === id)?.standId,
  };
}
