import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { patchSettings } from "../lib/api";
import { useAuth } from "../contexts/useAuth";
import { useSettings } from "../contexts/useSettings";
import { useToast } from "../contexts/useToast";
import { describeApiError } from "../lib/errorMessages";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

const COMMON_TIMEZONES = [
  "Asia/Tokyo",
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
];

/** レビュー指摘 #13: 送信前にタイムゾーンをクライアントでも検証する。 */
function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export default function Settings() {
  const {
    settings,
    loading,
    error: loadError,
    refresh,
    setSettings,
  } = useSettings();
  const { signOutUser } = useAuth();
  const { showToast } = useToast();

  const [dailySummaryEnabled, setDailySummaryEnabled] = useState(false);
  const [dailySummaryTime, setDailySummaryTime] = useState("08:00");
  const [includeUpcoming, setIncludeUpcoming] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Tokyo");
  const [oneTapComplete, setOneTapComplete] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDailySummaryEnabled(settings.notification.dailySummaryEnabled);
    setDailySummaryTime(settings.notification.dailySummaryTime);
    setIncludeUpcoming(settings.notification.includeUpcoming);
    setTimezone(settings.household.timezone);
    setOneTapComplete(settings.notification.oneTapComplete);
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidTimezone(timezone)) {
      setError("タイムゾーンの指定が正しくありません。");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await patchSettings({
        dailySummaryEnabled,
        dailySummaryTime,
        includeUpcoming,
        timezone,
        oneTapComplete,
      });
      setSettings(result);
      showToast({ message: "設定を保存しました。" });
    } catch (err) {
      setError(describeApiError(err, "保存に失敗しました。"));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) {
    return (
      <>
        <PageHeader title="設定" />
        <Skeleton rows={4} />
      </>
    );
  }

  // レビュー指摘 #2: settings が無い間はフォームを出さず、既定値での上書き保存もできない。
  if (!settings) {
    return (
      <>
        <PageHeader title="設定" />
        <p role="alert">{loadError ?? "設定を読み込めませんでした。"}</p>
        <button type="button" className="btn" onClick={() => void refresh()}>
          再試行
        </button>
      </>
    );
  }

  return (
    <>
      <PageHeader title="設定" />
      <form className="form" onSubmit={(e) => void handleSubmit(e)}>
        {error && <p role="alert">{error}</p>}
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={dailySummaryEnabled}
            onChange={(e) => setDailySummaryEnabled(e.target.checked)}
          />
          朝のまとめ通知
        </label>
        <label className="form-field">
          通知時刻
          <input
            type="time"
            value={dailySummaryTime}
            onChange={(e) => setDailySummaryTime(e.target.value)}
            disabled={!dailySummaryEnabled}
          />
        </label>
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={includeUpcoming}
            onChange={(e) => setIncludeUpcoming(e.target.checked)}
            disabled={!dailySummaryEnabled}
          />
          通知に「そろそろ」を含める
        </label>
        <label className="form-field">
          タイムゾーン
          <input
            type="text"
            list="timezone-options"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
          <datalist id="timezone-options">
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </label>
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={oneTapComplete}
            onChange={(e) => setOneTapComplete(e.target.checked)}
          />
          「やった」を1タップで即記録する
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void refresh()}
            disabled={saving}
          >
            元に戻す
          </button>
        </div>
      </form>

      <section className="detail-block">
        <h2>マスタ管理</h2>
        <ul className="link-list">
          <li>
            <Link className="btn" to="/settings/areas">
              場所の管理
            </Link>
          </li>
          <li>
            <Link className="btn" to="/settings/categories">
              カテゴリの管理
            </Link>
          </li>
          <li>
            <Link className="btn" to="/settings/resources">
              対象リソースの管理
            </Link>
          </li>
        </ul>
      </section>

      <section className="detail-block">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void signOutUser()}
        >
          ログアウト
        </button>
      </section>
    </>
  );
}
