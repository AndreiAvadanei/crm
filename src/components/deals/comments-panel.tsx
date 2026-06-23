"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Bell, ChevronDown } from "lucide-react";
import { addCommentAction, deleteCommentAction } from "@/server/deal-actions";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { relativeTime } from "@/lib/utils";
import { renderCommentHtml, commentHasContent } from "@/lib/sanitize";

// Lazily load TinyMCE so it stays out of the initial bundle. ssr:false because
// the editor is browser-only (and self-hosts its script at runtime).
const RichTextEditor = dynamic(() => import("./rich-text-editor"), {
  ssr: false,
  loading: () => <div className="h-[220px] rounded-lg border bg-muted/30" aria-hidden />,
});

export type CommentView = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  authorColor: string | null;
  canDelete: boolean;
};

type NotifyCandidate = { id: string; name: string };

export function CommentsPanel({
  dealId,
  comments,
  notifyCandidates = [],
  defaultNotifyIds = [],
}: {
  dealId: string;
  comments: CommentView[];
  notifyCandidates?: NotifyCandidate[];
  defaultNotifyIds?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // True while one or more pasted/dropped images are still uploading.
  const [uploading, setUploading] = useState(false);
  const [notifyIds, setNotifyIds] = useState<string[]>(() =>
    defaultNotifyIds.filter((id) => notifyCandidates.some((c) => c.id === id))
  );
  const [notifyOpen, setNotifyOpen] = useState(false);

  const hasContent = commentHasContent(body);

  function toggleNotify(id: string, on: boolean) {
    setNotifyIds((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasContent || uploading) return;
    setBusy(true);
    const res = await addCommentAction(dealId, body, notifyIds);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    setBody("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <RichTextEditor
          value={body}
          onChange={setBody}
          placeholder="Write a comment… (paste or drop images to attach)"
          disabled={busy}
          uploadDealId={dealId}
          onUploadingChange={setUploading}
        />
        <div className="flex items-center justify-between gap-2">
          {notifyCandidates.length > 0 ? (
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNotifyOpen((o) => !o)}
                disabled={busy}
              >
                <Bell className="h-4 w-4" />
                {notifyIds.length > 0 ? `Notify ${notifyIds.length}` : "Notify"}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
              {notifyOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setNotifyOpen(false)} aria-hidden />
                  <div className="absolute bottom-full z-20 mb-1 max-h-64 w-56 overflow-y-auto rounded-md border bg-background p-1 shadow-md">
                    {notifyCandidates.map((u) => {
                      const checked = notifyIds.includes(u.id);
                      return (
                        <label
                          key={u.id}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                        >
                          <Checkbox checked={checked} onCheckedChange={(v) => toggleNotify(u.id, v === true)} />
                          <span className="truncate">{u.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={busy || uploading || !hasContent}>
            {(busy || uploading) && <Loader2 className="h-4 w-4 animate-spin" />}
            {uploading ? "Uploading…" : "Comment"}
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <Avatar name={c.authorName ?? "?"} color={c.authorColor} />
            <div className="flex-1 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{c.authorName ?? "Unknown"}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{relativeTime(c.createdAt)}</span>
                  {c.canDelete && (
                    <ConfirmDialog
                      onConfirm={() => deleteCommentAction(c.id)}
                      title="Delete comment?"
                      successMessage="Comment deleted"
                    >
                      <button className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </ConfirmDialog>
                  )}
                </div>
              </div>
              {/* Body is sanitized server-side on write; linkify (smart-links /
                  bare URLs) and sanitize again here before rendering as HTML. */}
              <div
                className="comment-html mt-1 text-sm"
                dangerouslySetInnerHTML={{ __html: renderCommentHtml(c.body) }}
              />
            </div>
          </div>
        ))}
        {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
      </div>
    </div>
  );
}
