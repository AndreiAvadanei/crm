// Shared by the invoices page (server) and the filter bar (client), so both agree
// on which month the list falls back to when the URL carries no date range.

const pad = (n: number) => String(n).padStart(2, "0");

/** First/last day (yyyy-mm-dd) of a yyyy-mm month string. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, mo] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** The month the list shows by default: the current one. */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  return monthBounds(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
}

/** URL flag that opts out of the default month and shows every date. */
export const ALL_DATES_PARAM = "dates";
export const ALL_DATES_VALUE = "all";
