import { Badge } from "@devdigest/ui";
import type { DocumentBucket } from "@devdigest/shared";
import { useTranslations } from "next-intl";
import { BUCKET_COLOR } from "../constants";

/** Bucket badge — colour dot + translated text label (WCAG: never colour alone). */
export function BucketBadge({ bucket }: { bucket: DocumentBucket }) {
  const t = useTranslations("projectContext");
  const c = BUCKET_COLOR[bucket];
  return (
    <Badge dot color={c.color} bg={c.bg}>
      {t(`list.bucket.${bucket}`)}
    </Badge>
  );
}
