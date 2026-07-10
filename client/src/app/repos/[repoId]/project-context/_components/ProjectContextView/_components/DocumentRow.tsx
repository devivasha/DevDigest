import { IconBtn } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { useTranslations } from "next-intl";
import { splitPath } from "../helpers";
import { s } from "../styles";
import { BucketBadge } from "./BucketBadge";

/** One discovery-list row: filename, folder path, bucket badge, Preview affordance. */
export function DocumentRow({
  doc,
  onPreview,
}: {
  doc: DiscoveredDocument;
  onPreview: (path: string) => void;
}) {
  const t = useTranslations("projectContext");
  const { folder, filename } = splitPath(doc.path);
  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <div style={s.filename}>{filename}</div>
        {folder && <div style={s.folder}>{folder}</div>}
      </div>
      <BucketBadge bucket={doc.bucket} />
      <IconBtn icon="Eye" label={t("list.previewLabel", { filename })} onClick={() => onPreview(doc.path)} />
    </div>
  );
}
