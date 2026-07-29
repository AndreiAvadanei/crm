"use client";

import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Quick-copy controls for a deal: click the SAL id to copy the code, or the link
 * button to copy the full deal URL. Falls back gracefully when the async
 * clipboard API is unavailable (e.g. non-secure contexts).
 */
export function DealCopyLinks({ salesId }: { salesId: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<"code" | "url" | null>(null);

  async function copy(text: string, kind: "code" | "url", label: string) {
    const ok = await writeClipboard(text);
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
      toast({ title: `${label} copied`, variant: "success" });
    } else {
      toast({ title: "Couldn't copy to clipboard", variant: "error" });
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => copy(salesId, "code", "SAL code")}
        title="Copy SAL code"
        className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {salesId}
        {copied === "code" ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </button>
      <button
        type="button"
        onClick={() => copy(dealUrl(salesId), "url", "Deal link")}
        title="Copy deal link"
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        )}
      >
        {copied === "url" ? <Check className="h-3 w-3 text-green-600" /> : <Link2 className="h-3 w-3" />}
        <span className="hidden sm:inline">Copy link</span>
      </button>
    </div>
  );
}

function dealUrl(salesId: string): string {
  if (typeof window !== "undefined") return `${window.location.origin}/deals/${salesId}`;
  return `/deals/${salesId}`;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
