import { describe, expect, it } from "vitest";
import { expandHome } from "./paths.js";

describe("expandHome", () => {
  const home = "/home/u";
  it("expands ~, ~/ and ~\\", () => {
    expect(expandHome("~", home)).toBe(home);
    expect(expandHome("~/keys/a.json", home)).toBe("/home/u/keys/a.json");
    expect(expandHome("~\\keys\\a.json", home)).toMatch(/keys.a\.json$/);
  });
  it("leaves other paths alone", () => {
    expect(expandHome("C:\\keys\\a.json", home)).toBe("C:\\keys\\a.json");
    expect(expandHome("/abs/~/a.json", home)).toBe("/abs/~/a.json");
    expect(expandHome("~user/a.json", home)).toBe("~user/a.json");
  });
});
