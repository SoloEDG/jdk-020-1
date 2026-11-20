import type { Shift } from "../../../shared/types";
import { validShift } from "./validation";
const key = "apron07-shift-v2";
/** Old version keys are never read, so a v1 document cannot masquerade as v2. */
export const saveKey = key;
export function saveShift(state: Shift): void {
  localStorage.setItem(key, JSON.stringify(state));
}
export function loadShift(): Shift | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return validShift(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
