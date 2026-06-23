export const APP_NAME = "Bit Sentinel";

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
