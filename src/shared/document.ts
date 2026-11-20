import type { Shift, Event } from "./types";
export function copyShift(state: Shift): Shift {
  return structuredClone(state);
}
export function record(
  state: Shift,
  text: string,
  tone: Event["tone"] = "info",
): void {
  state.events.unshift({
    id: state.nextEventId++,
    time: state.time,
    text,
    tone,
  });
  state.events = state.events.slice(0, 30);
}
export function clockLabel(seconds: number): string {
  const minutes = 8 * 60 + Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
/** 08:04:30 — used where forecast ranges need second-level precision. */
export function clockExact(seconds: number): string {
  const total = 8 * 3600 + Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
/** mm:ss countdown label. */
export function countdownLabel(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
export function rangeLabel(range: [number, number]): string {
  return `${clockExact(range[0])}–${clockExact(range[1])}`;
}
/** Points awarded for a pushback at a given delay (never below 20). */
export function departurePoints(delay: number): number {
  return Math.max(20, 120 - Math.floor(Math.max(0, delay)));
}
