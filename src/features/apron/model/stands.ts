import type { Stand } from "../../../shared/types";

/**
 * A01/A03/B03 have fixed de-icing pads. All other stands can still be served
 * by a mobile de-icing unit, but the work takes longer there.
 */
export function initialStands(): Stand[] {
  return [
    { id: "A01", size: "narrow", x: 220, y: 250, terminal: "T1", deice: true },
    { id: "A02", size: "narrow", x: 420, y: 250, terminal: "T1", deice: false },
    { id: "A03", size: "wide", x: 650, y: 250, terminal: "T1", deice: true },
    {
      id: "B01",
      size: "narrow",
      x: 220,
      y: 495,
      terminal: "远机位",
      deice: false,
    },
    {
      id: "B02",
      size: "narrow",
      x: 420,
      y: 495,
      terminal: "远机位",
      deice: false,
    },
    {
      id: "B03",
      size: "wide",
      x: 650,
      y: 495,
      terminal: "远机位",
      deice: true,
    },
  ];
}
