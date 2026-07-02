"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import type { PriorPr } from "@devdigest/shared";

interface PriorPrsAccordionProps {
  priorPrs: PriorPr[];
}

export function PriorPrsAccordion({ priorPrs }: PriorPrsAccordionProps) {
  const t = useTranslations("prReview.blastRadius");
  const [open, setOpen] = useState(false);

  if (priorPrs.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-transparent border-none cursor-pointer p-0 w-full flex items-center justify-between text-xs text-[var(--text-muted)]"
      >
        <span>⏱ {t("priorPrs")}</span>
        <span className="font-semibold">
          {priorPrs.length} {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-1 mt-1.5 pl-1">
          {priorPrs.map((pr) => (
            <div
              key={pr.id}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
            >
              <span className="text-[var(--text-muted)] shrink-0">
                #{pr.number}
              </span>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {pr.title}
              </span>
              {pr.openedAt && (
                <span className="text-[var(--text-muted)] shrink-0 text-[11px]">
                  {relativeDate(pr.openedAt)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
