"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { COPY_FEEDBACK_MS } from "../constants";
import { s } from "../styles";

/** Display-only copy-to-clipboard button. Never executes `text` — it only
 *  ever calls `navigator.clipboard.writeText` (AC-8). Announces the copy
 *  result via an `aria-live="polite"` region for screen readers. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations("onboarding");
  const [status, setStatus] = React.useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setStatus("idle"), COPY_FEEDBACK_MS);
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 6,
          border: "1px solid var(--border-strong)",
          background: "var(--bg-elevated)",
          color: status === "copied" ? "var(--ok)" : "var(--text-secondary)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <Icon.Copy size={13} />
      </button>
      <span role="status" aria-live="polite" style={s.copyStatus}>
        {status === "copied" ? t("copied") : status === "failed" ? t("copyFailed") : ""}
      </span>
    </span>
  );
}
