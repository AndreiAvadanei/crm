import type { Metadata } from "next";
import { DealDetail, getDealMetadata } from "@/components/deals/deal-detail";

type DealDetailPageProps = {
  params: Promise<{ salesId: string }>;
};

export async function generateMetadata({ params }: DealDetailPageProps): Promise<Metadata> {
  const { salesId } = await params;
  return getDealMetadata(salesId);
}

export default async function DealDetailPage({ params }: DealDetailPageProps) {
  const { salesId } = await params;
  return <DealDetail salesId={salesId} />;
}
