export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-end sm:justify-between md:px-8 md:pt-7 md:pb-5">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-[1.75rem] font-semibold leading-none tracking-tight">{title}</h1>
        {description && (
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
