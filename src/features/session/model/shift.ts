import type { Shift } from "../../../shared/types";
import { initialFlights } from "../../flights";
import { initialStands } from "../../apron";
import { initialServices } from "../../services";
import { initialVehicles } from "../../fleet";
import { initialWeather } from "../../weather";
export function createShift(): Shift {
  const flights = initialFlights();
  // Each shift draws its own script, but the seed is saved with it so a
  // reload replays exactly the same weather.
  const weatherSeed = Math.floor(Math.random() * 0x7fffffff);
  return {
    version: 2,
    time: 0,
    paused: false,
    speed: 1,
    score: 0,
    conflicts: 0,
    flights,
    stands: initialStands(),
    services: initialServices(flights),
    vehicles: initialVehicles(),
    weatherSeed,
    weather: initialWeather(weatherSeed),
    events: [
      { id: 0, time: 0, text: "早班开始 · 3 架航班等待机位分配", tone: "info" },
    ],
    selectedFlightId: "MU2451",
    nextEventId: 1,
  };
}
