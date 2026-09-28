import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Service Worker はPush通知受信とPWAインストール可否のために本番のみ登録する
// (architecture.md「朝のまとめ通知ジョブ」)。開発中の再登録によるキャッシュ事故を避ける。
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      console.error("[sw] registration failed", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
