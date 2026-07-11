/* /repos/:repoId/onboarding — per-repo Onboarding Tour. Distinct from the
   first-run wizard at /onboarding (AC-18). Facts are collected server-side
   at zero LLM cost; the narrative sections arrive already generated (or as
   a deterministic skeleton when degraded) — this view only renders the
   persisted OnboardingTour payload and offers Regenerate + Share. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useOnboardingTour, useRegenerateTour } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/contexts/repoContext";
import { ApiError } from "@/lib/api";
import { SCROLL_BOTTOM_THRESHOLD_PX, SECTION_IDS, SKELETON_SECTION_COUNT } from "./constants";
import { s } from "./styles";
import { OnThisPageNav } from "./_components/OnThisPageNav";
import { TourHeader } from "./_components/TourHeader";
import { DegradedBanner } from "./_components/DegradedBanner";
import { StaleHint } from "./_components/StaleHint";
import { ArchitectureSection } from "./_components/ArchitectureSection";
import { CriticalPathsSection } from "./_components/CriticalPathsSection";
import { HowToRunSection } from "./_components/HowToRunSection";
import { ReadingPathSection } from "./_components/ReadingPathSection";
import { FirstTasksSection } from "./_components/FirstTasksSection";

/** Nearest scrollable ancestor of `el` (the element that actually scrolls the
 *  tour), falling back to the window when the page scrolls at the document
 *  level. Container-agnostic so it works whether AppShell scrolls the window
 *  or an inner overflow container. */
function getScrollParent(el: HTMLElement | null): HTMLElement | Window {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

/** True only when `scroller` is actually scrollable AND scrolled to its very
 *  bottom. Guards the not-scrollable case so a short (non-scrolling) page never
 *  reports "at bottom". */
function isAtBottom(scroller: HTMLElement | Window): boolean {
  const el =
    scroller instanceof Window
      ? document.scrollingElement ?? document.documentElement
      : scroller;
  if (el.scrollHeight <= el.clientHeight + SCROLL_BOTTOM_THRESHOLD_PX) return false;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX;
}

/** Tracks which section is nearest the top of the viewport, for the "ON THIS
 *  PAGE" nav's active-item highlight. IntersectionObserver is an external
 *  browser API — a legitimate useEffect synchronization, not derived state. */
function useActiveSectionId(ready: boolean): string | null {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!ready) return;
    const elements = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el != null,
    );
    if (elements.length === 0) return;

    const lastId = elements[elements.length - 1]!.id;
    const scroller = getScrollParent(elements[0]!);

    // The last section (often the shortest — First tasks) can never reach the
    // top active-band once the page is scrolled to the bottom, so it would
    // never highlight. Pin it explicitly whenever we're at the bottom;
    // otherwise pick the topmost intersecting section.
    const recompute = (entries: IntersectionObserverEntry[]) => {
      if (isAtBottom(scroller)) {
        setActiveId(lastId);
        return;
      }
      const visible = entries.filter((e) => e.isIntersecting);
      if (visible.length > 0) {
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveId(top.target.id);
      }
    };

    const observer = new IntersectionObserver(recompute, { rootMargin: "-10% 0px -70% 0px" });
    elements.forEach((el) => observer.observe(el));

    // The observer stops firing once you settle at the bottom, so re-check the
    // bottom case on scroll too (covers clicking the last nav item, which jumps
    // to a section that can't scroll to the top).
    const onScroll = () => {
      if (isAtBottom(scroller)) setActiveId(lastId);
    };
    const scrollTarget: Window | HTMLElement = scroller;
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });

    setActiveId((prev) => prev ?? elements[0]!.id);
    return () => {
      observer.disconnect();
      scrollTarget.removeEventListener("scroll", onScroll);
    };
  }, [ready]);

  return activeId;
}

export function OnboardingTourView() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: tour, isLoading, isError, error, refetch } = useOnboardingTour(repoId);
  const regenerate = useRegenerateTour(repoId);
  const activeId = useActiveSectionId(!isLoading && !isError && !!tour);

  const repoFullName = activeRepo?.full_name;
  const defaultBranch = activeRepo?.default_branch;
  const breadcrumbRepoName = tour?.repoName ?? activeRepo?.full_name ?? repoId;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: breadcrumbRepoName, mono: true }, { label: t("breadcrumb") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: breadcrumbRepoName, mono: true }, { label: t("breadcrumb") }]}>
      {isLoading ? (
        <div style={{ padding: "24px 32px" }}>
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_SECTION_COUNT }).map((_, i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
        </div>
      ) : isError ? (
        <div style={{ padding: "24px 32px" }}>
          <ErrorState
            title={t("loadError.title")}
            body={error instanceof ApiError ? error.message : t("unknownError")}
            onRetry={() => refetch()}
          />
        </div>
      ) : !tour ? null : (
        <div style={s.layout}>
          <OnThisPageNav activeId={activeId} />
          <main style={s.main}>
            <TourHeader
              repoId={repoId}
              repoName={tour.repoName}
              indexFileCount={tour.indexFileCount}
              lastRefreshedAt={tour.lastRefreshedAt}
              regenerating={regenerate.isPending}
              onRegenerate={() => regenerate.mutate()}
            />

            {tour.degraded && <DegradedBanner reason={tour.degradedReason} />}
            {tour.stale && <StaleHint />}

            <ArchitectureSection
              architecture={tour.sections.architecture}
              repoFullName={repoFullName}
              defaultBranch={defaultBranch}
            />
            <CriticalPathsSection
              criticalPaths={tour.sections.criticalPaths}
              repoFullName={repoFullName}
              defaultBranch={defaultBranch}
            />
            <HowToRunSection howToRun={tour.sections.howToRun} />
            <ReadingPathSection
              readingPath={tour.sections.readingPath}
              repoFullName={repoFullName}
              defaultBranch={defaultBranch}
            />
            <FirstTasksSection firstTasks={tour.sections.firstTasks} />
          </main>
        </div>
      )}
    </AppShell>
  );
}
