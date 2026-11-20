import type { ServiceKind, Shift } from "../../../shared/types";
import { clockExact, countdownLabel } from "../../../shared/document";
import { serviceCatalog } from "../model/catalog";
import { serviceBlockReason } from "../lib/eligibility";
import { deiceProtection, isIcingActive } from "../../weather";

export function ServicePanel({
  state,
  onDispatch,
}: {
  state: Shift;
  onDispatch: (kind: ServiceKind, vehicleId: string) => void;
}) {
  const flight = state.flights.find((f) => f.id === state.selectedFlightId);
  const tasks = state.services.filter(
    (t) => t.flightId === state.selectedFlightId,
  );
  const icing = isIcingActive(state);
  const protection = flight ? deiceProtection(state, flight) : undefined;
  const visible = tasks.filter(
    (t) =>
      t.kind !== "deice" ||
      icing ||
      t.status === "done" ||
      t.status === "interrupted" ||
      state.weather.some(
        (w) => w.kind === "icing" && w.status !== "cleared" && w.forecastIssued,
      ),
  );
  return (
    <div className="service-panel">
      <div className="subheading">
        <h3>地勤保障</h3>
        <span>GROUND SERVICES</span>
      </div>
      {visible.map((t, i) => {
        const info = serviceCatalog[t.kind],
          reason = serviceBlockReason(state, t.flightId, t.kind),
          available = state.vehicles.filter(
            (v) => v.kind === t.kind && v.status === "idle",
          );
        const selected =
          state.vehicles.find(
            (v) => v.id === state.selectedVehicleId && v.kind === t.kind,
          ) ?? available[0];
        return (
          <div className={`service-task ${t.status}`} key={t.id}>
            <div className="service-icon">
              {t.kind === "fuel"
                ? "◈"
                : t.kind === "baggage"
                  ? "▤"
                  : t.kind === "deice"
                    ? "❄"
                    : "✧"}
            </div>
            <div className="service-content">
              <div className="service-title">
                <strong>{info.label}</strong>
                <span>
                  {t.status === "done"
                    ? "已完成 ✓"
                    : t.status === "working"
                      ? `${Math.floor(t.progress)}%`
                      : t.status === "travel"
                        ? "车辆前往中"
                        : t.status === "interrupted"
                          ? "中断待重新派遣"
                          : `0${i + 1}`}
                </span>
              </div>
              <div className="service-detail">
                {t.status === "pending"
                  ? (reason ??
                    `${selected?.id ?? "暂无空闲车辆"} · ${Math.round(t.duration)}s`)
                  : t.status === "interrupted"
                    ? `${t.interruptReason ?? "天气中断"} · 保留 ${Math.floor(t.progress)}%`
                    : t.vehicleId + " · " + info.english}
              </div>
              {(t.status === "working" ||
                t.status === "done" ||
                t.status === "interrupted") && (
                <div className={`task-track ${t.status}`}>
                  <i style={{ width: `${t.progress}%` }} />
                </div>
              )}
              {t.kind === "deice" && t.status === "done" && protection && (
                <div
                  className={`deice-protection ${protection.valid ? "valid" : "expired"}`}
                >
                  {protection.valid
                    ? `保护有效 · 剩余 ${countdownLabel(protection.remaining)}（至 ${clockExact(protection.until!)}）`
                    : `保护已过期（${clockExact(protection.until!)}）· 推出前需重新除冰`}
                </div>
              )}
            </div>
            {(t.status === "pending" ||
              t.status === "interrupted" ||
              (t.kind === "deice" &&
                t.status === "done" &&
                protection?.valid === false)) && (
              <button
                className="dispatch"
                data-testid={`start-service-${t.kind}`}
                disabled={!!reason || !selected}
                title={reason ?? info.description}
                onClick={() => selected && onDispatch(t.kind, selected.id)}
              >
                {t.kind === "deice" && t.status === "done"
                  ? "重新除冰 ↻"
                  : t.status === "interrupted"
                    ? "重新派遣 ↻"
                    : "派遣 ↗"}
              </button>
            )}
          </div>
        );
      })}
      <p className="dependency-note">
        ↳ 先完成行李装卸，再进行客舱清洁。燃油可同步保障。
        {icing && " 结冰条件下，放行前须持有有效除冰保护。"}
      </p>
    </div>
  );
}
