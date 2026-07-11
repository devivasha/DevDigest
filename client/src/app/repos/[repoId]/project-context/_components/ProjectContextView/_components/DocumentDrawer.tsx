"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Tabs, Markdown, Button, Skeleton, Icon } from "@devdigest/ui";
import { useDocument, useSaveDocument } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { splitPath } from "../helpers";
import { s } from "../styles";
import type { DrawerTab } from "../constants";

/**
 * Preview/Edit drawer for one discovered document. Preview renders the raw
 * markdown through the shared `Markdown` primitive (AC-31); Edit shows a
 * keyboard-operable `<textarea>` with the raw source plus a resync-clobber
 * warning, since `git reset --hard` during repo resync would discard any
 * uncommitted edit (AC-34). No cheap "is this file git-tracked" signal exists
 * server-side today, so — per the plan — the warning is shown for every
 * discovered doc rather than guessing at tracked status.
 *
 * Mounted with `key={path}` by the parent so switching documents remounts
 * this component and resets all local state (edit buffer + mutation status)
 * for free, instead of syncing it by hand with effects.
 */
export function DocumentDrawer({
  repoId,
  path,
  initialTab,
  onClose,
}: {
  repoId: string;
  path: string;
  initialTab: DrawerTab;
  onClose: () => void;
}) {
  const t = useTranslations("projectContext");
  const [tab, setTab] = React.useState<DrawerTab>(initialTab);
  const { data, isLoading, isError, error: docError } = useDocument(repoId, path);
  const saveDocument = useSaveDocument(repoId);
  const [editText, setEditText] = React.useState("");

  // Sync the local edit buffer from the fetched file. This is a real
  // external-system sync (the file's current text), not derived state — once
  // loaded, the buffer becomes user-owned and diverges from `data.text`.
  React.useEffect(() => {
    if (data) setEditText(data.text);
  }, [data]);

  const { folder, filename } = splitPath(path);

  return (
    <Drawer
      width={780}
      title={filename}
      subtitle={folder}
      onClose={onClose}
      footer={
        tab === "edit" ? (
          <div style={s.drawerFooter}>
            <Button
              kind="primary"
              onClick={() => saveDocument.mutate({ path, text: editText })}
              loading={saveDocument.isPending}
              disabled={isLoading || isError}
            >
              {t("drawer.save")}
            </Button>
            <div role="status" aria-live="polite" style={s.saveStatus}>
              {saveDocument.isSuccess && t("drawer.saveSuccess")}
              {saveDocument.isError &&
                (saveDocument.error instanceof ApiError ? saveDocument.error.message : t("drawer.saveError"))}
            </div>
          </div>
        ) : undefined
      }
    >
      <Tabs
        tabs={[
          { key: "preview", label: t("drawer.previewTab") },
          { key: "edit", label: t("drawer.editTab") },
        ]}
        value={tab}
        onChange={(k) => setTab(k as DrawerTab)}
        pad="0 0 14px"
      />
      <div style={s.drawerBody}>
        {isLoading ? (
          <Skeleton height={240} />
        ) : isError ? (
          <div role="alert">{docError instanceof ApiError ? docError.message : t("drawer.loadError")}</div>
        ) : tab === "preview" ? (
          <Markdown>{data?.text}</Markdown>
        ) : (
          <>
            <div style={s.resyncWarning}>
              <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t("drawer.resyncWarning")}</span>
            </div>
            <textarea
              aria-label={t("drawer.editLabel", { filename })}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={20}
              className="mono"
              style={s.textarea}
            />
          </>
        )}
      </div>
    </Drawer>
  );
}
