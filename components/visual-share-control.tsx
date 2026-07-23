"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  Share2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createVisualShare } from "@/app/actions";
import type { VisualResponseData } from "@/lib/telemetry/visual-response";

export function VisualShareControl({
  response,
}: {
  response: VisualResponseData;
}) {
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  function markCopied() {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopied(true);
    setStatus("Share link copied.");
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false);
      setStatus("");
    }, 2_400);
  }

  async function copyLink(link: string) {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      markCopied();
      return true;
    } catch {
      setCopied(false);
      setStatus("Link ready. Copy it manually from the field.");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return false;
    }
  }

  async function createLink() {
    if (creating || url) return;
    setCreating(true);
    setError("");
    setStatus("Creating share link.");

    try {
      const result = await createVisualShare({ response });
      const absoluteUrl = new URL(result.path, window.location.origin).toString();
      setUrl(absoluteUrl);
      setExpiresAt(result.expiresAt);
      setStatus("Share link ready.");
      await copyLink(absoluteUrl);
    } catch {
      setError("Couldn’t create the share link. Please try again.");
      setStatus("");
    } finally {
      setCreating(false);
    }
  }

  const expiryLabel = expiresAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(expiresAt))
    : "";

  return (
    <div
      className={`visual-share-control${url ? " ready" : ""}`}
      aria-busy={creating}
    >
      {!url ? (
        <button
          type="button"
          className="visual-share-create"
          aria-label={`Create share link for ${response.title}`}
          disabled={creating}
          onClick={createLink}
        >
          {creating ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <Share2 size={13} />
          )}
          {creating ? "Creating link…" : "Share link"}
        </button>
      ) : (
        <>
          <div className="visual-share-link">
            <Link2 size={13} aria-hidden="true" />
            <input
              ref={inputRef}
              aria-label={`Share link for ${response.title}`}
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              aria-label={`Copy share link for ${response.title}`}
              onClick={() => void copyLink(url)}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open shared investigation ${response.title} in a new tab`}
            >
              <ExternalLink size={13} /> Open
            </a>
          </div>
          <small>
            Anyone with this link can view this snapshot until {expiryLabel}.
          </small>
        </>
      )}
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status}
      </span>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
