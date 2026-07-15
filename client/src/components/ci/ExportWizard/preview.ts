/* preview.ts — non-serializing helpers for the Export Wizard.
   The Preview step's file bundle now comes from the REAL server-generated
   bundle (`usePreviewCi`, `POST /agents/:id/ci/preview`) — see `PreviewStep.tsx`
   and `client/src/lib/hooks/ci.ts`. This module used to hand-roll a client-side
   YAML approximation of the manifest/workflow for preview purposes; that
   serializer diverged from the server's real encoding (e.g. multi-line system
   prompts: the server folds to a YAML block scalar, this stub emitted an
   escaped single-line string), which broke byte-for-byte parity (AC-7). It has
   been removed. `slugify` is kept as a pure, non-serializing helper — it is
   only used client-side to name the downloaded zip file
   (`InstallStep.tsx`/`ExportWizard.tsx`), not to build any previewed content. */

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "") // strip combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}
