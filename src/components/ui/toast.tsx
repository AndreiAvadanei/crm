"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";
type ToastItem = { id: number; title: string; description?: string; variant: ToastVariant };

type ToastContextValue = {
  toast: (t: { title: string; description?: string; variant?: ToastVariant }) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);

  const toast = React.useCallback(
    ({ title, description, variant = "info" }: { title: string; description?: string; variant?: ToastVariant }) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, title, description, variant }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4500);
    },
    []
  );

  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-card p-4 shadow-sm animate-in slide-in-from-bottom-2",
              t.variant === "error" && "border-destructive/40",
              t.variant === "success" && "border-[var(--success)]/40"
            )}
          >
            {t.variant === "success" && <CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--success)]" />}
            {t.variant === "error" && <XCircle className="mt-0.5 h-5 w-5 text-destructive" />}
            {t.variant === "info" && <Info className="mt-0.5 h-5 w-5 text-primary" />}
            <div className="flex-1">
              <div className="text-sm font-medium">{t.title}</div>
              {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
