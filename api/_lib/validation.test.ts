import { describe, it, expect } from "vitest";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "./validation.js";

/** レビュー指摘 #4: Push購読先は https + 既知のPushサービスのホストのみ許可する。 */
describe("pushSubscriptionSchema", () => {
  const validSub = {
    keys: { p256dh: "p256dh-value", auth: "auth-value" },
  };

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://web.push.apple.com/QAAAA",
    "https://updates.push.services.mozilla.com/wpush/v2/xyz",
    "https://push.services.mozilla.com/wpush/v2/xyz",
    "https://wns2-abc.notify.windows.com/w/abc",
  ])("許可済みホスト %s は受理する", (endpoint) => {
    const result = pushSubscriptionSchema.safeParse({ ...validSub, endpoint });
    expect(result.success).toBe(true);
  });

  it("http(非TLS)は拒否する", () => {
    const result = pushSubscriptionSchema.safeParse({
      ...validSub,
      endpoint: "http://fcm.googleapis.com/fcm/send/abc123",
    });
    expect(result.success).toBe(false);
  });

  it("許可リストに無いホストは拒否する(SSRF対策)", () => {
    const result = pushSubscriptionSchema.safeParse({
      ...validSub,
      endpoint: "https://evil.example.com/abc123",
    });
    expect(result.success).toBe(false);
  });

  it("類似ホスト名(接尾一致の誤爆)を拒否する", () => {
    const result = pushSubscriptionSchema.safeParse({
      ...validSub,
      endpoint: "https://notfcm.googleapis.com.evil.com/abc",
    });
    expect(result.success).toBe(false);
  });
});

describe("pushUnsubscribeSchema", () => {
  it("許可リストに無いホストは拒否する", () => {
    const result = pushUnsubscribeSchema.safeParse({
      endpoint: "https://evil.example.com/abc123",
    });
    expect(result.success).toBe(false);
  });

  it("許可済みホストは受理する", () => {
    const result = pushUnsubscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    });
    expect(result.success).toBe(true);
  });
});
