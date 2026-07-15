"use client";

/* InstallationsList — CI tab installations table (AC-18). One row per
   `ci_installations` entry: repo + status (derived latest-run status,
   neutral placeholder when null — no runs yet) + workflow version (the
   agent's `version` snapshotted at export time, D5). Each row calls
   `useTranslations` directly (it's already a `'use client'` leaf) rather
   than receiving `t`/`tCi` as props. */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiInstallation } from "@/vendor/shared/contracts/eval-ci";
import { ciStatusMeta } from "./statusMeta";
import { s } from "./styles";

function formatInstalledAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function InstallationRow({ installation }: { installation: CiInstallation }) {
  const t = useTranslations("agents");
  const tCi = useTranslations("ci");
  const meta = ciStatusMeta(installation.status, tCi);
  return (
    <tr>
      <td style={{ ...s.td, fontWeight: 600 }}>{installation.repo}</td>
      <td style={s.td}>
        <Badge icon={meta.icon} color={meta.color} bg={meta.bg}>
          {meta.label}
        </Badge>
      </td>
      <td className="tnum" style={s.td}>
        {installation.version != null ? `v${installation.version}` : t("ciTab.installations.noVersion")}
      </td>
      <td style={s.td}>{formatInstalledAt(installation.installed_at)}</td>
    </tr>
  );
}

export function InstallationsList({ installations }: { installations: CiInstallation[] }) {
  const t = useTranslations("agents");
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{t("ciTab.installations.repo")}</th>
            <th style={s.th}>{t("ciTab.installations.status")}</th>
            <th style={s.th}>{t("ciTab.installations.version")}</th>
            <th style={s.th}>{t("ciTab.installations.installed")}</th>
          </tr>
        </thead>
        <tbody>
          {installations.map((installation) => (
            <InstallationRow key={installation.id} installation={installation} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
