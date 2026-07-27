"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { renderCommentHtml, commentHasContent } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

// Legacy descriptions were stored as plain text (with real newlines); newer ones
// are rich HTML from the editor. Detect HTML so plain text keeps its line breaks.
function looksLikeHtml(s: string) {
  return /<[a-z][\s\S]*?>/i.test(s);
}

// Convert legacy plain text to paragraph/line-break HTML so the editor and the
// stored value keep the original multi-line formatting.
function plainToHtml(s: string) {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return s
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Reuse the deal's rich editor (with image upload) lazily, browser-only.
const RichTextEditor = dynamic(() => import("./rich-text-editor"), {
  ssr: false,
  loading: () => <div className="h-[220px] rounded-lg border bg-muted/30" aria-hidden />,
});

export function DealDescription({
  dealId,
  description,
}: {
  dealId: string;
  description: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const isHtml = !!description && looksLikeHtml(description);
  // Normalize to HTML for the editor so legacy plain-text keeps its line breaks.
  const editorValue = description ? (isHtml ? description : plainToHtml(description)) : "";
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(editorValue);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const hasDescription = !!description && commentHasContent(description);

  async function save() {
    if (uploading) return;
    setBusy(true);
    const res = await quickUpdateDealAction(dealId, { description: body });
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setBody(editorValue);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <RichTextEditor
          value={body}
          onChange={setBody}
          placeholder="Describe the deal… (paste or drop images to attach)"
          disabled={busy}
          uploadDealId={dealId}
          onUploadingChange={setUploading}
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || uploading}>
            {(busy || uploading) && <Loader2 className="h-4 w-4 animate-spin" />}
            {uploading ? "Uploading…" : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  if (!hasDescription) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Pencil className="h-4 w-4" />
        Add a description…
      </button>
    );
  }

  return (
    <div className="group relative">
      <div
        className={cn("comment-html text-sm", !isHtml && "whitespace-pre-wrap")}
        dangerouslySetInnerHTML={{ __html: renderCommentHtml(description!) }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => setEditing(true)}
        className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
    </div>
  );
}
