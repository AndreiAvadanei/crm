import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PaginationParams = Record<string, string | undefined>;

function pageHref(pathname: string, params: PaginationParams, page: number): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }

  if (page <= 1) sp.delete("page");
  else sp.set("page", String(page));

  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function Pagination({
  pathname,
  params,
  page,
  total,
  pageSize,
  itemLabel,
  className,
}: {
  pathname: string;
  params: PaginationParams;
  page: number;
  total: number;
  pageSize: number;
  itemLabel: string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div>
        Showing {start}-{end} of {total} {total === 1 ? itemLabel : `${itemLabel}s`}
      </div>
      <div className="flex items-center gap-2">
        {page <= 1 ? (
          <Button type="button" variant="outline" size="sm" disabled>
            <ChevronLeft /> Previous
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(pathname, params, previousPage)}>
              <ChevronLeft /> Previous
            </Link>
          </Button>
        )}
        <span className="px-2 text-xs">
          Page {page} of {totalPages}
        </span>
        {page >= totalPages ? (
          <Button type="button" variant="outline" size="sm" disabled>
            Next <ChevronRight />
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(pathname, params, nextPage)}>
              Next <ChevronRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
