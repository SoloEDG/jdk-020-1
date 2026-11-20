import type { Shift } from "../../../shared/types";
import {
  clockExact,
  countdownLabel,
  rangeLabel,
} from "../../../shared/document";
import { activeWeather, weatherHeadline } from "../model/engine";
import { deiceProtection } from "../lib/release";
import { standAvailability } from "../lib/impact";

export function WeatherPanel({ state }: { state: Shift }) {
  const active = activeWeather(state);
  const forecast = state.weather.filter(
    (w) => w.forecastIssued && w.status === "forecast",
  );
  const affected = state.stands.filter(
    (s) => !standAvailability(state, s).available,
  );
  return (
    <section className={`weather-panel ${active.length ? "alert" : ""}`}>
      <div className="weather-head">
        <div>
          <span className="eyebrow">WEATHER & OPERATIONS</span>
          <h2>
            {weatherHeadline(state)}
            <i className="live-dot" />
          </h2>
        </div>
        <span className="weather-clock">{clockExact(state.time)}</span>
      </div>
      <div className="weather-events">
        {active.map((w) => {
          // Show only the forecast clear window, never the hidden exact time.
          const clearFrom = w.onsetAt + w.durationRange[0];
          const clearTo = w.onsetAt + w.durationRange[1];
          return (
            <div className={`weather-row active ${w.kind}`} key={w.id}>
              <span className="weather-tag">{w.kind === "storm" ? "雷雨" : "结冰"}</span>
              <div>
                <strong>{w.title}</strong>
                <p>
                  实际生效 {clockExact(w.onsetAt)} · 预计解除{" "}
                  {rangeLabel([clearFrom, clearTo])} · 最早还剩{" "}
                  {countdownLabel(Math.max(0, clearFrom - state.time))}
                </p>
              </div>
            </div>
          );
        })}
        {forecast.map((w) => (
          <div className={`weather-row ${w.kind}`} key={w.id}>
            <span className="weather-tag">{w.kind === "storm" ? "雷雨" : "结冰"}</span>
            <div>
              <strong>
                {w.title} · 预计 {rangeLabel(w.onsetRange)}
              </strong>
              <p>
                持续 {Math.round(w.durationRange[0] / 60)}–
                {Math.round(w.durationRange[1] / 60)} 分钟；实际到达与消散以雷达为准
              </p>
            </div>
          </div>
        ))}
        {!active.length && !forecast.length && (
          <div className="weather-row calm">
            <span className="weather-tag">正常</span>
            <div>
              <strong>当前无影响运行的天气</strong>
              <p>气象台持续监视本场，预报将随班次更新</p>
            </div>
          </div>
        )}
      </div>
      {state.flights
        .filter((f) => f.status === "parked")
        .map((f) => ({ f, protection: deiceProtection(state, f) }))
        .filter(
          ({ protection }) =>
            protection.until !== undefined && !protection.valid,
        )
        .map(({ f, protection }) => (
          <div className="weather-impact" key={f.id}>
            <span>
              {f.id} 除冰保护已于 {clockExact(protection.until!)} 过期
            </span>
            <b>推出前需重新除冰</b>
          </div>
        ))}
      {affected.length > 0 && (
        <div className="weather-impact">
          <span>当前不可用机位</span>
          <b>{affected.map((s) => s.id).join(" · ")}</b>
        </div>
      )}
    </section>
  );
}
