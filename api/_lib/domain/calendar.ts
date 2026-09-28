/**
 * 暦日(タイムゾーン付き "YYYY-MM-DD")の計算。外部ライブラリを使わず
 * `Intl.DateTimeFormat` と `Date.UTC` のみで実装する(設計書 §7.3)。
 */

/** `instant` を `timezone` の暦日 "YYYY-MM-DD" に変換する。 */
export function localDate(instant: Date, timezone: string): string {
  // en-CA ロケールは "YYYY-MM-DD" 形式を返す。
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(instant);
}

/**
 * "YYYY-MM-DD" 同士の暦日差を返す(`laterDate - earlierDate`)。
 * うるう年・月末・年末年始をまたいでも正しく計算できるよう、
 * 実時刻ではなく `Date.UTC` 上の日数差で求める。
 */
export function diffCalendarDays(
  laterDate: string,
  earlierDate: string,
): number {
  const later = parseDateOnly(laterDate);
  const earlier = parseDateOnly(earlierDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((later - earlier) / msPerDay);
}

function parseDateOnly(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** `instant` に対して `timezone` における暦日差ベースで `days` 日を加えた日付文字列を返す。 */
export function addCalendarDays(dateStr: string, days: number): string {
  const base = parseDateOnly(dateStr);
  const result = new Date(base + days * 24 * 60 * 60 * 1000);
  const y = result.getUTCFullYear();
  const m = String(result.getUTCMonth() + 1).padStart(2, "0");
  const d = String(result.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `now` と `lastCompletedAt`(いずれも実時刻)の、`timezone` における暦日差。 */
export function elapsedCalendarDays(
  now: Date,
  lastCompletedAt: Date,
  timezone: string,
): number {
  return diffCalendarDays(
    localDate(now, timezone),
    localDate(lastCompletedAt, timezone),
  );
}
