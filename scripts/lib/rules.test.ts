import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAllowedEmails, renderRules } from "./rules.js";

const template = readFileSync("firebase/firestore.rules", "utf8");

describe("parseAllowedEmails", () => {
  it("カンマ区切りを分割・trim する", () => {
    expect(parseAllowedEmails(" a@x.com, b@y.org ")).toEqual([
      "a@x.com",
      "b@y.org",
    ]);
  });
  it("未設定・空は中断", () => {
    expect(() => parseAllowedEmails(undefined)).toThrow(/not set/);
    expect(() => parseAllowedEmails(" , ")).toThrow(/not set/);
  });
  it("プレースホルダ・不正な形式・引用符混入は中断", () => {
    expect(() => parseAllowedEmails("you@example.com")).toThrow(/placeholder/);
    expect(() => parseAllowedEmails("a@x.com,not-an-email")).toThrow(/Invalid/);
    expect(() => parseAllowedEmails("a'] || true || ['@x.com")).toThrow(
      /Invalid/,
    );
  });
});

describe("renderRules", () => {
  it("プレースホルダを許可メールに置換し、残さない", () => {
    const out = renderRules(template, ["a@x.com", "b@y.org"]);
    expect(out).toContain("in ['a@x.com', 'b@y.org']");
    expect(out).not.toContain("you@example.com");
  });
  it("テンプレートにプレースホルダが無い/複数あるなら中断", () => {
    expect(() => renderRules("rules", ["a@x.com"])).toThrow(/exactly one/);
    expect(() =>
      renderRules("'you@example.com' 'you@example.com'", ["a@x.com"]),
    ).toThrow(/exactly one/);
  });
});
