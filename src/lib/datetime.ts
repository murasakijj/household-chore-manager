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

const DAY_MS = 24 * 60 * 60 * 1000;

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

function partsEqual(
  a: DateTimeParts,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): boolean {
  return (
    a.year === y &&
    a.month === mo &&
    a.day === d &&
    a.hour === h &&
    a.minute === mi &&
    a.second === s
  );
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, "0");
}

/**
 * 壁時計時刻(`timeZone` における現地時刻)を実時刻(UTC の `Date`)へ変換する。
 *
 * DST境界の扱いは Temporal の `disambiguation: "compatible"` と同じ方針:
 * - 春時間切替で存在しない時刻(例: 2:00〜2:59が無い)は、切替後へ繰り上げる
 *   (例: 2:30 → 3:30)。
 * - 秋時間切替で重複する時刻(同じ壁時計が2回来る)は、早い方(1回目)を採用する。
 *
 * 判定は、対象日の前日・翌日(DST境界が同日内に複数起きることはない)の
 * オフセットを候補として2通り試し、`timeZone` で実際にその壁時計に
 * フォーマットし直せるかで検証する(外部ライブラリを使わない簡易実装)。
 */
export function datetimeLocalToDate(value: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    value,
  );
  if (!match) {
    throw new Error(`invalid datetime-local value: ${value}`);
  }
  const [, yStr, moStr, dStr, hStr, miStr, sStr] = match;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  const h = Number(hStr);
  const mi = Number(miStr);
  const s = sStr ? Number(sStr) : 0;

  const wallUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);

  const offsetBefore = offsetMinutesAt(new Date(wallUtcMs - DAY_MS), timeZone);
  const offsetAfter = offsetMinutesAt(new Date(wallUtcMs + DAY_MS), timeZone);
  const candBefore = wallUtcMs - offsetBefore * 60000;
  const candAfter = wallUtcMs - offsetAfter * 60000;

  const reproduces = (ms: number) =>
    partsEqual(
      formatPartsInTimeZone(new Date(ms), timeZone),
      y,
      mo,
      d,
      h,
      mi,
      s,
    );

  const validCandidates = Array.from(new Set([candBefore, candAfter])).filter(
    reproduces,
  );
  if (validCandidates.length > 0) {
    // 通常(候補1件)またはDST重複(候補2件): 早い方(1回目)を採用する。
    return new Date(Math.min(...validCandidates));
  }
  // DSTギャップ: 存在しない時刻。切替後(遅い方)へ繰り上げる。
  return new Date(Math.max(candBefore, candAfter));
}

/** `instant` を `timeZone` におけるオフセット付き ISO 8601 文字列に変換する。 */
export function dateToOffsetIsoString(instant: Date, timeZone: string): string {
  const p = formatPartsInTimeZone(instant, timeZone);
  const offset = offsetMinutesAt(instant, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const offsetStr = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(
    Math.abs(offset) % 60,
  )}`;
  const ms = ((instant.getTime() % 1000) + 1000) % 1000;
  const msStr = ms !== 0 ? `.${String(ms).padStart(3, "0")}` : "";
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(
      p.second,
    )}${msStr}` + offsetStr
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

/**
 * `timeZone` における、ある暦日("YYYY-MM-DD")の末尾の瞬間
 * (23:59:59.999、その暦日の最後のミリ秒)を、オフセット付き ISO 8601 文字列で返す。
 * 履歴の期間絞り込み(終了日)に使う。DST境界を含む日でも、翌日0:00の1ms前として
 * 正しく計算する(`datetime-local` の"23:59:59.999"を直接解釈するのではない)。
 */
export function endOfCalendarDayOffsetIso(
  dateStr: string,
  timeZone: string,
): string {
  const nextDay = addOneCalendarDay(dateStr);
  const startOfNextDay = datetimeLocalToDate(`${nextDay}T00:00:00`, timeZone);
  const endInstant = new Date(startOfNextDay.getTime() - 1);
  return dateToOffsetIsoString(endInstant, timeZone);
}

/** "YYYY-MM-DD" の翌日を "YYYY-MM-DD" で返す(タイムゾーンに依存しない純粋な暦計算)。 */
export function addOneCalendarDay(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`invalid date value: ${dateStr}`);
  const [, yStr, moStr, dStr] = match;
  const next = new Date(
    Date.UTC(Number(yStr), Number(moStr) - 1, Number(dStr) + 1),
  );
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(
    next.getUTCDate(),
  )}`;
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

/**
 * 暦日文字列("YYYY-MM-DD"、`nextChangeDate` 等)を "YYYY/MM/DD" 表示にする。
 * `Date` へ変換してタイムゾーン付きで再フォーマットすると、実行環境やタイムゾーンに
 * よって前後の日にずれる恐れがあるため、文字列のまま整形する
 * (`api/_lib/domain/status.ts` の `nextChangeDate` は既に家庭のタイムゾーンでの暦日)。
 */
export function formatCalendarDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, mo, d] = match;
  return `${y}/${mo}/${d}`;
}
