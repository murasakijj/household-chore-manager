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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSettings();
      setSettings(result);
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
        timezone: settings?.household.timezone ?? DEFAULT_TIMEZONE,
        refresh,
        setSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
