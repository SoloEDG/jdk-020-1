import type {
  Flight,
  ReleaseAttempt,
  Shift,
  WeatherEvent,
} from "../../../shared/types";
import {
  clockExact,
  copyShift,
  countdownLabel,
  departurePoints,
  record,
} from "../../../shared/document";
import { activeWeather, stormCenter } from "../model/engine";
import { standStormEvent } from "./impact";

export const PUSH_SECONDS = 18;
export const DECISION_LEAD = 150;
export const RISK_FAIL_PENALTY = 25;
export const RISK_FAIL_DELAY = 55;
export const RISK_SUCCESS_BONUS = 15;
export const WAIT_SLIP = 30;
/** Brief re-briefing pause after a failed gamble. */
export const FAIL_COOLDOWN = 25;

export interface RiskOption {
  chance: number;
  windowEnd: number;
  successBonus: number;
  failureDelay: number;
  failurePenalty: number;
  /** Points likely lost if the gamble fails. */
  loss: number;
  note: string;
}

export interface WaitOption {
  until: number;
  delay: number;
  loss: number;
  note: string;
  /** Only these systems must clear before the flight may push. */
  weatherIds: string[];
}

export interface ReleaseOutlook {
  hasDecision: boolean;
  risk?: RiskOption;
  wait?: WaitOption;
  /** Set when only waiting is possible (e.g. no de-icing protection). */
  reason?: string;
  /** Set after a failed gamble, before the crew can be asked to try again. */
  cooldownUntil?: number;
}

function pointsAt(flight: Flight, time: number): number {
  return departurePoints(Math.max(0, time - flight.deadline));
}

/** Public latest moment the weather can still be active, from the forecast. */
export function forecastClearBound(event: WeatherEvent): number {
  if (event.status === "active")
    return event.onsetAt + event.durationRange[1];
  return event.onsetRange[1] + event.durationRange[1];
}

export function relevantWeather(state: Shift): WeatherEvent | undefined {
  const active = activeWeather(state);
  if (active.length) return active[0];
  return state.weather
    .filter((w) => w.forecastIssued && w.status === "forecast")
    .filter((w) => w.onsetRange[0] - state.time <= DECISION_LEAD)
    .sort((a, b) => a.onsetRange[0] - b.onsetRange[0])[0];
}

export function deiceProtection(
  state: Shift,
  flight: Flight,
): { until?: number; remaining: number; valid: boolean; taskId?: string } {
  const task = state.services.find(
    (t) => t.flightId === flight.id && t.kind === "deice",
  );
  if (!task || task.status !== "done" || task.protectionUntil === undefined)
    return { remaining: 0, valid: false, taskId: task?.id };
  const remaining = task.protectionUntil - state.time;
  return {
    until: task.protectionUntil,
    remaining,
    valid: remaining > 0,
    taskId: task.id,
  };
}

/** Public chance estimate for a risky push, from the forecast window. */
function riskChance(state: Shift, event: WeatherEvent): number {
  const margin = event.onsetRange[0] - state.time;
  return Math.min(0.85, Math.max(0.2, 0.25 + margin / 220));
}

export function releaseBlockReason(
  state: Shift,
  flight: Flight,
): string | undefined {
  if (flight.status !== "parked") return "航班未停靠";
  if (flight.releasePlan) return "已选择保守等待，放行已排程";
  if (flight.releaseAttempt) return "风险放行判定执行中";
  if (flight.releaseCooldownUntil && state.time < flight.releaseCooldownUntil)
    return "推出中断，复盘冷却中";
  const core = state.services.filter(
    (t) => t.flightId === flight.id && t.kind !== "deice",
  );
  if (!core.every((t) => t.status === "done")) return "地勤保障尚未完成";
  const stand = state.stands.find((s) => s.id === flight.standId);
  if (!stand) return "未分配机位";
  if (standStormEvent(state, stand)) return "机位处于雷雨影响区，不可推出";
  if (activeWeather(state, "icing").length) {
    const protection = deiceProtection(state, flight);
    if (!protection.valid)
      return protection.until
        ? "除冰保护已过期，需重新除冰"
        : "结冰条件：需完成除冰保护";
  }
  return undefined;
}

/**
 * Both release strategies with their possible losses. Risk is only offered
 * when a protected/safe push is currently possible.
 */
export function releaseOutlook(state: Shift, flight: Flight): ReleaseOutlook {
  if (flight.status !== "parked") return { hasDecision: false };
  if (flight.releaseAttempt || flight.releasePlan) return { hasDecision: false };
  if (flight.releaseCooldownUntil && state.time < flight.releaseCooldownUntil)
    return {
      hasDecision: true,
      cooldownUntil: flight.releaseCooldownUntil,
    };
  const core = state.services.filter(
    (t) => t.flightId === flight.id && t.kind !== "deice",
  );
  if (!core.every((t) => t.status === "done")) return { hasDecision: false };
  const stand = state.stands.find((s) => s.id === flight.standId);
  if (!stand) return { hasDecision: false };

  const storm = activeWeather(state, "storm")[0];
  const icing = activeWeather(state, "icing")[0];
  // Only a system that is actually close enough to matter should force a
  // decision; a distant forecast must not interrupt a normal departure.
  const near = relevantWeather(state);
  const forecast = near && near.status === "forecast" ? near : undefined;

  const makeWait = (
    until: number,
    note: string,
    weatherIds: string[],
  ): WaitOption => ({
    until,
    delay: Math.max(0, until - flight.deadline),
    loss: Math.max(0, pointsAt(flight, state.time) - pointsAt(flight, until)),
    note,
    weatherIds,
  });
  const makeRisk = (
    chance: number,
    windowEnd: number,
    note: string,
  ): RiskOption => ({
    chance: Number(chance.toFixed(2)),
    windowEnd,
    successBonus: RISK_SUCCESS_BONUS,
    failureDelay: RISK_FAIL_DELAY,
    failurePenalty: RISK_FAIL_PENALTY,
    loss:
      RISK_FAIL_PENALTY +
      Math.max(
        0,
        pointsAt(flight, state.time) -
          pointsAt(flight, state.time + RISK_FAIL_DELAY),
      ),
    note,
  });

  if (storm && standStormEvent(state, stand)) {
    return {
      hasDecision: true,
      wait: makeWait(
        forecastClearBound(storm),
        "机位位于雷雨影响区，须等待单体过境后推出",
        [storm.id],
      ),
      reason: "雷雨覆盖机位，无法冒险推出",
    };
  }

  if (icing) {
    const protection = deiceProtection(state, flight);
    const until = forecastClearBound(icing);
    const wait = makeWait(
      until,
      "等待结冰条件解除；解除后无需再次除冰，但离港必然延误",
      [icing.id],
    );
    if (!protection.valid) {
      return {
        hasDecision: true,
        wait,
        reason: protection.until
          ? "除冰保护已过期，只能等待或重新除冰"
          : "尚无除冰保护，只能等待或重新除冰",
      };
    }
    const survives = protection.remaining >= PUSH_SECONDS;
    const chance = survives
      ? Math.min(0.95, 0.68 + (protection.remaining - PUSH_SECONDS) / 200)
      : Math.max(0.1, (protection.remaining / PUSH_SECONDS) * 0.6);
    return {
      hasDecision: true,
      risk: makeRisk(
        chance,
        protection.until!,
        `除冰保护仅余 ${Math.round(protection.remaining)}s，抢在保护失效前推出`,
      ),
      wait,
    };
  }

  if (storm) {
    const wait = makeWait(
      forecastClearBound(storm),
      "等待雷雨单体过境并解除后再放行",
      [storm.id],
    );
    const centre = stormCenter(storm, state.time);
    const clearance = centre
      ? Math.hypot(stand.x - centre.x, stand.y - centre.y) - storm.radius
      : 0;
    // If the cell is still clear of the stand, a quick push is a real gamble:
    // the chance shrinks as the cell gets closer and as the push gets longer.
    if (clearance > 30) {
      const chance = Math.min(
        0.9,
        Math.max(0.15, 0.2 + clearance / 420 - PUSH_SECONDS / 240),
      );
      return {
        hasDecision: true,
        risk: makeRisk(
          chance,
          state.time + PUSH_SECONDS,
          `雷雨单体距机位约 ${Math.round(clearance)}m，抢在它扫过前推出`,
        ),
        wait,
      };
    }
    return {
      hasDecision: true,
      wait,
      reason: "雷雨已覆盖机位周边，无法冒险推出",
    };
  }

  if (!forecast) return { hasDecision: false };
  return {
    hasDecision: true,
    risk: makeRisk(
      riskChance(state, forecast),
      forecast.onsetRange[0],
      `距离天气最早到达约 ${Math.max(0, Math.round(forecast.onsetRange[0] - state.time))}s，抢在窗口关闭前推出`,
    ),
    wait: makeWait(
      forecastClearBound(forecast),
      "等待天气窗口完全过去，确保安全放行",
      [forecast.id],
    ),
  };
}

/** Pre-rolled outcome: pause/speed/reload can never re-roll a decision. */
export function attemptRoll(state: Shift, flightId: string): number {
  const key = `${state.weatherSeed}:${flightId}:${Math.round(state.time)}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function chooseRiskRelease(state: Shift, flightId: string): Shift {
  const s = copyShift(state),
    f = s.flights.find((x) => x.id === flightId);
  if (!f) return state;
  const block = releaseBlockReason(s, f),
    outlook = releaseOutlook(s, f);
  if (block || !outlook.risk) {
    s.conflicts++;
    s.score -= 5;
    record(s, `无法冒险放行：${block ?? "当前没有可争取的窗口"}`, "warning");
    return s;
  }
  f.releaseAttempt = {
    mode: "risk",
    startedAt: s.time,
    resolveAt: s.time + PUSH_SECONDS,
    chance: outlook.risk.chance,
    roll: attemptRoll(s, f.id),
  };
  record(
    s,
    `${f.id} 选择冒险推出：${Math.round(outlook.risk.chance * 100)}% 把握，${PUSH_SECONDS}s 后判定`,
    "warning",
  );
  return s;
}

export function chooseWaitRelease(state: Shift, flightId: string): Shift {
  const s = copyShift(state),
    f = s.flights.find((x) => x.id === flightId);
  if (!f) return state;
  const outlook = releaseOutlook(s, f);
  if (!outlook.wait) {
    s.conflicts++;
    record(s, "无法选择保守等待：当前没有需要等待的天气影响", "warning");
    return s;
  }
  const deice = s.services.find(
    (t) => t.flightId === f.id && t.kind === "deice",
  );
  f.releasePlan = {
    until: outlook.wait.until,
    weatherIds: outlook.wait.weatherIds,
    chosenAt: s.time,
    deiceTaskId:
      deice && deice.status === "done" && (deice.protectionUntil ?? 0) > s.time
        ? deice.id
        : undefined,
  };
  record(
    s,
    `${f.id} 选择保守等待：预计 ${clockExact(outlook.wait.until)} 天气窗口结束，预计延误 ${countdownLabel(outlook.wait.delay)}`,
    "info",
  );
  return s;
}

/** Resolves risk gambles and conservative waiting exactly once per flight. */
export function advanceRelease(state: Shift): Shift {
  const s = copyShift(state);
  let slipped = false;
  for (const f of s.flights) {
    if (f.releaseAttempt) {
      if (s.time < f.releaseAttempt.resolveAt) continue;
      const attempt = f.releaseAttempt;
      const windowLost = !pushWindowStillOpen(s, f);
      if (!windowLost && attempt.roll < attempt.chance) {
        pushFlight(s, f, RISK_SUCCESS_BONUS, "窗口内推出成功");
      } else {
        f.releaseAttempt = undefined;
        f.releaseCooldownUntil = s.time + FAIL_COOLDOWN;
        s.score -= RISK_FAIL_PENALTY;
        const delay = Math.max(0, s.time - f.deadline);
        record(
          s,
          windowLost
            ? `${f.id} 冒险推出失败：推出途中窗口已经关闭，推出中止（-${RISK_FAIL_PENALTY} 分，当前延误 ${countdownLabel(delay)}）`
            : `${f.id} 冒险推出失败：天气窗口关闭，推出中止（-${RISK_FAIL_PENALTY} 分，当前延误 ${countdownLabel(delay)}）`,
          "warning",
        );
        record(
          s,
          `${f.id} 需重新简报，${FAIL_COOLDOWN}s 内不可再次选择推出方式`,
          "info",
        );
        if (f.standId) {
          requireRecheck(s, f.id, "冒险放行失败，需重新检查保障与除冰");
        }
      }
      continue;
    }
    if (f.releasePlan && f.status === "parked") {
      const blocking = s.weather.filter(
        (w) => f.releasePlan!.weatherIds.includes(w.id) && w.status !== "cleared",
      );
      if (blocking.length === 0) {
        // Waiting out the weather does not restore lost protection.
        const deiceId = f.releasePlan.deiceTaskId;
        const deice = deiceId
          ? s.services.find((t) => t.id === deiceId)
          : undefined;
        if (deice && (deice.protectionUntil ?? 0) <= s.time) {
          f.releasePlan = undefined;
          record(
            s,
            `${f.id} 天气已转好，但除冰保护在等待中过期：须重新除冰后放行，工作不会凭空完成`,
            "warning",
          );
          continue;
        }
        // A new system may have arrived while this flight waited. Extend the
        // plan instead of pushing into unsafe conditions.
        if (!pushWindowStillOpen(s, f)) {
          const extra = activeWeather(s)
            .map((w) => w.id)
            .filter((id) => !f.releasePlan!.weatherIds.includes(id));
          for (const id of extra) f.releasePlan.weatherIds.push(id);
          const latest = activeWeather(s)
            .map((w) => forecastClearBound(w))
            .sort((a, b) => b - a)[0];
          if (latest !== undefined && latest > f.releasePlan.until) {
            f.releasePlan.until = latest;
            record(
              s,
              `${f.id} 等待期间又出现新的天气影响，放行顺延至 ${clockExact(latest)}`,
              "warning",
            );
          }
          continue;
        }
        pushFlight(s, f, 0, "等待天气窗口结束");
        continue;
      }
      if (s.time >= f.releasePlan.until) {
        slipped = true;
        f.releasePlan.until = s.time + WAIT_SLIP;
      }
    }
  }
  if (slipped)
    record(
      s,
      "实测消散晚于预报上限：等待中的航班继续等待，可改为重新评估",
      "warning",
    );
  return s;
}

/** The gamble only pays if the protected window is still open on resolution. */
function pushWindowStillOpen(s: Shift, f: Flight): boolean {
  if (activeWeather(s, "icing").length) {
    const protection = deiceProtection(s, f);
    if (!protection.valid) return false;
  }
  const stand = s.stands.find((st) => st.id === f.standId);
  if (stand && standStormEvent(s, stand)) return false;
  return true;
}

/**
 * After a failed gamble the aircraft has not moved; de-icing protection may
 * already be gone, so the de-icing task is reset to be re-run.
 */
function requireRecheck(s: Shift, flightId: string, reason: string): void {
  const deice = s.services.find(
    (t) => t.flightId === flightId && t.kind === "deice",
  );
  if (deice && deice.status === "done" && (deice.protectionUntil ?? 0) <= s.time) {
    deice.status = "pending";
    deice.progress = 0;
    deice.vehicleId = undefined;
    deice.protectionUntil = undefined;
    deice.completedAt = undefined;
    deice.expiryNotified = false;
    record(s, `${flightId} 除冰保护已失效：重新保障后方可放行`, "warning");
  } else {
    record(s, `${flightId} ${reason}`, "info");
  }
}

function pushFlight(
  s: Shift,
  f: NonNullable<Shift["flights"][number]>,
  bonus: number,
  why: string,
): void {
  f.status = "departing";
  f.departureAt = s.time;
  f.releaseAttempt = undefined;
  f.releasePlan = undefined;
  f.releaseCooldownUntil = undefined;
  const delay = Math.max(0, s.time - f.deadline);
  const points = departurePoints(delay) + bonus;
  s.score += points;
  record(
    s,
    `${f.id} ${why} · +${points} 分${delay > 0 ? ` · 延误 ${countdownLabel(delay)}` : ""}`,
    "success",
  );
}
