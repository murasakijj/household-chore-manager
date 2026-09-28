import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getSettings, type SettingsResponse } from "../lib/api";
import { SettingsContext } from "./settings-context";

const DEFAULT_TIMEZONE = "Asia/Tokyo";

export default function SettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // レビュー指摘 #2: 取得失敗時はエラー状態を持ち、未処理rejectを起こさない
  // (呼び出し側の `void refresh()` でも安全)。
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSettings();
      setSettings(result);
    } catch {
      setError("設定の読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loading,
        error,
        timezone: settings?.household.timezone ?? DEFAULT_TIMEZONE,
        refresh,
        setSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
