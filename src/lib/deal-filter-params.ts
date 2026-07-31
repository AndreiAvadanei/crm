// Client-safe deal list types + helpers (no prisma / server-only imports) so
// both the server query builder and the client board/table views can share
// them. Keeps the load-more round-trip and the first-paint render in lockstep.

/**
 * The subset of `/deals` search params that shape the deal list query. Passed
 * from the server page to the client views and back into the load-more action
 * so every fetch (first page, "load more", "load all") applies the *identical*
 * RBAC scope + filters + sort.
 */
export type DealFilterParams = {
  q?: string;
  owner?: string;
  tag?: string;
  stage?: string;
  status?: string;
  sort?: string;
  dir?: string;
  amtMin?: string;
  amtMax?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: string;
  mine?: string;
  stale?: string;
};

/** Keys of {@link DealFilterParams} — used to project a raw searchParams bag. */
const DEAL_FILTER_KEYS: (keyof DealFilterParams)[] = [
  "q",
  "owner",
  "tag",
  "stage",
  "status",
  "sort",
  "dir",
  "amtMin",
  "amtMax",
  "dueFrom",
  "dueTo",
  "overdue",
  "mine",
  "stale",
];

/** Narrow an arbitrary searchParams object down to the deal filter params. */
export function pickDealFilterParams(sp: Record<string, string | undefined>): DealFilterParams {
  const out: DealFilterParams = {};
  for (const k of DEAL_FILTER_KEYS) {
    const v = sp[k];
    if (v) out[k] = v;
  }
  return out;
}

/** Per-stage rollup: how many matching deals and their total pipeline value. */
export type StageTotal = { count: number; value: number };
