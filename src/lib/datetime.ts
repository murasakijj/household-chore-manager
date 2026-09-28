/**
 * `<input type="datetime-local">` の値(タイムゾーン情報を持たない
 * "YYYY-MM-DDTHH:MM" 形式)と、家庭のタイムゾーンにおけるオフセット付き
 * ISO 8601 文字列("YYYY-MM-DDTHH:MM:SS+09:00" 等)を相互変換する。
 *
 * API(`api/_lib/validation.ts` の `isoDateTime`)はオフセット必須で、
 * タイムゾーン無しの文字列は受け付けない(サーバー実行環境依存になるため)。
 * 外部ライブラリを使わず `Intl.DateTimeFormat` のみで実装する。
 */

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatPartsInTimeZone(instant: Date, timeZone: string): DateTimeParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * `timeZone` における `instant` の壁時計時刻を UTC の `Date.UTC` へ詰め直した
 * ミリ秒値を返す。`instant`(実UTC時刻)との差が、その瞬間のタイムゾーンの
 * オフセット(分)になる。
 */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const p = formatPartsInTimeZone(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, "0");
}

/**
 * `datetime-local` の値("YYYY-MM-DDTHH:MM" または秒付き)を、`timeZone` に
 * おける壁時計時刻とみなして実時刻(UTC の `Date`)へ変換する。
 * DST境界をまたぐ場合に備え、オフセット推定を2回行う(標準的な手法)。
 */
export function datetimeLocalToDate(value: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    value,
  );
  if (!match) {
    throw new Error(`invalid datetime-local value: ${value}`);
  }
  const [, y, mo, d, h, mi, s] = match;
  const wallAsUtcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    s ? Number(s) : 0,
  );

  const offset = offsetMinutesAt(new Date(wallAsUtcMs), timeZone);
  let utcMs = wallAsUtcMs - offset * 60000;
  // 1回目の推定で得たUTC時刻でオフセットを取り直し、DST境界付近を補正する。
  const offset2 = offsetMinutesAt(new Date(utcMs), timeZone);
  if (offset2 !== offset) {
    utcMs = wallAsUtcMs - offset2 * 60000;
  }
  return new Date(utcMs);
}

/** `instant` を `timeZone` におけるオフセット付き ISO 8601 文字列に変換する。 */
export function dateToOffsetIsoString(instant: Date, timeZone: string): string {
  const p = formatPartsInTimeZone(instant, timeZone);
  const offset = offsetMinutesAt(instant, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const offsetStr = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(
    Math.abs(offset) % 60,
  )}`;
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(
      p.second,
    )}` + offsetStr
  );
}

/** `datetime-local` の値を、`timeZone` のオフセット付き ISO 8601 文字列に変換する。 */
export function datetimeLocalToOffsetIso(
  value: string,
  timeZone: string,
): string {
  return dateToOffsetIsoString(datetimeLocalToDate(value, timeZone), timeZone);
}

/** ISO 8601 文字列(またはDate)を、`timeZone` における `datetime-local` の値に変換する。 */
export function toDatetimeLocalValue(
  value: string | Date,
  timeZone: string,
): string {
  const instant = typeof value === "string" ? new Date(value) : value;
  const p = formatPartsInTimeZone(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `timeZone` における現在時刻を、日本語ロケールの短い日時文字列にする(一覧・詳細表示用)。 */
export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!value) return "";
  const instant = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

/** `timeZone` における日付のみの短い文字列("YYYY/MM/DD")。 */
export function formatDate(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!value) return "";
  const instant = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(instant);
}
