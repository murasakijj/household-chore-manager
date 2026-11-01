import { describe, expect, it } from "vitest";
import { parseDeployArgs, pickEmailsRaw } from "./deploy-args.js";
import { parseAllowedEmails } from "./rules.js";

describe("parseDeployArgs", () => {
  it("parses project/emails in both forms", () => {
    expect(
      parseDeployArgs(["--project", "p1", "--emails", "a@x.com,b@y.com"]),
    ).toEqual({
      project: "p1",
      emails: "a@x.com,b@y.com",
      generateOnly: false,
      yes: false,
    });
    const r = parseDeployArgs(["--project=p1", "--emails=a@x.com", "--yes"]);
    expect(r.emails).toBe("a@x.com");
    expect(r.yes).toBe(true);
  });
  it("rejects unknown args", () => {
    expect(() => parseDeployArgs(["--nope"])).toThrow(/Unknown/);
  });
});

describe("pickEmailsRaw", () => {
  it("prefers the argument over the environment", () => {
    expect(pickEmailsRaw("a@x.com", "b@y.com")).toBe("a@x.com");
    expect(pickEmailsRaw(undefined, "b@y.com")).toBe("b@y.com");
    expect(pickEmailsRaw(undefined, undefined)).toBeUndefined();
  });
  it("goes through parseAllowedEmails validation and mentions both ways when unset", () => {
    expect(parseAllowedEmails(pickEmailsRaw("A@X.com", undefined))).toEqual([
      "a@x.com",
    ]);
    expect(() =>
      parseAllowedEmails(pickEmailsRaw(undefined, undefined)),
    ).toThrow(/--emails.*RULES_ALLOWED_EMAILS/);
    expect(() => parseAllowedEmails(pickEmailsRaw("bad", "a@x.com"))).toThrow(
      /Invalid/,
    );
  });
});
