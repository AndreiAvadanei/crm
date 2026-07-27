"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * URL-`q`-bound search box. Grows to fill its row by default and can be focused
 * from anywhere on the page with ⌘F / Ctrl+F (the browser's native find is
 * suppressed so the shortcut always lands here — the primary way people search).
 */
export function SearchInput({
  placeholder = "Search…",
  className,
  wrapperClassName,
  clearParams = ["page"],
}: {
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  /** URL params reset to their default (removed) whenever the query changes. */
  clearParams?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent));
  }, []);

  // ⌘F / Ctrl+F focuses this search instead of the browser's find dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function update(next: string) {
    setValue(next);
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (next) sp.set("q", next);
    else sp.delete("q");
    for (const key of clearParams) sp.delete(key);
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  return (
    <div className={cn("relative w-full min-w-0 sm:max-w-xs", wrapperClassName)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && update("")}
        placeholder={placeholder}
        aria-keyshortcuts={isMac ? "Meta+F" : "Control+F"}
        className={cn("pl-8 pr-14", className)}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            update("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          {isMac ? "⌘" : "Ctrl"}F
        </kbd>
      )}
    </div>
  );
}
