import { AgentHome } from "@/components/agent-home";
import { readDetectionSnapshot } from "@/lib/clickhouse/detections";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialDetection = await readDetectionSnapshot();
  return <AgentHome initialDetection={initialDetection} />;
}
