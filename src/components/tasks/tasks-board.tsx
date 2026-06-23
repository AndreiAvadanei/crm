"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Search, X } from "lucide-react";
import { bulkCompleteTasksAction } from "@/server/quick-actions";
import { TaskRow, type TaskRowData } from "@/components/tasks/task-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";

type Section = { rows: TaskRowData[]; title: string; empty: string };

/**
 * Client wrapper around the Tasks page lists. Adds a free-text search that
 * narrows the visible rows, multi-select checkboxes (with select-all), and a
 * sticky bulk-complete bar. Selection is keyed by task id so it survives
 * search filtering (a hidden-then-shown task keeps its checked state).
 */
export function TasksBoard({
  overdue,
  upcoming,
  owners,
  admin,
}: {
  overdue: TaskRowData[];
  upcoming: TaskRowData[];
  owners: { id: string; name: string }[];
  admin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const match = (t: TaskRowData) =>
    !q ||
    t.title.toLowerCase().includes(q) ||
    t.dealTitle.toLowerCase().includes(q) ||
    t.dealSalesId.toLowerCase().includes(q) ||
    (t.assigneeName?.toLowerCase().includes(q) ?? false);

  const visibleOverdue = useMemo(() => overdue.filter(match), [overdue, q]);
  const visibleUpcoming = useMemo(() => upcoming.filter(match), [upcoming, q]);
  const visibleIds = useMemo(
    () => [...visibleOverdue, ...visibleUpcoming].map((t) => t.id),
    [visibleOverdue, visibleUpcoming]
  );

  const selectedVisibleCount = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0;

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
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

  const sections: Section[] = [
    { rows: visibleOverdue, title: "Overdue", empty: "Nothing overdue." },
    { rows: visibleUpcoming, title: "Upcoming", empty: "No upcoming tasks." },
  ];

  return (
    <div>
      {/* Search + select-all controls */}
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 md:px-6">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, deals, assignees…"
            className="pl-8"
            aria-label="Search tasks"
          />
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
            onCheckedChange={(c) => toggleAllVisible(c !== false)}
            disabled={visibleIds.length === 0}
            aria-label="Select all visible tasks"
          />
          Select all{q ? " matching" : ""} ({visibleIds.length})
        </label>
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
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle
                className={`flex items-center gap-2 ${
                  section.title === "Overdue" ? "text-destructive" : ""
                }`}
              >
                {section.title}{" "}
                <Badge variant={section.title === "Overdue" ? "destructive" : "secondary"}>
                  {section.rows.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.rows.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  owners={owners}
                  admin={admin}
                  selected={selected.has(t.id)}
                  onSelectChange={(checked) => toggleOne(t.id, checked)}
                />
              ))}
              {section.rows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {q ? "No matching tasks." : section.empty}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
