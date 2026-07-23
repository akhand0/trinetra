import Link from "next/link";
import { ArrowLeft, Link2Off, Sparkles } from "lucide-react";

export default function SharedInvestigationNotFound() {
  return (
    <main className="shared-report-page">
      <div className="shared-report-unavailable">
        <span>
          <Sparkles size={15} /> trinetra
        </span>
        <i aria-hidden="true">
          <Link2Off size={28} />
        </i>
        <h1>This shared investigation is unavailable</h1>
        <p>The link may be invalid or its seven-day viewing window has expired.</p>
        <Link href="/">
          <ArrowLeft size={15} /> Open Trinetra
        </Link>
      </div>
    </main>
  );
}
