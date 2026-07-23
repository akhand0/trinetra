import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, Eye, Sparkles } from "lucide-react";
import { VisualResponseGroup } from "@/components/visual-response";
import { readSharedVisualResponse } from "@/lib/clickhouse/shared-visual-responses";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shared Trinetra investigation",
  description: "A read-only visual investigation shared from Trinetra.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function SharedInvestigationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await readSharedVisualResponse(token);
  if (!shared) notFound();

  return (
    <main className="shared-report-page">
      <div className="shared-report-shell">
        <nav className="shared-report-nav" aria-label="Shared report navigation">
          <Link href="/">
            <ArrowLeft size={15} /> Open Trinetra
          </Link>
          <span>
            <Sparkles size={14} /> trinetra
          </span>
        </nav>

        <header className="shared-report-intro">
          <div>
            <span>
              <Eye size={15} /> Shared visual investigation
            </span>
            <h1>{shared.response.title}</h1>
            {shared.response.query && <p>{shared.response.query}</p>}
          </div>
          <dl>
            <div>
              <dt>Shared</dt>
              <dd>{timestamp(shared.createdAt)} UTC</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>
                <Clock3 size={12} /> {timestamp(shared.expiresAt)} UTC
              </dd>
            </div>
          </dl>
        </header>

        <div className="agent-thread shared-report-thread">
          <article className="assistant has-visual has-composed-visual">
            <VisualResponseGroup
              data={shared.response}
              query={shared.response.query}
              mode="shared"
            />
          </article>
        </div>
      </div>
    </main>
  );
}
