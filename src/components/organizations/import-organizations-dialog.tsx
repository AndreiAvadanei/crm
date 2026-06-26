"use client";

import { useRef, useState } from "react";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogOpenTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importOrganizationsAction, previewOrganizationsImportAction } from "@/server/organization-actions";
import type { OrgImportPreviewAction, OrgImportPreviewResult, OrgImportResult } from "@/lib/org-import";

type BusyState = "preview" | "import" | null;
type PreviewFilter = OrgImportPreviewAction | "all";

const actionLabel: Record<OrgImportPreviewAction, string> = {
  create: "Creează",
  update: "Actualizează",
  skip: "Ignoră",
};

const actionVariant: Record<OrgImportPreviewAction, ComponentProps<typeof Badge>["variant"]> = {
  create: "success",
  update: "default",
  skip: "secondary",
};

export function ImportOrganizationsDialog({ trigger }: { trigger: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<OrgImportPreviewResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("all");
  const [result, setResult] = useState<OrgImportResult | null>(null);
  const filteredPreviewRows = preview
    ? preview.rows.filter((row) => previewFilter === "all" || row.action === previewFilter)
    : [];

  function reset() {
    setPreview(null);
    setPreviewFilter("all");
    setResult(null);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function selectedFile() {
    const file = inputRef.current?.files?.[0];
    if (!file) toast({ title: "Selectați un fișier", variant: "error" });
    return file;
  }

  async function onPreview(e: FormEvent) {
    e.preventDefault();
    const file = selectedFile();
    if (!file) return;
    setBusy("preview");
    setPreview(null);
    setPreviewFilter("all");
    setResult(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await previewOrganizationsImportAction(fd);
    setBusy(null);
    if (res.error || !res.result) return toast({ title: res.error ?? "Previzualizare eșuată", variant: "error" });
    setPreview(res.result);
    if (res.result.errors.length > 0 && res.result.rows.length === 0) {
      return toast({ title: "Verificați coloanele din fișier", variant: "error" });
    }
    toast({
      title: `Previzualizare: ${res.result.created} create, ${res.result.updated} actualizate`,
      variant: "success",
    });
  }

  async function onConfirmImport() {
    const file = selectedFile();
    if (!file) return;
    setBusy("import");
    const fd = new FormData();
    fd.set("file", file);
    const res = await importOrganizationsAction(fd);
    setBusy(null);
    if (res.error || !res.result) return toast({ title: res.error ?? "Import eșuat", variant: "error" });
    setResult(res.result);
    setPreview(null);
    toast({
      title: `Import: ${res.result.created} create, ${res.result.updated} actualizate`,
      variant: "success",
    });
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogOpenTrigger trigger={trigger} onOpen={() => setOpen(true)} />
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import organizații</DialogTitle>
          <DialogDescription>
            Încarcă un export <code>.xls</code>/<code>.xlsx</code> (format „clienți”). Rândurile se
            previzualizează înainte de confirmare și se actualizează după denumire.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onPreview} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">Fișier</Label>
            <label
              htmlFor="file"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-sm transition-colors hover:bg-accent/50"
            >
              <FileSpreadsheet className="h-6 w-6 shrink-0 text-muted-foreground" />
              <span className="truncate">{fileName || "Alege un fișier .xls / .xlsx…"}</span>
            </label>
            <input
              ref={inputRef}
              id="file"
              name="file"
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                setFileName(e.target.files?.[0]?.name ?? "");
                setPreview(null);
                setPreviewFilter("all");
                setResult(null);
              }}
            />
          </div>

          {preview && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Total: <strong>{preview.total}</strong></span>
                <span className="text-green-600 dark:text-green-400">De creat: <strong>{preview.created}</strong></span>
                <span className="text-blue-600 dark:text-blue-400">De actualizat: <strong>{preview.updated}</strong></span>
                <span className="text-muted-foreground">De ignorat: <strong>{preview.skipped}</strong></span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Filtrează:</span>
                <Button
                  type="button"
                  size="sm"
                  variant={previewFilter === "all" ? "default" : "outline"}
                  onClick={() => setPreviewFilter("all")}
                >
                  Toate ({preview.rows.length})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewFilter === "create" ? "default" : "outline"}
                  onClick={() => setPreviewFilter("create")}
                >
                  Creează ({preview.created})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewFilter === "update" ? "default" : "outline"}
                  onClick={() => setPreviewFilter("update")}
                >
                  Actualizează ({preview.updated})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewFilter === "skip" ? "default" : "outline"}
                  onClick={() => setPreviewFilter("skip")}
                >
                  Ignoră ({preview.skipped})
                </Button>
              </div>
              <div className="max-h-72 overflow-auto rounded-md border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Rând</TableHead>
                      <TableHead>Organizație</TableHead>
                      <TableHead>CUI</TableHead>
                      <TableHead>Localitate</TableHead>
                      <TableHead>Acțiune</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPreviewRows.map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                        <TableCell className="max-w-64 truncate font-medium">{row.sourceName}</TableCell>
                        <TableCell className="text-muted-foreground">{row.taxId ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{row.location ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={actionVariant[row.action]}>{actionLabel[row.action]}</Badge>
                            {row.reason && <span className="text-xs text-muted-foreground">{row.reason}</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredPreviewRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          Nu există rânduri pentru filtrul selectat.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {preview.errors.length > 0 && (
                <details className="text-xs text-destructive">
                  <summary className="cursor-pointer">{preview.errors.length} avertizări / erori</summary>
                  <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4">
                    {preview.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Total: <strong>{result.total}</strong></span>
                <span className="text-green-600 dark:text-green-400">Create: <strong>{result.created}</strong></span>
                <span className="text-blue-600 dark:text-blue-400">Actualizate: <strong>{result.updated}</strong></span>
                <span className="text-muted-foreground">Ignorate: <strong>{result.skipped}</strong></span>
              </div>
              {result.errors.length > 0 && (
                <details className="text-xs text-destructive">
                  <summary className="cursor-pointer">{result.errors.length} erori</summary>
                  <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4">
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" variant="outline" disabled={busy !== null}>
              {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy === "preview" ? "Se previzualizează…" : "Previzualizează"}
            </Button>
            <Button
              type="button"
              disabled={busy !== null || !preview || preview.created + preview.updated === 0}
              onClick={onConfirmImport}
            >
              {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {busy === "import" ? "Se importă…" : "Confirmă importul"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
