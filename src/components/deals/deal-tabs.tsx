"use client";

import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export type DealTab = {
  value: string;
  label: string;
  // A rendered icon element (not a component type) so it can cross the
  // server → client boundary.
  icon: React.ReactNode;
  count: number;
  node: React.ReactNode;
};

/**
 * Generic tabbed card used on the deal page for secondary panels (Invoices,
 * Activity, …). Each tab shows a live count; content is rendered on the server
 * and passed in as nodes.
 */
export function DealTabs({ tabs, defaultValue }: { tabs: DealTab[]; defaultValue?: string }) {
  if (tabs.length === 0) return null;
  return (
    <Card className="p-5 md:p-6">
      <Tabs defaultValue={defaultValue ?? tabs[0].value}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="rounded-full border border-transparent px-3 py-1.5 text-muted-foreground data-[state=active]:border-border/80 data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-sm)]"
            >
              {t.icon}
              {t.label}
              <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {t.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            {t.node}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
