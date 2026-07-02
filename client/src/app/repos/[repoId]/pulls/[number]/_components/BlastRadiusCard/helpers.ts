import type { BlastRadiusResult, BlastCallerRow } from "@devdigest/shared";

/** Collect all unique cron strings from factsByFile. */
export function buildCronSet(
  factsByFile: BlastRadiusResult["factsByFile"],
): Set<string> {
  const set = new Set<string>();
  if (!factsByFile) return set;
  for (const facts of Object.values(factsByFile)) {
    for (const cron of facts.crons) set.add(cron);
  }
  return set;
}

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  callers: BlastCallerRow[];
  endpoints: string[];
  crons: string[];
}

/** Group callers and endpoints under each changed symbol. */
export function buildSymbolRows(data: BlastRadiusResult): SymbolRow[] {
  return data.changedSymbols.map((sym) => {
    const callers = data.callers.filter((c) => c.viaSymbol === sym.name);
    const callerFiles = new Set(callers.map((c) => c.file));
    const endpoints: string[] = [];
    const crons: string[] = [];

    if (data.factsByFile) {
      for (const [file, facts] of Object.entries(data.factsByFile)) {
        if (callerFiles.has(file)) {
          endpoints.push(...facts.endpoints);
          crons.push(...facts.crons);
        }
      }
    } else {
      endpoints.push(...data.impactedEndpoints);
    }

    return {
      file: sym.file,
      name: sym.name,
      kind: sym.kind,
      callers,
      endpoints: [...new Set(endpoints)],
      crons: [...new Set(crons)],
    };
  });
}

/** Returns Tailwind className for an HTTP endpoint pill based on its method. */
export function endpointPillClass(endpoint: string): string {
  const method = endpoint.split(" ")[0]?.toUpperCase() ?? "";
  switch (method) {
    case "GET":
      return "bg-green-400/15 text-green-400";
    case "POST":
      return "bg-indigo-400/15 text-indigo-400";
    case "PUT":
      return "bg-amber-400/15 text-amber-400";
    case "PATCH":
      return "bg-purple-400/15 text-purple-400";
    case "DELETE":
      return "bg-red-400/15 text-red-400";
    default:
      return "bg-indigo-400/15 text-indigo-400";
  }
}
