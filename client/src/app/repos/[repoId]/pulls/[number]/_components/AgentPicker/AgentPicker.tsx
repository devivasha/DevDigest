/* AgentPicker — replaces RunReviewDropdown. A trigger opens a "Pick agents to
   run" panel: multi-select checkboxes over the workspace's review agents, and,
   inside the panel, the primary "Run multi-agent review (N)" button plus a
   "Configure agents…" link (matching the product design). Launches one
   persisted multi-agent run for the selected set and navigates to its results.
   AC-1: renders in place of the single/all-agent dropdown.
   AC-2: the run button is disabled (not hidden) while N=0.
   AC-3: launching calls useLaunchMultiAgentRun then navigates to the run URL.
   AC-4: "Clear" deselects all; "Configure agents…" opens agent management.
   Agents are pre-selected on first load so the run button is immediately
   actionable when the panel opens. */
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useLaunchMultiAgentRun } from "@/lib/hooks/multiAgent";
import { s } from "./styles";

interface AgentPickerProps {
  prId: string;
  /** Fired the moment a launch is kicked off (before it settles). */
  onRunStart?: () => void;
  /** Fired once the multi-agent run has been created, just before navigating
     to its results page. */
  onRunsStarted?: () => void;
}

export function AgentPicker({ prId, onRunStart, onRunsStarted }: AgentPickerProps) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { data: agents } = useAgents();
  const launch = useLaunchMultiAgentRun();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const all = agents ?? [];

  // Pre-select every agent once, on first load, so the run button is
  // immediately actionable when the panel opens (matches the design's
  // pre-checked agents). The user can Clear or toggle from there.
  useEffect(() => {
    if (!initialized.current && all.length > 0) {
      setSelected(all.map((a) => a.id));
      initialized.current = true;
    }
  }, [all]);

  const count = selected.length;

  const toggleAgent = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handleClear = useCallback(() => setSelected([]), []);

  const handleConfigure = useCallback(() => {
    setOpen(false);
    router.push("/agents");
  }, [router]);

  const handleLaunch = useCallback(async () => {
    if (count === 0) return;
    onRunStart?.();
    const result = await launch.mutateAsync({ prId, agentIds: selected });
    onRunsStarted?.();
    setOpen(false);
    router.push(`/multi-agent/${result.id}`);
  }, [count, onRunStart, onRunsStarted, launch, prId, selected, router]);

  return (
    <div ref={rootRef} style={s.root}>
      <div style={s.selectWrap}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          style={s.trigger}
        >
          <Icon.Sparkles size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
          <span>{t("picker.trigger")}</span>
          <Icon.ChevronDown size={13} aria-hidden="true" />
        </button>

        {open && (
          <div role="group" aria-label={t("picker.title")} style={s.panel}>
            <div style={s.header}>
              <span style={s.headerTitle}>{t("picker.title")}</span>
              <button
                type="button"
                onClick={handleClear}
                aria-label={t("picker.clearAriaLabel")}
                style={s.headerClear}
              >
                {t("picker.clear")}
              </button>
            </div>

            {all.length === 0 ? (
              <div style={s.emptyState}>{t("picker.emptyState")}</div>
            ) : (
              all.map((agent) => {
                const checked = selected.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={t("picker.selectAgentAriaLabel", { name: agent.name })}
                    onClick={() => toggleAgent(agent.id)}
                    style={s.agentRow}
                  >
                    <span style={s.checkbox(checked)}>
                      {checked && <Icon.Check size={10} style={{ color: "#fff" }} aria-hidden="true" />}
                    </span>
                    <span>{agent.name}</span>
                  </button>
                );
              })
            )}

            <button
              type="button"
              disabled={count === 0 || launch.isPending}
              aria-label={t("picker.runReviewAriaLabel", { count })}
              onClick={handleLaunch}
              style={s.runBtn(count === 0 || launch.isPending)}
            >
              <Icon.Sparkles size={14} aria-hidden="true" />
              <span>{t("picker.runReview", { count })}</span>
            </button>

            <button
              type="button"
              onClick={handleConfigure}
              style={s.configureBtn}
            >
              <Icon.Settings size={13} aria-hidden="true" />
              <span>{t("picker.configureAgents")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentPicker;
