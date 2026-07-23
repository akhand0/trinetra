"use client";

import { useRealtimeStream } from "@trigger.dev/react-hooks";
import { Check, LoaderCircle, Mail, Play, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { startVisualReport } from "@/app/actions";
import type { VisualReportProgress } from "@/trigger/report-stream";

type ReportHandle = {
  runId: string;
  accessToken: string;
};

function LiveReportStatus({ handle }: { handle: ReportHandle }) {
  const { parts, error } = useRealtimeStream<VisualReportProgress>(
    handle.runId,
    "visual-report-progress",
    {
      accessToken: handle.accessToken,
      timeoutInSeconds: 600,
    },
  );
  const latest = parts.at(-1);
  const done = latest?.step === "done";
  const failed = done && latest.emailed === false;

  return (
    <div
      className={`visual-report-status${
        failed ? " failed" : done ? " complete" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      {error ? (
        <>
          <X size={13} /> Stream disconnected
        </>
      ) : failed ? (
        <>
          <X size={13} /> {latest.message}
        </>
      ) : done ? (
        <>
          <Check size={13} /> {latest.message}
        </>
      ) : (
        <>
          <LoaderCircle className="spin" size={13} />
          {latest?.message ?? "Connecting to report run"}
        </>
      )}
    </div>
  );
}

export function VisualReportControl({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState<ReportHandle | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launchReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (launching) return;
    const recipient = email.trim();
    if (!recipient) {
      setError("Enter the email address that should receive the PDF.");
      return;
    }

    setLaunching(true);
    setHandle(null);
    setError(null);

    try {
      const nextHandle = await startVisualReport({
        query,
        email: recipient,
      });
      setHandle(nextHandle);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start the report",
      );
    } finally {
      setLaunching(false);
    }
  }

  if (!open) {
    return (
      <button
        className="visual-report-open"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Mail size={13} /> Email PDF
      </button>
    );
  }

  return (
    <div className="visual-report-control">
      <form onSubmit={launchReport}>
        <Mail size={13} aria-hidden="true" />
        <input
          aria-label="Report delivery email"
          type="email"
          placeholder="Recipient email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" disabled={launching}>
          {launching ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          {launching ? "Sending" : "Send PDF"}
        </button>
        <button
          className="visual-report-close"
          type="button"
          aria-label="Close report controls"
          onClick={() => setOpen(false)}
        >
          <X size={13} />
        </button>
      </form>
      {handle && <LiveReportStatus handle={handle} />}
      {error && <div className="visual-report-error">{error}</div>}
    </div>
  );
}
