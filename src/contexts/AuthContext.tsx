import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FirebaseError } from "firebase/app";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import {
  checkAuth,
  ApiError,
  type HouseholdDto,
  type MemberDto,
} from "../lib/api";
import { AuthContext } from "./auth-context";

/** signInWithPopup失敗時のエラーコードを日本語メッセージに変換する。 */
function signInErrorMessage(err: unknown): string | null {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case "auth/popup-blocked":
        return "ポップアップがブロックされました。ブラウザの設定を確認してください。";
      case "auth/unauthorized-domain":
        return "このドメインは Firebase で承認されていません。";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        // ユーザーが自分でポップアップを閉じただけなのでエラー表示しない。
        return null;
      default:
        return "ログインに失敗しました。";
    }
  }
  return "ログインに失敗しました。";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [member, setMember] = useState<MemberDto | null>(null);
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<
    string | null
  >(null);

  // authorize() の多重実行防止。onAuthStateChangedのリスナーとsignIn()の
  // 明示呼び出しが競合しても、後から来た方は同じ実行を待つだけにする。
  const authorizeInFlightRef = useRef<Promise<void> | null>(null);

  const authorize = useCallback((): Promise<void> => {
    if (authorizeInFlightRef.current) {
      return authorizeInFlightRef.current;
    }

    const run = async () => {
      setLoading(true);
      setAuthError(false);
      try {
        const result = await checkAuth();
        setMember(result.member);
        setHousehold(result.household);
        setLoading(false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setAccessDenied(true);
          try {
            await signOut(auth);
          } catch {
            // サインアウト自体が失敗しても下のfinallyでloadingは解除する。
          } finally {
            setLoading(false);
          }
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          setSessionExpiredMessage(
            "認証が切れました。再度ログインしてください。",
          );
          try {
            await signOut(auth);
          } catch {
            // 同上。
          } finally {
            setLoading(false);
          }
          return;
        }
        setAuthError(true);
        setLoading(false);
      }
    };

    const promise = run().finally(() => {
      authorizeInFlightRef.current = null;
    });
    authorizeInFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        void authorize();
      } else {
        setLoading(false);
      }
    });
  }, [authorize]);

  const signIn = async () => {
    setAccessDenied(false);
    setAuthError(false);
    setSignInError(null);
    setSessionExpiredMessage(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setSignInError(signInErrorMessage(err));
      return;
    }
    // すでにサインイン済みだった場合、onAuthStateChangedは再発火せず
    // authorize()が呼ばれないため、ここで明示的に呼んで
    // /api/auth-check を必ず通す(認可バイパスの防止)。
    // authorizeが同時に走っていれば(リスナー由来)その完了を待つだけになる。
    await authorize();
  };

  const signOutUser = async () => {
    try {
      await signOut(auth);
    } catch {
      console.warn("signOut failed");
    } finally {
      setLoading(false);
      setAuthError(false);
      setAccessDenied(false);
      setSignInError(null);
      setSessionExpiredMessage(null);
      setMember(null);
      setHousehold(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accessDenied,
        authError,
        member,
        household,
        signInError,
        sessionExpiredMessage,
        signIn,
        signOutUser,
        retryAuthorization: authorize,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
