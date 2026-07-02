import { describe, it, expect } from "vitest";
import type { BlastRadiusResult } from "@devdigest/shared";
import { buildCronSet, buildSymbolRows, endpointPillClass } from "./helpers";
import { buildGraphData } from "./BlastGraph";

const DATA: BlastRadiusResult = {
  changedSymbols: [
    { file: "src/middleware/ratelimit.ts", name: "rateLimit", kind: "function" },
  ],
  callers: [
    {
      file: "src/api/public/webhooks.ts",
      symbol: "handleWebhook",
      viaSymbol: "rateLimit",
      line: 42,
      rank: 3,
    },
  ],
  impactedEndpoints: ["POST /webhooks"],
  factsByFile: {
    "src/api/public/webhooks.ts": {
      endpoints: ["POST /webhooks"],
      crons: ["0 * * * *"],
    },
  },
};

describe("buildSymbolRows", () => {
  it("groups callers and attributes endpoints/crons via caller file", () => {
    const rows = buildSymbolRows(DATA);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.name).toBe("rateLimit");
    expect(row.callers).toHaveLength(1);
    expect(row.endpoints).toEqual(["POST /webhooks"]);
    expect(row.crons).toEqual(["0 * * * *"]);
  });

  it("falls back to flat impactedEndpoints when factsByFile is absent", () => {
    const row = buildSymbolRows({ ...DATA, factsByFile: undefined })[0]!;
    expect(row.endpoints).toEqual(["POST /webhooks"]);
    expect(row.crons).toEqual([]);
  });
});

describe("buildCronSet", () => {
  it("collects unique crons from factsByFile", () => {
    expect([...buildCronSet(DATA.factsByFile)]).toEqual(["0 * * * *"]);
    expect(buildCronSet(undefined).size).toBe(0);
  });
});

describe("buildGraphData", () => {
  it("builds symbol/caller/endpoint nodes and links", () => {
    const { nodes, links } = buildGraphData(DATA);
    const kinds = nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(["caller", "endpoint", "symbol"]);
    // symbol→caller and symbol→endpoint links.
    expect(links).toHaveLength(2);
  });
});

describe("endpointPillClass", () => {
  it("colors pills by HTTP method", () => {
    expect(endpointPillClass("GET /users")).toContain("green");
    expect(endpointPillClass("DELETE /x")).toContain("red");
    expect(endpointPillClass("weird")).toContain("indigo");
  });
});
