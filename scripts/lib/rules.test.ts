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
  it("小文字に正規化し、重複を除く", () => {
    expect(parseAllowedEmails("A@X.com, a@x.COM,B@y.org")).toEqual([
      "a@x.com",
      "b@y.org",
    ]);
    expect(() => parseAllowedEmails("You@Example.com")).toThrow(/placeholder/);
  });
  it("`$` とバッククォートを含むメールは中断", () => {
    expect(() => parseAllowedEmails("a$&b@x.com")).toThrow(/Invalid/);
    expect(() => parseAllowedEmails("a`b@x.com")).toThrow(/Invalid/);
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
  it("置換文字列の特殊パターン($&, $1 など)は文字どおり扱う", () => {
    const out = renderRules("x in ['you@example.com'] y", ["a$&b@x.com"]);
    expect(out).toBe("x in ['a$&b@x.com'] y");
  });
  it("テンプレートにプレースホルダが無い/複数あるなら中断", () => {
    expect(() => renderRules("rules", ["a@x.com"])).toThrow(/exactly one/);
    expect(() =>
      renderRules("'you@example.com' 'you@example.com'", ["a@x.com"]),
    ).toThrow(/exactly one/);
  });
});
