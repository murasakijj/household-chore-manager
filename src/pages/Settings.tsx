import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { patchSettings, sendTestPush } from "../lib/api";
import { useAuth } from "../contexts/useAuth";
import { useSettings } from "../contexts/useSettings";
import { useToast } from "../contexts/useToast";
import { describeApiError } from "../lib/errorMessages";
import {
  disablePush,
  enablePush,
  getPushStatus,
  type PushSupportStatus,
} from "../lib/push";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

const PUSH_STATUS_LABEL: Record<PushSupportStatus, string> = {
  unsupported: "この端末・ブラウザは通知に対応していません。",
  ios_needs_home_screen:
    "iPhoneで通知を受け取るには、このアプリをホーム画面に追加してから開き直してください(共有ボタン→「ホーム画面に追加」)。",
  denied:
    "通知がブロックされています。ブラウザの設定からこのサイトの通知を許可してください。",
  not_subscribed: "この端末では通知を受け取っていません。",
  subscribed: "この端末で通知を受け取っています。",
};

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

  const [pushStatus, setPushStatus] = useState<PushSupportStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const refreshPushStatus = useCallback(() => {
    void getPushStatus().then(setPushStatus);
  }, []);

  useEffect(() => {
    refreshPushStatus();
  }, [refreshPushStatus]);

  const handleEnablePush = async () => {
    setPushError(null);
    setPushBusy(true);
    try {
      await enablePush();
      refreshPushStatus();
      showToast({ message: "この端末で通知を受け取るようにしました。" });
    } catch (err) {
      if (err instanceof Error && err.message === "permission_denied") {
        setPushError("通知が許可されませんでした。");
      } else {
        setPushError(describeApiError(err, "通知の設定に失敗しました。"));
      }
    } finally {
      setPushBusy(false);
      refreshPushStatus();
    }
  };

  const handleDisablePush = async () => {
    setPushError(null);
    setPushBusy(true);
    try {
      await disablePush();
      showToast({ message: "この端末の通知を解除しました。" });
    } catch (err) {
      setPushError(describeApiError(err, "解除に失敗しました。"));
    } finally {
      setPushBusy(false);
      refreshPushStatus();
    }
  };

  const handleTestPush = async () => {
    setPushError(null);
    setPushBusy(true);
    try {
      const result = await sendTestPush();
      if (result.sent > 0) {
        showToast({ message: "テスト通知を送信しました。" });
      } else {
        showToast({
          message: "送信先の購読がありません。先に通知を有効にしてください。",
          tone: "warning",
        });
      }
    } catch (err) {
      setPushError(describeApiError(err, "テスト通知の送信に失敗しました。"));
    } finally {
      setPushBusy(false);
    }
  };

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
        <h2>この端末の通知</h2>
        <p>{pushStatus ? PUSH_STATUS_LABEL[pushStatus] : "確認中..."}</p>
        {pushError && <p role="alert">{pushError}</p>}
        <div className="form-actions">
          {pushStatus === "not_subscribed" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pushBusy}
              onClick={() => void handleEnablePush()}
            >
              この端末で通知を受け取る
            </button>
          )}
          {pushStatus === "subscribed" && (
            <>
              <button
                type="button"
                className="btn"
                disabled={pushBusy}
                onClick={() => void handleTestPush()}
              >
                テスト通知を送る
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={pushBusy}
                onClick={() => void handleDisablePush()}
              >
                解除
              </button>
            </>
          )}
        </div>
      </section>

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
