import { createContext } from "react";
import type { SettingsResponse } from "../lib/api";

export interface SettingsContextValue {
  settings: SettingsResponse | null;
  loading: boolean;
  /** 家庭のタイムゾーン。設定未取得時は `Asia/Tokyo`(設計書 §7.2 の初期値)。 */
  timezone: string;
  refresh: () => Promise<void>;
  setSettings: (value: SettingsResponse) => void;
}

export const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);
