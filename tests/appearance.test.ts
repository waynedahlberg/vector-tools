import { describe, expect, it } from "vitest";
import { nextAppearance, resolveDark } from "@/lib/appearance";
import { viewportPalette } from "@/lib/viewport-theme";

describe("appearance", () => {
  it("lets an explicit choice override the system scheme", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
  });

  it("cycles system, then light, then dark", () => {
    expect(nextAppearance("system")).toBe("light");
    expect(nextAppearance("light")).toBe("dark");
    expect(nextAppearance("dark")).toBe("system");
  });
});

describe("viewport palette", () => {
  it("uses a light paper ground in light appearance and keeps the dark canvas", () => {
    expect(viewportPalette(true).background).toBe(0x17191d);
    expect(viewportPalette(false).background).toBe(0xf5f6f8);
    expect(viewportPalette(false).closed).not.toBe(viewportPalette(true).closed);
  });
});
