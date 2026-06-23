// Shared (client + server safe) sort metadata for the clients list.
// Kept free of `server-only` so the sort <select> client component can import it.

export type ClientSort = "recent" | "name" | "deals" | "value";

export const CLIENT_SORT_OPTIONS: { value: ClientSort; label: string }[] = [
  { value: "recent", label: "Last activity" },
  { value: "name", label: "Name" },
  { value: "deals", label: "Most deals" },
  { value: "value", label: "Open pipeline" },
];
