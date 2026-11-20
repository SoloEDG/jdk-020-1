import type { Shift } from "../../../shared/types";
import { clockLabel, rangeLabel } from "../../../shared/document";
import { statusLabels, turnaroundProgress } from "../lib/readiness";
import { activeWeather } from "../../weather";
interface Props {
  state: Shift;
  onSelect: (id: string) => void;
}
export function FlightBoard({ state, onSelect }: Props) {
  return (
    <section className="flight-board">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FLIGHT STRIPS</span>
          <h2>航班进程</h2>
        </div>
        <span className="count">
          {state.flights.filter((f) => f.status !== "departed").length} ACTIVE
        </span>
      </div>
      <div className="board-tabs">
        <span className="active">全部航班</span>
        <span>进港 / 离港</span>
        <b>06</b>
      </div>
      <div className="flight-list">
        {state.flights.map((f) => (
          <button
            key={f.id}
            className={`flight-card ${f.id === state.selectedFlightId ? "selected" : ""} ${f.status === "departed" ? "completed" : ""}`}
            onClick={() => onSelect(f.id)}
            data-testid={`flight-${f.id}`}
          >
            <div className="flight-top">
              <span className="airline-mark" style={{ background: f.color }}>
                ✈
              </span>
              <strong>{f.id}</strong>
              <span className={`status ${f.status}`}>
                {statusLabels[f.status]}
              </span>
            </div>
            <div className="flight-route">
              {f.from}
              <span>→</span>
              {f.destination.split(" · ")[0]}
            </div>
            <div className="flight-meta">
              <span>
                {f.aircraft} · {f.passengers} PAX
              </span>
              <span>
                {f.standId ?? "—"} <i /> {clockLabel(f.deadline)}
              </span>
            </div>
            {f.status === "parked" && (
              <div className="mini-track">
                <i style={{ width: `${turnaroundProgress(state, f.id)}%` }} />
              </div>
            )}
          </button>
        ))}
      </div>
      <ShiftNote state={state} />
    </section>
  );
}


function ShiftNote({ state }: { state: Shift }) {
  const active = activeWeather(state);
  if (active.length) {
    const storm = active.find((w) => w.kind === "storm");
    return (
      <div className="shift-note weather">
        <span>{storm ? "⛈" : "❄"}</span>
        <div>
          <strong>
            {storm ? "雷雨过境，先避险再作业。" : "低温结冰，放行看保护期。"}
          </strong>
          <p>
            {storm
              ? "受影响机位暂停接收与保障；车辆自动撤往避险区，天气转好后需重新派遣。"
              : `除冰保护有固定时限，自完成起算；等待中的保护过期必须重新保障。`}
          </p>
        </div>
      </div>
    );
  }
  const forecast = state.weather.find(
    (w) => w.forecastIssued && w.status === "forecast",
  );
  if (forecast) {
    return (
      <div className="shift-note weather forecast">
        <span>⚠</span>
        <div>
          <strong>天气预报生效，提前调整节奏。</strong>
          <p>
            {forecast.title}预计 {rangeLabel(forecast.onsetRange)} 影响本场；
            可用机位、车辆通行与放行条件都将随之变化。
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="shift-note">
      <span>☀</span>
      <div>
        <strong>早高峰，保持节奏。</strong>
        <p>为每一架飞机，安排恰好的下一步。</p>
      </div>
    </div>
  );
}
