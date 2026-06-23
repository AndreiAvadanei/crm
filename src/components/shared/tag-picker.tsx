"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TagView } from "./tag-badge";

export function TagPicker({ tags, defaultSelected = [] }: { tags: TagView[]; defaultSelected?: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const on = selected.has(t.id);
        return (
          <button
            type="button"
            key={t.id}
            onClick={() => toggle(t.id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
              on ? "text-white" : "text-muted-foreground hover:bg-accent"
            )}
            style={on ? { backgroundColor: t.color, borderColor: t.color } : { borderColor: `${t.color}55` }}
          >
            {t.name}
          </button>
        );
      })}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="tagIds" value={id} />
      ))}
      {tags.length === 0 && <span className="text-xs text-muted-foreground">No tags configured.</span>}
    </div>
  );
}
