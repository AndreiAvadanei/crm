import type { LucideIcon } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function TableEmpty({
  colSpan,
  icon,
  title,
  description,
}: {
  colSpan: number;
  icon?: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        <EmptyState icon={icon} title={title} description={description} />
      </TableCell>
    </TableRow>
  );
}
