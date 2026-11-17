import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("parses all options", () => {
    const r = parseArgs([
      "--app",
      "recipe-buddy",
      "--email",
      "a@example.com",
      "--old-service-account",
      "C:\\keys\\old.json",
      "--new-service-account",
      "C:\\keys\\new.json",
      "--collections",
      "recipes,techniques",
      "--execute",
      "--overwrite",
    ]);
    expect(r.v).toEqual({
      "--app": "recipe-buddy",
      "--email": "a@example.com",
      "--old-service-account": "C:\\keys\\old.json",
      "--new-service-account": "C:\\keys\\new.json",
      "--collections": "recipes,techniques",
    });
    expect(r.execute).toBe(true);
    expect(r.overwrite).toBe(true);
  });

  it("defaults flags to false", () => {
    const r = parseArgs(["--app", "x"]);
    expect(r.execute).toBe(false);
    expect(r.overwrite).toBe(false);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown argument: --bogus");
  });

  it("rejects a missing value", () => {
    expect(() => parseArgs(["--email"])).toThrow("--email requires a value");
  });
});
