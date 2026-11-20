import type { Shift } from "../../../shared/types";
const kinds = ["fuel", "baggage", "clean", "deice"];
const coreKinds = ["fuel", "baggage", "clean"];
const flightStates = [
  "scheduled",
  "incoming",
  "parked",
  "departing",
  "departed",
];
const serviceStates = ["pending", "travel", "working", "interrupted", "done"];
const vehicleStates = [
  "idle",
  "travel",
  "working",
  "returning",
  "evading",
  "sheltered",
];
const weatherKinds = ["storm", "icing"];
const weatherStates = ["forecast", "active", "cleared"];
type Row = Record<string, unknown>;
function row(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function boolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
function point(value: unknown): boolean {
  return row(value) && finite(value.x) && finite(value.y);
}
function range(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    finite(value[0]) &&
    finite(value[1]) &&
    value[0] <= value[1]
  );
}
function unique(values: Row[]): boolean {
  return (
    values.every((x) => text(x.id)) &&
    new Set(values.map((x) => x.id)).size === values.length
  );
}
function collection(value: unknown, length: number): value is Row[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(row) &&
    unique(value)
  );
}
export function validShift(value: unknown): value is Shift {
  if (
    !row(value) ||
    value.version !== 2 ||
    !finite(value.time) ||
    value.time < 0 ||
    !finite(value.score) ||
    !finite(value.conflicts) ||
    value.conflicts < 0 ||
    !boolean(value.paused) ||
    ![1, 2, 4].includes(value.speed as number) ||
    !finite(value.weatherSeed) ||
    !finite(value.nextEventId)
  )
    return false;
  if (
    !collection(value.flights, 6) ||
    !collection(value.stands, 6) ||
    !collection(value.vehicles, 8) ||
    !collection(value.services, 24) ||
    !Array.isArray(value.weather) ||
    value.weather.length !== 2 ||
    !value.weather.every(row) ||
    !Array.isArray(value.events) ||
    value.events.length > 30
  )
    return false;
  const flights = value.flights,
    stands = value.stands,
    vehicles = value.vehicles,
    services = value.services,
    weather = value.weather as Row[];
  const flightIds = new Set(flights.map((x) => x.id)),
    standIds = new Set(stands.map((x) => x.id)),
    vehicleIds = new Set(vehicles.map((x) => x.id)),
    serviceIds = new Set(services.map((x) => x.id));
  if (
    !flights.every(
      (f) =>
        text(f.airline) &&
        text(f.from) &&
        text(f.destination) &&
        text(f.aircraft) &&
        ["narrow", "wide"].includes(f.size as string) &&
        flightStates.includes(f.status as string) &&
        finite(f.arrival) &&
        finite(f.deadline) &&
        finite(f.passengers) &&
        f.passengers > 0 &&
        text(f.color) &&
        (f.departureAt === undefined || finite(f.departureAt)) &&
        (f.standId === undefined || standIds.has(f.standId)) &&
        validRelease(f),
    )
  )
    return false;
  if (
    !stands.every(
      (s) =>
        point(s) &&
        ["narrow", "wide"].includes(s.size as string) &&
        text(s.terminal) &&
        boolean(s.deice),
    )
  )
    return false;
  if (
    !weather.every((w) => {
      if (
        !text(w.id) ||
        !weatherKinds.includes(w.kind as string) ||
        !weatherStates.includes(w.status as string) ||
        !text(w.title) ||
        !finite(w.forecastFrom) ||
        !range(w.onsetRange) ||
        !range(w.durationRange) ||
        !finite(w.onsetAt) ||
        !finite(w.clearsAt) ||
        w.clearsAt <= w.onsetAt ||
        !boolean(w.forecastIssued) ||
        !boolean(w.onsetApplied) ||
        !boolean(w.clearApplied) ||
        ![1, 2, 3].includes(w.severity as number) ||
        !finite(w.radius) ||
        w.radius < 0 ||
        !range(w.radiusRange)
      )
        return false;
      if (w.status === "active" && !w.onsetApplied) return false;
      if (w.status === "cleared" && (!w.onsetApplied || !w.clearApplied))
        return false;
      if (w.kind === "storm" && (!point(w.from) || !point(w.to))) return false;
      return true;
    })
  )
    return false;
  if (
    !vehicles.every(
      (v) =>
        kinds.includes(v.kind as string) &&
        vehicleStates.includes(v.status as string) &&
        point(v.position) &&
        point(v.origin) &&
        point(v.target) &&
        finite(v.progress) &&
        v.progress >= 0 &&
        v.progress <= 100 &&
        finite(v.tripDuration) &&
        v.tripDuration > 0 &&
        (v.serviceId === undefined || serviceIds.has(v.serviceId)) &&
        (v.avoidReason === undefined || text(v.avoidReason)) &&
        (v.safePointName === undefined || text(v.safePointName)),
    )
  )
    return false;
  if (
    !services.every(
      (s) =>
        flightIds.has(s.flightId) &&
        kinds.includes(s.kind as string) &&
        serviceStates.includes(s.status as string) &&
        finite(s.progress) &&
        s.progress >= 0 &&
        s.progress <= 100 &&
        finite(s.duration) &&
        s.duration > 0 &&
        (s.vehicleId === undefined || vehicleIds.has(s.vehicleId)) &&
        (s.completedAt === undefined || finite(s.completedAt)) &&
        (s.protectionUntil === undefined || finite(s.protectionUntil)) &&
        (s.interruptReason === undefined || text(s.interruptReason)),
    )
  )
    return false;
  if (
    !flights.every((f) =>
      kinds.every(
        (k) =>
          services.filter((t) => t.flightId === f.id && t.kind === k).length ===
          1,
      ),
    )
  )
    return false;
  const occupied = flights
    .filter((f) => f.status !== "departed" && f.standId !== undefined)
    .map((f) => f.standId);
  if (new Set(occupied).size !== occupied.length) return false;
  if (
    !flights.every(
      (f) =>
        !["parked", "departing", "departed"].includes(f.status as string) ||
        (standIds.has(f.standId) &&
          (f.size === "narrow" ||
            stands.find((s) => s.id === f.standId)?.size === "wide")),
    )
  )
    return false;
  if (
    !services.every((s) => {
      if (s.status === "pending")
        return s.progress === 0 && s.vehicleId === undefined;
      if (s.status === "done") {
        if (s.progress !== 100) return false;
        if (s.kind === "deice")
          return (
            finite(s.completedAt) &&
            finite(s.protectionUntil) &&
            (s.protectionUntil as number) > (s.completedAt as number)
          );
        return true;
      }
      if (s.status === "interrupted") {
        const v = vehicles.find((x) => x.id === s.vehicleId);
        return !v || v.kind === s.kind;
      }
      const v = vehicles.find((x) => x.id === s.vehicleId);
      if (!v || v.kind !== s.kind) return false;
      return (
        v.serviceId === s.id &&
        v.status === s.status &&
        flights.find((f) => f.id === s.flightId)?.status === "parked"
      );
    })
  )
    return false;
  if (
    !vehicles.every(
      (v) =>
        !["travel", "working"].includes(v.status as string) ||
        services.some(
          (s) =>
            s.id === v.serviceId &&
            s.vehicleId === v.id &&
            s.status === v.status,
        ),
    )
  )
    return false;
  if (
    !flights.every(
      (f) =>
        services.filter(
          (t) =>
            t.flightId === f.id &&
            ["travel", "working"].includes(t.status as string),
        ).length <= 2,
    )
  )
    return false;
  if (
    !flights.every(
      (f) =>
        !["departing", "departed"].includes(f.status as string) ||
        services
          .filter((t) => t.flightId === f.id && coreKinds.includes(t.kind as string))
          .every((t) => t.status === "done"),
    )
  )
    return false;
  if (
    !value.events.every(
      (e) =>
        row(e) &&
        finite(e.id) &&
        finite(e.time) &&
        text(e.text) &&
        ["info", "success", "warning"].includes(e.tone as string),
    )
  )
    return false;
  const events = value.events as Row[];
  if (
    new Set(events.map((e) => e.id)).size !== events.length ||
    events.some((e) => (e.id as number) >= (value.nextEventId as number))
  )
    return false;
  return (
    flightIds.has(value.selectedFlightId) &&
    (value.selectedStandId === undefined ||
      standIds.has(value.selectedStandId)) &&
    (value.selectedVehicleId === undefined ||
      vehicleIds.has(value.selectedVehicleId))
  );
}

function validRelease(f: Row): boolean {
  if (f.releaseAttempt !== undefined) {
    const a = f.releaseAttempt;
    if (
      !row(a) ||
      a.mode !== "risk" ||
      !finite(a.startedAt) ||
      !finite(a.resolveAt) ||
      !finite(a.chance) ||
      a.chance < 0 ||
      a.chance > 1 ||
      !finite(a.roll) ||
      a.roll < 0 ||
      a.roll > 1 ||
      a.resolveAt <= a.startedAt
    )
      return false;
  }
  if (f.releasePlan !== undefined) {
    const p = f.releasePlan;
    if (
      !row(p) ||
      !finite(p.until) ||
      !finite(p.chosenAt) ||
      p.until < p.chosenAt ||
      !Array.isArray(p.weatherIds) ||
      !p.weatherIds.every(text) ||
      (p.deiceTaskId !== undefined && !text(p.deiceTaskId))
    )
      return false;
  }
  if (f.releaseAttempt !== undefined && f.releasePlan !== undefined) return false;
  if (
    f.releaseCooldownUntil !== undefined &&
    !finite(f.releaseCooldownUntil)
  )
    return false;
  return true;
}
