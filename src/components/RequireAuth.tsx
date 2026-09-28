import type { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const {
    user,
    loading,
    accessDenied,
    authError,
    retryAuthorization,
    signOutUser,
  } = useAuth();
  const navigate = useNavigate();

  const handleSignOutAndRetry = async () => {
    await signOutUser();
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <main className="page-center">
        <p role="status">読み込み中...</p>
      </main>
    );
  }

  if (!user || accessDenied) {
    return <Navigate to="/login" replace />;
  }

  if (authError) {
    return (
      <main className="page-center">
        <p role="alert">認証サーバーに接続できませんでした。</p>
        <button
          type="button"
          className="btn"
          onClick={() => void retryAuthorization()}
        >
          再試行
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void handleSignOutAndRetry()}
        >
          ログアウトしてやり直す
        </button>
      </main>
    );
  }

  return <>{children}</>;
}
