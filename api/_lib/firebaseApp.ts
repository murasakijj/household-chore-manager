import { getApps, initializeApp, cert, type App } from "firebase-admin/app";

let cachedApp: App | undefined;

/**
 * firebase-admin の App を1つだけ初期化して使い回す。`auth.ts`(IDトークン検証)と
 * `repo/firestoreRepo.ts`(Firestore アクセス)の両方から共有される。
 */
export function getFirebaseApp(): App {
  if (cachedApp) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  }

  const serviceAccount = JSON.parse(raw) as Parameters<typeof cert>[0];
  cachedApp = initializeApp({ credential: cert(serviceAccount) });
  return cachedApp;
}
