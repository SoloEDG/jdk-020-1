import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { advanceWeather, advanceRelease } from "../../weather";

/**
 * Advances the clock and the flight lifecycle. Weather is advanced inside the
 * same step so that an onset is applied exactly once even when speed changes
 * or the tab was paused.
 */
export function advanceClock(state: Shift, seconds: number): Shift {
  if (state.paused || seconds <= 0) return state;
  let s = copyShift(state);
  s.time += seconds;
  for (const f of s.flights) {
    if (f.status === "scheduled" && s.time >= f.arrival) {
      f.status = "incoming";
      record(s, `${f.id} 已进入进港队列`);
    }
    if (f.status === "departing" && s.time - (f.departureAt ?? s.time) >= 12) {
      f.status = "departed";
      record(s, `${f.id} 已离港，机位 ${f.standId} 释放`, "success");
    }
  }
  s = advanceWeather(s);
  s = advanceRelease(s);
  return s;
}
export function togglePause(s: Shift): Shift {
  return { ...s, paused: !s.paused };
}
export function changeSpeed(s: Shift): Shift {
  return { ...s, speed: s.speed === 1 ? 2 : s.speed === 2 ? 4 : 1 };
}
