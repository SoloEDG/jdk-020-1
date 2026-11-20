export type ServiceKind = "baggage" | "fuel" | "clean" | "deice";
export type FlightStatus =
  "scheduled" | "incoming" | "parked" | "departing" | "departed";
export type WeatherKind = "storm" | "icing";
export type WeatherStatus = "forecast" | "active" | "cleared";
export type ReleaseMode = "risk" | "wait";
export interface Point {
  x: number;
  y: number;
}
export interface ReleasePlan {
  until: number;
  /** Weather systems the plan is waiting out. */
  weatherIds: string[];
  chosenAt: number;
  /** De-icing task whose protection the plan relies on, to revalidate. */
  deiceTaskId?: string;
}
export interface ReleaseAttempt {
  mode: ReleaseMode;
  startedAt: number;
  resolveAt: number;
  chance: number;
  /** Pre-rolled outcome so pausing or reloading cannot re-roll a decision. */
  roll: number;
}
export interface Flight {
  id: string;
  airline: string;
  from: string;
  destination: string;
  aircraft: string;
  size: "narrow" | "wide";
  arrival: number;
  deadline: number;
  passengers: number;
  status: FlightStatus;
  standId?: string;
  departureAt?: number;
  color: string;
  releaseAttempt?: ReleaseAttempt;
  releasePlan?: ReleasePlan;
  releaseCooldownUntil?: number;
}
export interface Stand extends Point {
  id: string;
  size: "narrow" | "wide";
  terminal: string;
  /** Fixed de-icing pad: de-icing completes faster here. */
  deice: boolean;
}
export interface Service {
  id: string;
  flightId: string;
  kind: ServiceKind;
  status: "pending" | "travel" | "working" | "interrupted" | "done";
  progress: number;
  duration: number;
  vehicleId?: string;
  completedAt?: number;
  protectionUntil?: number;
  interruptReason?: string;
  expiryNotified?: boolean;
}
export type VehicleStatus =
  | "idle"
  | "travel"
  | "working"
  | "returning"
  | "evading"
  | "sheltered";
export interface Vehicle {
  id: string;
  kind: ServiceKind;
  status: VehicleStatus;
  position: Point;
  origin: Point;
  target: Point;
  progress: number;
  tripDuration: number;
  serviceId?: string;
  avoidReason?: string;
  safePointName?: string;
}
/**
 * A weather system. Forecast ranges are public; the actual onset/clear times
 * are only revealed by the simulation when they happen.
 */
export interface WeatherEvent {
  id: string;
  kind: WeatherKind;
  title: string;
  forecastFrom: number;
  onsetRange: [number, number];
  durationRange: [number, number];
  onsetAt: number;
  clearsAt: number;
  status: WeatherStatus;
  /** Issued advisories are the only ones the player is allowed to see. */
  forecastIssued: boolean;
  onsetApplied: boolean;
  clearApplied: boolean;
  severity: 1 | 2 | 3;
  /** Storm track in apron coordinates. Icing has no track. */
  from?: Point;
  to?: Point;
  radius: number;
  radiusRange: [number, number];
}
export interface Event {
  id: number;
  time: number;
  text: string;
  tone: "info" | "success" | "warning";
}
export interface Shift {
  version: 2;
  time: number;
  paused: boolean;
  speed: 1 | 2 | 4;
  score: number;
  conflicts: number;
  flights: Flight[];
  stands: Stand[];
  services: Service[];
  vehicles: Vehicle[];
  weatherSeed: number;
  weather: WeatherEvent[];
  events: Event[];
  selectedFlightId: string;
  selectedStandId?: string;
  selectedVehicleId?: string;
  nextEventId: number;
}
export type CommandResult = (state: Shift) => Shift;
