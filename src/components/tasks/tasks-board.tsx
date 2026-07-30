"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { bulkCompleteTasksAction } from "@/server/quick-actions";
import { TaskItem } from "@/components/tasks/task-item";
import { TaskSheet } from "@/components/tasks/task-sheet";
import { TasksFilters } from "@/components/tasks/tasks-filter-bar";
import { QuickAddTask, type QuickAddDeal } from "@/components/tasks/quick-add-task";
import { type TaskItemData } from "@/components/tasks/task-common";
import { SearchInput } from "@/components/shared/search-input";
import { Pagination } from "@/components/shared/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";

type Section = {
  rows: TaskItemData[];
  title: string;
  empty: string;
  total: number;
  page: number;
  pageParam: "overduePage" | "upcomingPage";
};

const TASK_PAGE_PARAMS: Section["pageParam"][] = ["overduePage", "upcomingPage"];

/**
 * Client wrapper around the Tasks page lists. One-line toolbar (backend search +
 * filters popover + select-all), a sticky bulk-complete bar, and rows that open
 * a full editor drawer on click. Search, filtering and pagination all run in the
 * backend; selection is keyed by task id so it survives navigation.
 */
export function TasksBoard({
  overdue,
  upcoming,
  overdueTotal,
  upcomingTotal,
  overduePage,
  upcomingPage,
  pageSize,
  owners,
  deals,
  admin,
}: {
  overdue: TaskItemData[];
  upcoming: TaskItemData[];
  overdueTotal: number;
  upcomingTotal: number;
  overduePage: number;
  upcomingPage: number;
  pageSize: number;
  owners: { id: string; name: string }[];
  deals: QuickAddDeal[];
  admin: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = useMemo(
    () => [...overdue, ...upcoming].find((t) => t.id === activeId) ?? null,
    [overdue, upcoming, activeId]
  );

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Select/deselect every task in a single section (Overdue or Upcoming) on the
  // current page — each section owns its own select-all so they act independently.
  function toggleSection(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function completeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await bulkCompleteTasksAction(ids);
      if (res.error) return toast({ title: res.error, variant: "error" });
      toast({
        title: `${res.completed} task${res.completed === 1 ? "" : "s"} completed`,
        variant: "success",
      });
      clearSelection();
      router.refresh();
    });
  }

  // Carry every current param through pagination links except the one this
  // section owns (the Pagination component sets that). Keeps the sibling
  // section's page — and all filters/search — intact while paging one column.
  const paramsExcluding = (own: Section["pageParam"]) => {
    const params: Record<string, string | undefined> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== own) params[key] = value;
    }
    return params;
  };

  const q = searchParams.get("q")?.trim() ?? "";

  const sections: Section[] = [
    {
      rows: overdue,
      title: "Overdue",
      empty: "Nothing overdue.",
      total: overdueTotal,
      page: overduePage,
      pageParam: "overduePage",
    },
    {
      rows: upcoming,
      title: "Upcoming",
      empty: "No upcoming tasks.",
      total: upcomingTotal,
      page: upcomingPage,
      pageParam: "upcomingPage",
    },
  ];

  return (
    <div>
      {/* Toolbar: backend search + filters + add task on one line (select-all lives per section) */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6">
        <SearchInput
          placeholder="Search tasks, deals, assignees…"
          wrapperClassName="min-w-0 flex-1 sm:max-w-sm"
          clearParams={TASK_PAGE_PARAMS}
        />
        <TasksFilters owners={owners} showAssigneeFilter={admin} />
        <div className="ml-auto">
          <QuickAddTask deals={deals} owners={owners} admin={admin} />
        </div>
      </div>

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 shadow-sm md:mx-6">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={pending}>
              <X className="h-4 w-4" /> Clear
            </Button>
            <Button size="sm" onClick={completeSelected} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Complete selected
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
        {sections.map((section) => {
          const sectionIds = section.rows.map((t) => t.id);
          const selectedCount = sectionIds.filter((id) => selected.has(id)).length;
          const allSelected = sectionIds.length > 0 && selectedCount === sectionIds.length;
          const someSelected = selectedCount > 0;
          return (
          <Card key={section.title}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle
                className={`flex items-center gap-2 ${
                  section.title === "Overdue" ? "text-destructive" : ""
                }`}
              >
                {section.title}{" "}
                <Badge variant={section.title === "Overdue" ? "destructive" : "secondary"}>
                  {section.total}
                </Badge>
              </CardTitle>
              <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-normal text-muted-foreground">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(c) => toggleSection(sectionIds, c !== false)}
                  disabled={sectionIds.length === 0}
                  aria-label={`Select all ${section.title} tasks on this page`}
                />
                Select page
              </label>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.rows.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  showDeal
                  showSnooze
                  onOpen={() => setActiveId(t.id)}
                  selected={selected.has(t.id)}
                  onSelectChange={(checked) => toggleOne(t.id, checked)}
                />
              ))}
              {section.rows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {q ? "No matching tasks." : section.empty}
                </p>
              )}
              {section.total > pageSize && (
                <Pagination
                  pathname="/tasks"
                  params={paramsExcluding(section.pageParam)}
                  pageParam={section.pageParam}
                  page={section.page}
                  total={section.total}
                  pageSize={pageSize}
                  itemLabel="task"
                  className="mt-3"
                />
              )}
            </CardContent>
          </Card>
          );
        })}
      </div>

      <TaskSheet
        task={active}
        owners={owners}
        admin={admin}
        open={activeId !== null && active !== null}
        onOpenChange={(o) => !o && setActiveId(null)}
      />
    </div>
  );
}
