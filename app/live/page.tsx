import { TriggerLiveChat } from "@/components/trigger-live-chat";

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; request?: string }>;
}) {
  const { prompt, request } = await searchParams;
  return <TriggerLiveChat initialPrompt={prompt} requestId={request} />;
}
