import { describe, expect, it } from "vitest";
import { GLASS_DEFAULTS, nextAppearance, parseGlass, resolveDark } from "@/lib/appearance";
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

  it("keeps glass values per appearance and ignores the old shared blob", () => {
    expect(parseGlass(null)).toEqual(GLASS_DEFAULTS);
    expect(parseGlass("not json")).toEqual(GLASS_DEFAULTS);
    expect(parseGlass(JSON.stringify({ alpha: 40, blur: 4 }))).toEqual(GLASS_DEFAULTS);
    expect(
      parseGlass(JSON.stringify({ light: { alpha: 70, blur: 8 }, dark: { alpha: 40, blur: 20 } }))
    ).toEqual({
      light: { alpha: 70, blur: 8 },
      dark: { alpha: 40, blur: 20 },
    });
    expect(parseGlass(JSON.stringify({ light: { alpha: 200, blur: -4 }, dark: {} }))).toEqual({
      light: { alpha: 100, blur: 0 },
      dark: GLASS_DEFAULTS.dark,
    });
  });
});

describe("viewport palette", () => {
  it("uses a light paper ground in light appearance and keeps the dark canvas", () => {
    expect(viewportPalette(true).background).toBe(0x17191d);
    expect(viewportPalette(false).background).toBe(0xf5f6f8);
    expect(viewportPalette(false).closed).not.toBe(viewportPalette(true).closed);
  });
});
