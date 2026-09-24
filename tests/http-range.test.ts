import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/http-range";

describe("parseRange", () => {
  it("parses the single-range forms browsers and pdf.js send", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange(" bytes=10-20 ", 1000)).toEqual({ start: 10, end: 20 });
  });
  it("falls back to the full body for absent, multi-range or malformed headers", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-10,20-30", 1000)).toBeNull();
    expect(parseRange("items=0-10", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("bytes=0-10", 0)).toBeNull();
  });
  it("reports unsatisfiable ranges", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-10", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});
