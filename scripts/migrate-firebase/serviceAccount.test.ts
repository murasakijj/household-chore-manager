import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadServiceAccounts, readServiceAccount } from "./serviceAccount.js";

const SECRET =
  "-----BEGIN PRIVATE KEY-----SECRETVALUE123-----END PRIVATE KEY-----";
const valid = {
  type: "service_account",
  project_id: "proj-a",
  private_key: SECRET,
  client_email: "sa@proj-a.iam.gserviceaccount.com",
};

let dir: string;
const p = (name: string) => join(dir, name);
const write = (name: string, data: string | Buffer) =>
  writeFileSync(p(name), data);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sa-test-"));
  write("ok.json", JSON.stringify(valid));
  write("bom.json", "\uFEFF" + JSON.stringify(valid));
  write("bad.json", `{ "private_key": "${SECRET}" `);
  write(
    "utf16le.json",
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(JSON.stringify(valid), "utf16le"),
    ]),
  );
  write("noproject.json", JSON.stringify({ ...valid, project_id: undefined }));
  write("badtype.json", JSON.stringify({ ...valid, type: "authorized_user" }));
  write("nokey.json", JSON.stringify({ ...valid, private_key: undefined }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function failure(file: string) {
  const r = readServiceAccount("--old-service-account", p(file));
  if (r.ok) throw new Error("expected failure");
  return r.message;
}

describe("readServiceAccount", () => {
  it("reads a valid file", () => {
    const r = readServiceAccount("--old-service-account", p("ok.json"));
    expect(r.ok && r.sa.project_id).toBe("proj-a");
  });

  it("strips a UTF-8 BOM", () => {
    const r = readServiceAccount("--old-service-account", p("bom.json"));
    expect(r.ok && r.sa.project_id).toBe("proj-a");
  });

  it("reports a missing file with label, path and extension hint", () => {
    const m = failure("missing.json");
    expect(m).toContain("--old-service-account");
    expect(m).toContain(p("missing.json"));
    expect(m).toContain("not found");
    expect(m).toContain(".json.json");
  });

  it("reports unreadable files with the error code only", () => {
    const m = failure(""); // the directory itself: EISDIR
    expect(m).toContain("could not read");
    expect(m).toContain("EISDIR");
  });

  it("reports invalid JSON without leaking content", () => {
    const m = failure("bad.json");
    expect(m).toContain("not valid JSON");
    expect(m).not.toContain("SECRETVALUE");
  });

  it("detects UTF-16", () => {
    expect(failure("utf16le.json")).toContain("UTF-16");
  });

  it("reports missing project_id", () => {
    expect(failure("noproject.json")).toContain("project_id");
  });

  it("reports wrong type", () => {
    expect(failure("badtype.json")).toContain("service_account");
  });

  it("reports missing private_key", () => {
    expect(failure("nokey.json")).toContain("private_key");
  });

  it("expands ~ using the given home", () => {
    const r = readServiceAccount("--new-service-account", "~/ok.json", dir);
    expect(r.ok).toBe(true);
  });
});

describe("loadServiceAccounts", () => {
  it("returns both on success", () => {
    const r = loadServiceAccounts(p("ok.json"), p("bom.json"));
    expect(r.oldSa.project_id).toBe("proj-a");
  });

  it("reports both failures together without secrets", () => {
    let msg = "";
    try {
      loadServiceAccounts(p("missing.json"), p("bad.json"));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("--old-service-account");
    expect(msg).toContain("--new-service-account");
    expect(msg).toContain("not found");
    expect(msg).toContain("not valid JSON");
    expect(msg).not.toContain("SECRETVALUE");
  });
});
