import { DealModal } from "@/components/deals/deal-modal";
import { DealDetail } from "@/components/deals/deal-detail";

type InterceptedDealPageProps = {
  params: Promise<{ salesId: string }>;
};

// Intercepts soft navigations to /deals/[salesId] (from the deals list, board,
// etc.) and renders the deal inside a modal so filters/scroll are preserved.
// A hard load / refresh of the same URL renders the standalone page instead.
export default async function InterceptedDealPage({ params }: InterceptedDealPageProps) {
  const { salesId } = await params;
  return (
    <DealModal>
      <DealDetail salesId={salesId} variant="modal" />
    </DealModal>
  );
}
