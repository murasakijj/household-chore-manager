import { describe, it, expect, vi, beforeEach } from "vitest";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

const { sendPushNotification, isPushConfigured, PushNotConfiguredError, PushSubscriptionGoneError } =
  await import("./send.js");

const subscription = {
  id: "sub-1",
  householdId: "h1",
  memberId: "m1",
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "p256dh-value", auth: "auth-value" },
  createdAt: new Date(),
};

const payload = { title: "t", body: "b", url: "/" };

describe("push/send", () => {
  beforeEach(() => {
    sendNotification.mockReset();
    setVapidDetails.mockReset();
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  it("isPushConfigured: 3つとも設定されていればtrue", () => {
    expect(isPushConfigured()).toBe(true);
  });

  it("isPushConfigured: 1つでも欠けていればfalse", () => {
    delete process.env.VAPID_SUBJECT;
    expect(isPushConfigured()).toBe(false);
  });

  it("VAPID未設定でsendPushNotificationを呼ぶとPushNotConfiguredError", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    await expect(sendPushNotification(subscription, payload)).rejects.toBeInstanceOf(
      PushNotConfiguredError,
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("10秒のtimeoutオプションを付けて送信する(レビュー指摘 #4)", async () => {
    sendNotification.mockResolvedValue(undefined);
    await sendPushNotification(subscription, payload);
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload),
      { timeout: 10_000 },
    );
  });

  it.each([400, 403, 404, 410])(
    "statusCode %i は PushSubscriptionGoneError に正規化する(レビュー指摘 #11)",
    async (statusCode) => {
      sendNotification.mockRejectedValue(Object.assign(new Error("bad"), { statusCode }));
      await expect(sendPushNotification(subscription, payload)).rejects.toBeInstanceOf(
        PushSubscriptionGoneError,
      );
    },
  );

  it("statusCode 500 はGoneではなく素通りする", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("server error"), { statusCode: 500 }));
    await expect(sendPushNotification(subscription, payload)).rejects.not.toBeInstanceOf(
      PushSubscriptionGoneError,
    );
  });

  it("鍵(p256dh/auth)の形式エラーのような、statusCode無しの暗号化エラーもGone扱いにする(レビュー指摘 #11)", async () => {
    sendNotification.mockRejectedValue(new Error("Unable to decode base64 key"));
    await expect(sendPushNotification(subscription, payload)).rejects.toBeInstanceOf(
      PushSubscriptionGoneError,
    );
  });

  it("statusCode無しでも鍵と無関係なエラー(ネットワークタイムアウト等)はGone扱いにしない", async () => {
    sendNotification.mockRejectedValue(new Error("network timeout"));
    await expect(sendPushNotification(subscription, payload)).rejects.not.toBeInstanceOf(
      PushSubscriptionGoneError,
    );
  });
});
