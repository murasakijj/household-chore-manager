import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";

export default function Login() {
  const {
    user,
    loading,
    accessDenied,
    authError,
    signInError,
    sessionExpiredMessage,
    signIn,
    retryAuthorization,
    signOutUser,
  } = useAuth();

  // ログイン(認証+認可)済みならホームへ。RequireAuthが children を表示する条件と揃える。
  if (user && !loading && !accessDenied && !authError) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="login-page">
      <h1>家事管理</h1>
      <p className="login-lead">
        家事を「定期メンテナンス対象」として管理します。
      </p>
      {loading && user && <p role="status">認証を確認しています...</p>}
      {accessDenied && <p role="alert">アクセス権がありません。</p>}
      {authError && (
        <>
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
            onClick={() => void signOutUser()}
          >
            ログアウトしてやり直す
          </button>
        </>
      )}
      {sessionExpiredMessage && <p role="alert">{sessionExpiredMessage}</p>}
      {signInError && <p role="alert">{signInError}</p>}
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void signIn()}
      >
        Googleでログイン
      </button>
    </main>
  );
}
