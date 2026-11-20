import type { Point, Vehicle } from "../../../shared/types";
export function tripSeconds(a: Point, b: Point): number {
  return 5 + Math.hypot(a.x - b.x, a.y - b.y) / 50;
}
export function routePosition(v: Vehicle): Point {
  const t = Math.min(1, v.progress / 100);
  return {
    x: v.origin.x + (v.target.x - v.origin.x) * t,
    y: v.origin.y + (v.target.y - v.origin.y) * t,
  };
}
export const vehicleLabels: Record<Vehicle["kind"], string> = {
  fuel: "加油车",
  baggage: "行李车",
  clean: "清洁车",
  deice: "除冰车",
};
export const vehicleColors: Record<Vehicle["kind"], string> = {
  fuel: "#e5a84e",
  baggage: "#529e9b",
  clean: "#7e8eb1",
  deice: "#b06a6a",
};
export const vehicleStatusLabels: Record<Vehicle["status"], string> = {
  idle: "待命",
  travel: "前往机位",
  working: "作业中",
  returning: "返回车场",
  evading: "驶离影响区",
  sheltered: "避险待命",
};
