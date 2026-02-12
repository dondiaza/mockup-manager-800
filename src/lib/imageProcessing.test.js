import { describe, expect, it } from "vitest";
import { computeContainPlacement } from "./imageProcessing";

describe("computeContainPlacement", () => {
  it("ajusta horizontal sin recorte", () => {
    const result = computeContainPlacement(1600, 900, 800);
    expect(result.width).toBe(800);
    expect(result.height).toBe(450);
    expect(result.x).toBe(0);
    expect(result.y).toBe(175);
  });

  it("ajusta vertical sin recorte", () => {
    const result = computeContainPlacement(900, 1600, 800);
    expect(result.width).toBe(450);
    expect(result.height).toBe(800);
    expect(result.x).toBe(175);
    expect(result.y).toBe(0);
  });

  it("mantiene cuadrada centrada", () => {
    const result = computeContainPlacement(1200, 1200, 800);
    expect(result.width).toBe(800);
    expect(result.height).toBe(800);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});
