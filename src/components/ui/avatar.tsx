"use client";

import * as React from "react";
import { cn, initials } from "@/lib/utils";

export function Avatar({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full text-xs font-medium text-white shrink-0",
        className ?? "h-8 w-8"
      )}
      style={{ backgroundColor: color ?? "oklch(0.55 0.08 250)" }}
      title={name}
    >
      {initials(name) || "?"}
    </div>
  );
}
