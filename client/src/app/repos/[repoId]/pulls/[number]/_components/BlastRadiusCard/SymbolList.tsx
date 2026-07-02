"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SymbolRow } from "./helpers";
import { endpointPillClass } from "./helpers";

interface SymbolListProps {
  rows: SymbolRow[];
  repoId: string;
  prNumber: string;
}

export function SymbolList({ rows, repoId, prNumber }: SymbolListProps) {
  const t = useTranslations("prReview.blastRadius");
  const router = useRouter();
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col">
      {rows.map((sym) => {
        const isOpen = openSymbol === sym.name;
        return (
          <div
            key={sym.name}
            className="border-t border-[var(--border)] pt-2.5"
          >
            <button
              onClick={() => setOpenSymbol(isOpen ? null : sym.name)}
              className="bg-transparent border-none cursor-pointer p-0 w-full flex items-center justify-between mb-1.5"
            >
              <span className="font-mono text-[13px] text-[var(--text-primary)] font-semibold">
                ⟨⟩ {sym.name}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {t("callersCount", { count: sym.callers.length })}
              </span>
            </button>

            {isOpen && (
              <>
                {sym.callers.map((c) => (
                  <div
                    key={`${c.file}:${c.line}`}
                    onClick={() =>
                      router.push(
                        `/repos/${repoId}/pulls/${prNumber}?tab=diff&file=${encodeURIComponent(c.file)}&line=${c.line}`,
                      )
                    }
                    className="text-xs text-[var(--text-muted)] pl-3 leading-7 cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    ↳{" "}
                    <span className="font-mono">
                      {c.file}:{c.line}
                    </span>
                  </div>
                ))}

                {(sym.endpoints.length > 0 || sym.crons.length > 0) && (
                  <div className="flex gap-1.5 flex-wrap mt-1.5 pl-3">
                    {sym.endpoints.map((e) => (
                      <span
                        key={e}
                        className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${endpointPillClass(e)}`}
                      >
                        {e}
                      </span>
                    ))}
                    {sym.crons.map((c) => (
                      <span
                        key={c}
                        className="text-[11px] px-1.5 py-0.5 rounded font-mono bg-amber-500/15 text-amber-500"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
