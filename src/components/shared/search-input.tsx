"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchInput({ placeholder = "Search…", className }: { placeholder?: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [, startTransition] = useTransition();

  function update(next: string) {
    setValue(next);
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (next) sp.set("q", next);
    else sp.delete("q");
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  return (
    <div className="relative w-full max-w-xs">
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        className={`pl-8 ${className ?? ""}`}
      />
    </div>
  );
}
