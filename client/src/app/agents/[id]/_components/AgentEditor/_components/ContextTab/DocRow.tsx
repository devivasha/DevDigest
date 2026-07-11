"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, IconBtn } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { BUCKET_COLOR } from "./constants";

/** Splits a repo-relative path into folder + filename for display. */
function splitPath(path: string) {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash < 0) return { folder: "", filename: path };
  return { folder: path.slice(0, lastSlash), filename: path.slice(lastSlash + 1) };
}

/** One discovered-document row: order handle (drag + keyboard), attach
    toggle, filename/folder, bucket badge, preview affordance. Presentational
    only — no internal hooks besides useTranslations, safe to render in a
    .map() from the parent. */
export function DocRow({
  doc,
  attached,
  canMoveUp,
  canMoveDown,
  dragOver,
  onToggle,
  onMoveUp,
  onMoveDown,
  onPreview,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  doc: DiscoveredDocument;
  attached: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragOver: boolean;
  onToggle: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPreview: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const t = useTranslations("agents");
  const { folder, filename } = splitPath(doc.path);

  const borderColor = dragOver ? "var(--accent)" : "var(--border)";
  const bgColor = dragOver ? "var(--accent-bg)" : "var(--bg-elevated)";

  return (
    <div
      draggable={attached}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (attached) {
          e.preventDefault();
          onDragOver(e);
        }
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background: bgColor,
        opacity: attached ? 1 : 0.72,
      }}
    >
      {/* Drag handle (mouse) */}
      <span
        style={{
          cursor: attached ? "grab" : "default",
          color: attached ? "var(--text-muted)" : "transparent",
          fontSize: 16,
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        ≡
      </span>

      {/* Keyboard reorder alternative (WCAG) — only meaningful/focusable once
          attached; a fixed-size placeholder keeps row alignment otherwise. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0, flexShrink: 0, width: 18 }}>
        {attached && canMoveUp ? (
          <IconBtn icon="ArrowUp" label={t("context.moveUp", { name: filename })} size={18} onClick={onMoveUp} />
        ) : (
          <span style={{ width: 18, height: 18 }} />
        )}
        {attached && canMoveDown ? (
          <IconBtn icon="ArrowDown" label={t("context.moveDown", { name: filename })} size={18} onClick={onMoveDown} />
        ) : (
          <span style={{ width: 18, height: 18 }} />
        )}
      </div>

      {/* Attach/detach toggle — icon button carries its own aria-label */}
      <IconBtn
        icon={attached ? "Check" : "Plus"}
        label={
          attached
            ? t("context.detach", { name: filename })
            : t("context.attach", { name: filename })
        }
        active={attached}
        onClick={() => onToggle(!attached)}
      />

      {/* Filename + folder path */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {filename}
        </div>
        {folder && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {folder}
          </div>
        )}
      </div>

      <Badge color={BUCKET_COLOR[doc.bucket]}>
        {t(`context.bucket.${doc.bucket}`)}
      </Badge>

      <IconBtn icon="Eye" label={t("context.preview", { name: filename })} onClick={onPreview} />
    </div>
  );
}
