import type {
  Point,
  Shift,
  WeatherEvent,
  WeatherKind,
} from "../../../shared/types";
import { copyShift, clockExact, rangeLabel, record } from "../../../shared/document";

/**
 * Deterministic PRNG. The seed lives in the shift document, so a saved or
 * reopened shift always replays exactly the same weather.
 */
export function random(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextSeed(seed: number): number {
  return (seed + 0x9e3779b9) | 0;
}

const stormTracks: [Point, Point][] = [
  [
    { x: -180, y: 180 },
    { x: 1120, y: 420 },
  ],
  [
    { x: 1100, y: 120 },
    { x: -160, y: 470 },
  ],
  [
    { x: 420, y: -140 },
    { x: 640, y: 800 },
  ],
];

interface WeatherPlan {
  kind: WeatherKind;
  title: string;
  forecastFrom: number;
  onsetRange: [number, number];
  durationRange: [number, number];
  severity: 1 | 2 | 3;
  radiusRange: [number, number];
}

const plans: WeatherPlan[] = [
  {
    kind: "storm",
    title: "雷雨单体过境",
    forecastFrom: 90,
    onsetRange: [190, 250],
    durationRange: [95, 135],
    severity: 2,
    radiusRange: [200, 250],
  },
  {
    kind: "icing",
    title: "低温结冰",
    forecastFrom: 330,
    onsetRange: [420, 470],
    durationRange: [110, 150],
    severity: 2,
    radiusRange: [0, 0],
  },
];

/**
 * Builds the shift's weather script. Actual onset/clear times are generated
 * once and stored, but only the forecast ranges are shown before an event
 * begins.
 */
export function initialWeather(seed: number): WeatherEvent[] {
  let cursor = seed;
  const draw = () => {
    cursor = nextSeed(cursor);
    return random(cursor);
  };
  const between = (range: [number, number]) =>
    range[0] + draw() * (range[1] - range[0]);

  return plans.map((plan, index) => {
    const onsetAt = Math.round(between(plan.onsetRange));
    const duration = between(plan.durationRange);
    const radius =
      plan.kind === "storm" ? Math.round(between(plan.radiusRange)) : 0;
    const track =
      plan.kind === "storm"
        ? stormTracks[Math.floor(draw() * stormTracks.length)]
        : undefined;
    return {
      id: `W${index + 1}`,
      kind: plan.kind,
      title: plan.title,
      forecastFrom: plan.forecastFrom,
      onsetRange: plan.onsetRange,
      durationRange: plan.durationRange,
      onsetAt,
      clearsAt: onsetAt + Math.round(duration),
      status: "forecast",
      forecastIssued: false,
      onsetApplied: false,
      clearApplied: false,
      severity: plan.severity,
      from: track?.[0],
      to: track?.[1],
      radius,
      radiusRange: plan.radiusRange,
    } satisfies WeatherEvent;
  });
}

/** Storm centre at a given moment. Only meaningful while the storm is active. */
export function stormCenter(
  event: WeatherEvent,
  time: number,
): Point | undefined {
  if (event.kind !== "storm" || !event.from || !event.to) return undefined;
  const span = Math.max(1, event.clearsAt - event.onsetAt);
  const progress = Math.min(1, Math.max(0, (time - event.onsetAt) / span));
  return {
    x: event.from.x + (event.to.x - event.from.x) * progress,
    y: event.from.y + (event.to.y - event.from.y) * progress,
  };
}

export function activeWeather(state: Shift, kind?: WeatherKind): WeatherEvent[] {
  return state.weather.filter(
    (w) => w.status === "active" && (kind ? w.kind === kind : true),
  );
}

export function isStormActive(state: Shift): boolean {
  return activeWeather(state, "storm").length > 0;
}

export function isIcingActive(state: Shift): boolean {
  return activeWeather(state, "icing").length > 0;
}

export function weatherHeadline(state: Shift): string {
  if (activeWeather(state, "storm").length) return "雷雨影响机坪";
  if (activeWeather(state, "icing").length) return "低温结冰运行";
  const pending = state.weather.filter(
    (w) => w.forecastIssued && w.status === "forecast",
  );
  if (pending.length) return "天气预警生效";
  return "机场运行正常";
}

function issueText(event: WeatherEvent): string {
  const impact =
    event.kind === "storm"
      ? "可能出现雷雨、侧风与机坪作业中断"
      : "可能出现低温结冰，放行需完成除冰保护";
  return `气象台发布${event.title}预报：预计 ${rangeLabel(event.onsetRange)} 影响本场，持续 ${Math.round(event.durationRange[0] / 60)}–${Math.round(event.durationRange[1] / 60)} 分钟；${impact}`;
}

/**
 * Applies forecast issuance, onset and clearance exactly once. The persisted
 * flags make pause, speed changes, save/load and reopening immune to
 * duplicated transitions.
 */
export function advanceWeather(state: Shift): Shift {
  const s = copyShift(state);
  for (const w of s.weather) {
    if (!w.forecastIssued && s.time >= w.forecastFrom) {
      w.forecastIssued = true;
      record(s, issueText(w), "warning");
    }
    if (!w.onsetApplied && s.time >= w.onsetAt) {
      w.onsetApplied = true;
      w.status = "active";
      record(
        s,
        w.kind === "storm"
          ? `雷达确认：${w.title}已进入机坪，影响半径约 ${w.radius} m（${clockExact(w.onsetAt)}）` +
              `；影响区机位暂停保障，车辆须撤往避险区`
          : `${w.title}生效（${clockExact(w.onsetAt)}）：机坪进入结冰条件，放行须持有有效除冰保护`,
        "warning",
      );
    }
    if (w.status === "active" && !w.clearApplied && s.time >= w.clearsAt) {
      w.clearApplied = true;
      w.status = "cleared";
      record(s, `${w.title}解除（${clockExact(w.clearsAt)}），天气条件恢复`, "success");
    }
  }
  return s;
}
