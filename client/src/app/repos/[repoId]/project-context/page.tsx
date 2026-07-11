/* Route: /repos/:repoId/project-context — Server Component shell. Thin route
   entry — the interactive view, its drawer, styles, constants, helpers and
   i18n are colocated under _components/ProjectContextView. */
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  return <ProjectContextView />;
}
