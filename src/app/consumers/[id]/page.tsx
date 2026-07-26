import { ConsumerDetail } from "@/components/consumer-detail";
import { getOpsSnapshot } from "@/lib/mock-data";

export function generateStaticParams() {
  return getOpsSnapshot("24h").consumers.map((consumer) => ({
    id: consumer.id,
  }));
}

export default async function ConsumerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ConsumerDetail key={id} consumerId={id} />;
}
