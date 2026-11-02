import { describe, expect, it } from "vitest";
import { distanceMeters } from "./geo";

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters({ lat: -0.4201, lng: 36.9476 }, { lat: -0.4201, lng: 36.9476 })).toBe(0);
  });

  it("is close to the known distance between Nyeri and Nairobi", () => {
    // Great-circle distance is about 98 km; the road is longer.
    const meters = distanceMeters({ lat: -0.4201, lng: 36.9476 }, { lat: -1.2921, lng: 36.8219 });
    expect(meters).toBeGreaterThan(95_000);
    expect(meters).toBeLessThan(100_000);
  });
});
