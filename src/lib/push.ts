/**
 * Web Push購読まわりのブラウザ側ユーティリティ(architecture.md「朝のまとめ通知ジョブ」、
 * 設計書 §12.4)。iOS SafariはPWAをホーム画面に追加していないと通知APIが使えない。
 */
import { subscribePush, unsubscribePush } from "./api";

export type PushSupportStatus =
  | "unsupported"
  | "sw_not_registered"
  | "ios_needs_home_screen"
  | "denied"
  | "not_subscribed"
  | "subscribed";

/** iPhone/iPod、および iPadOS(User-Agentは"Macintosh"だがタッチ対応)を含む。 */
function isIos(): boolean {
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ は既定でデスクトップ版Safariと同じUser-Agent("Macintosh")を
  // 名乗るため、タッチ対応(maxTouchPoints > 1)と合わせて判定する(レビュー指摘 #8)。
  return navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1;
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

/**
 * 登録済みのService Worker registrationを返す(無ければ `null`)。
 * `navigator.serviceWorker.ready` は登録が無い環境(開発中やSW登録前)では
 * 永久に解決しないため使わない(レビュー指摘 #7)。
 */
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

export async function getPushStatus(): Promise<PushSupportStatus> {
  if (!isPushSupported()) {
    if (isIos() && !isIosStandalone()) return "ios_needs_home_screen";
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const registration = await getRegistration();
  if (!registration) return "sw_not_registered";
  const existing = await registration.pushManager.getSubscription();
  return existing ? "subscribed" : "not_subscribed";
}

function toSubscriptionJson(
  subscription: PushSubscription,
): { endpoint: string; keys: { p256dh: string; auth: string } } {
  return subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
}

/** 通知許可をリクエストし、購読してサーバーへ登録する。 */
export async function enablePush(): Promise<void> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    throw new Error("VITE_VAPID_PUBLIC_KEY is not set");
  }
  const registration = await getRegistration();
  if (!registration) {
    throw new Error("service_worker_not_registered");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("permission_denied");
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapidKey),
  });
  try {
    await subscribePush(toSubscriptionJson(subscription));
  } catch (err) {
    // サーバーへの登録に失敗したら、ブラウザ側の購読も巻き戻す
    // (レビュー指摘 #6。中途半端に「ブラウザだけ購読済み」の状態を残さない)。
    await subscription.unsubscribe().catch(() => undefined);
    throw err;
  }
}

/**
 * 表示中の購読状態をサーバーへ再送する(冪等な upsert)。サーバー側の記録が
 * 何らかの理由(DB再構築等)で欠けていても、設定画面を開くたびに復旧する
 * (レビュー指摘 #6)。ブラウザ側は既に購読済みの場合のみ意味がある。
 */
export async function resyncPushSubscription(): Promise<void> {
  const registration = await getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await subscribePush(toSubscriptionJson(subscription));
}

/** この端末の購読を解除する(ブラウザ側とサーバー側の両方)。 */
export async function disablePush(): Promise<void> {
  const registration = await getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await unsubscribePush(endpoint);
}
