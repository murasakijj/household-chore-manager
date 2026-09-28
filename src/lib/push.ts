/**
 * Web Push購読まわりのブラウザ側ユーティリティ(architecture.md「朝のまとめ通知ジョブ」、
 * 設計書 §12.4)。iOS SafariはPWAをホーム画面に追加していないと通知APIが使えない。
 */
import { subscribePush, unsubscribePush } from "./api";

export type PushSupportStatus =
  | "unsupported"
  | "ios_needs_home_screen"
  | "denied"
  | "not_subscribed"
  | "subscribed";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** iOS SafariでPWAとしてホーム画面から起動されているか(`navigator.standalone`)。 */
function isIosStandalone(): boolean {
  return (
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/** `urlB64ToUint8Array`: VAPID公開鍵(base64url)を `applicationServerKey` 用のバイト列に変換する。 */
function urlB64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getPushStatus(): Promise<PushSupportStatus> {
  if (!isPushSupported()) {
    if (isIos() && !isIosStandalone()) return "ios_needs_home_screen";
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const existing = await registration?.pushManager.getSubscription();
  return existing ? "subscribed" : "not_subscribed";
}

/** 通知許可をリクエストし、購読してサーバーへ登録する。 */
export async function enablePush(): Promise<void> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    throw new Error("VITE_VAPID_PUBLIC_KEY is not set");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("permission_denied");
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapidKey),
  });
  await subscribePush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
}

/** この端末の購読を解除する(ブラウザ側とサーバー側の両方)。 */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await unsubscribePush(endpoint);
}
