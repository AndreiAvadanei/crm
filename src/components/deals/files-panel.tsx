"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, FileIcon, Trash2, Download, ExternalLink } from "lucide-react";
import { uploadAttachmentAction, deleteAttachmentAction } from "@/server/deal-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

export type AttachmentView = {
  id: string;
  filename: string;
  size: number;
  createdAt: string;
  sourceUrl: string | null;
  onDisk: boolean;
};

function humanSize(bytes: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

export function FilesPanel({ dealId, attachments }: { dealId: string; attachments: AttachmentView[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadAttachmentAction(dealId, fd);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "File uploaded", variant: "success" });
    router.refresh();
  }

  async function remove(id: string) {
    await deleteAttachmentAction(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <input ref={inputRef} type="file" className="hidden" onChange={onPick} />
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload />} Upload file
        </Button>
      </div>
      <div className="space-y-1.5">
        {attachments.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <FileIcon className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium">{a.filename}</div>
              <div className="text-xs text-muted-foreground">
                {humanSize(a.size)} · {formatDate(a.createdAt)}
              </div>
            </div>
            {a.onDisk ? (
              <a href={`/api/attachments/${a.id}`} className="text-muted-foreground hover:text-primary">
                <Download className="h-4 w-4" />
              </a>
            ) : a.sourceUrl ? (
              <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" title="Original Jira link">
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
            <button onClick={() => remove(a.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {attachments.length === 0 && <p className="text-sm text-muted-foreground">No files attached.</p>}
      </div>
    </div>
  );
}
