import type { Shift } from "../../../shared/types";
import { compatibleStand, occupiedFlight } from "../lib/geometry";
import { standAvailability } from "../../weather";
export function StandPicker({
  state,
  onAssign,
  onSelect,
}: {
  state: Shift;
  onAssign: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const f = state.flights.find((x) => x.id === state.selectedFlightId);
  if (!f || f.status !== "incoming") return null;
  const valid = state.stands.find((s) => s.id === state.selectedStandId);
  const validWeather = valid ? standAvailability(state, valid) : undefined;
  return (
    <div className="stand-picker">
      <div className="hint-label">01 / 为航班分配机位</div>
      <div className="stand-choices">
        {state.stands.map((s) => {
          const weather = standAvailability(state, s);
          return (
            <button
              key={s.id}
              disabled={
                !!occupiedFlight(state, s.id) ||
                !compatibleStand(s, f) ||
                !weather.available
              }
              title={weather.reason}
              className={`${s.id === state.selectedStandId ? "chosen" : ""} ${!weather.available ? "weather-blocked" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              {s.id}
              {s.deice && <em>❄</em>}
              {s.size === "wide" && <small>W</small>}
            </button>
          );
        })}
      </div>
      <button
        className="primary full"
        data-testid="assign-stand"
        disabled={
          !valid ||
          !!occupiedFlight(state, valid.id) ||
          !compatibleStand(valid, f) ||
          !validWeather?.available
        }
        onClick={() => valid && onAssign(valid.id)}
      >
        {validWeather && !validWeather.available
          ? validWeather.reason
          : `分配至 ${valid?.id ?? "所选机位"}`}{" "}
        <span>↗</span>
      </button>
    </div>
  );
}
