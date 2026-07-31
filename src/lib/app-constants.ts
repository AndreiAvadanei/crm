export const APP_NAME = "Bit Sentinel";

/**
 * Neutral, unbranded name shown on pre-authentication surfaces (browser tab
 * title, sign-in screen). Anonymous visitors must not be able to identify the
 * company behind this workspace, so nothing here may reveal APP_NAME.
 */
export const PUBLIC_APP_NAME = "Workspace";

/**
 * Safety cap for list/board queries that load the full result set (no
 * pagination) and then sort / group / split it in memory.
 *
 * It must comfortably exceed realistic row counts: a cap below the true count
 * combined with an ORDER BY biases which rows land inside the window (e.g.
 * MySQL clusters NULLs at one end of a sort), so rows appear/disappear as the
 * sort changes. It also bounds <select> option lists so every record stays
 * selectable. Replace with real pagination if datasets outgrow this bound.
 */
export const LIST_FETCH_CAP = 5000;

/** Default row count for paginated list pages. */
export const CLIENTS_PAGE_SIZE = 25;

/**
 * Deals loaded per stage column/section on first paint, and per "load more"
 * batch as the user scrolls a column. Kept small so the board/table open fast
 * regardless of pipeline size; per-column totals still reflect the full set
 * (computed server-side via aggregate, not from the loaded rows).
 */
export const DEALS_PAGE_SIZE = 10;

/** Row count per section (overdue / upcoming) on the Tasks board. */
export const TASKS_PAGE_SIZE = 15;
