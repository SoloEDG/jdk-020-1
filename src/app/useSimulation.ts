import { useEffect, useRef, useState } from "react";
import type { Shift } from "../shared/types";
import { advanceClock, createShift } from "../features/session";
import { advanceFleet } from "../features/fleet";
import { advanceServices } from "../features/services";
export function useSimulation() {
  const [state, setState] = useState<Shift>(createShift);
  // The latest state in a ref, so the interval never captures a stale copy.
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    let previous = performance.now();
    const id = setInterval(() => {
      const now = performance.now(),
        elapsed = Math.min((now - previous) / 1000, 1);
      previous = now;
      setState((s) => {
        if (s.paused || elapsed <= 0) return s;
        const dt = elapsed * s.speed;
        return advanceFleet(advanceServices(advanceClock(s, dt), dt), dt);
      });
    }, 100);
    return () => clearInterval(id);
  }, []);
  return [state, setState] as const;
}
