"use client";

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";
import type { BlastRadiusResult } from "@devdigest/shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: "symbol" | "caller" | "endpoint";
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  linkId: string;
}

// ── Build graph data ──────────────────────────────────────────────────────────

export function buildGraphData(data: BlastRadiusResult): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  const addNode = (id: string, label: string, kind: GraphNode["kind"]) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({ id, label, kind });
  };

  for (const sym of data.changedSymbols) {
    addNode(`sym:${sym.name}`, sym.name, "symbol");
  }

  for (const caller of data.callers) {
    const callerId = `caller:${caller.file}:${caller.line}`;
    const label = `${caller.file.split("/").pop() ?? caller.file}:${caller.line}`;
    addNode(callerId, label, "caller");
    const symId = `sym:${caller.viaSymbol}`;
    if (nodeIds.has(symId)) {
      links.push({
        linkId: `${symId}-${callerId}`,
        source: symId,
        target: callerId,
      });
    }
  }

  for (const ep of data.impactedEndpoints) {
    const epId = `ep:${ep}`;
    addNode(epId, ep, "endpoint");
    const firstSym = nodes.find((n) => n.kind === "symbol");
    if (firstSym) {
      links.push({
        linkId: `${firstSym.id}-${epId}`,
        source: firstSym.id,
        target: epId,
      });
    }
  }

  return { nodes, links };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COLOR: Record<GraphNode["kind"], string> = {
  symbol: "#818cf8",
  caller: "#94a3b8",
  endpoint: "#4ade80",
};

const NODE_RADIUS: Record<GraphNode["kind"], number> = {
  symbol: 14,
  caller: 8,
  endpoint: 10,
};

// ── Component ─────────────────────────────────────────────────────────────────

interface BlastGraphProps {
  data: BlastRadiusResult;
  width: number;
  height: number;
}

export function BlastGraph({ data, width, height }: BlastGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    svg.selectAll("*").remove();

    const { nodes, links } = buildGraphData(data);
    if (nodes.length === 0) return;

    const g = svg.append("g");

    // Defs: glow filter + arrow marker
    const defs = g.append("defs");

    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", 4)
      .attr("result", "blur");
    const merge = filter.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 20)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,0 L10,5 L0,10 Z")
      .attr("fill", "var(--border, #2d3149)");

    // Zoom
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 3])
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          g.attr("transform", event.transform.toString());
        }),
    );

    // Simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(90),
      )
      .force("charge", d3.forceManyBody<GraphNode>().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<GraphNode>().radius((d) => NODE_RADIUS[d.kind] + 10),
      );

    // Links
    const link = g
      .append("g")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--border, #2d3149)")
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.7)
      .attr("marker-end", "url(#arrow)");

    // Tooltip
    const tooltip = g
      .append("g")
      .attr("class", "tooltip")
      .style("display", "none");
    const tooltipRect = tooltip
      .append("rect")
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("fill", "rgba(0,0,0,0.8)")
      .attr("stroke", "var(--border, #2d3149)");
    const tooltipText = tooltip
      .append("text")
      .attr("fill", "#e2e8f0")
      .attr("font-size", 11)
      .attr("text-anchor", "middle");

    // Nodes
    const node = g
      .append("g")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => NODE_RADIUS[d.kind])
      .attr("fill", (d) => NODE_COLOR[d.kind])
      .attr("fill-opacity", 0.85)
      .attr("stroke", (d) => (d.kind === "endpoint" ? "#4ade80" : "none"))
      .attr("stroke-width", (d) => (d.kind === "endpoint" ? 2 : 0))
      .attr("stroke-opacity", 0.5)
      .attr("filter", (d) => (d.kind === "symbol" ? "url(#glow)" : null))
      .attr("cursor", "grab")
      .on("mouseover", (event, d) => {
        const label = `${d.label} (${d.kind})`;
        tooltipText.text(label);
        const textNode = tooltipText.node() as SVGTextElement;
        const bbox = textNode.getBBox();
        tooltipRect
          .attr("x", bbox.x - 6)
          .attr("y", bbox.y - 4)
          .attr("width", bbox.width + 12)
          .attr("height", bbox.height + 8);
        tooltip
          .attr(
            "transform",
            `translate(${d.x ?? 0},${(d.y ?? 0) - NODE_RADIUS[d.kind] - 16})`,
          )
          .style("display", null);
      })
      .on("mouseout", () => {
        tooltip.style("display", "none");
      })
      .call(
        d3
          .drag<SVGCircleElement, GraphNode>()
          .on(
            "start",
            (
              event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>,
              d,
            ) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
            },
          )
          .on(
            "drag",
            (
              event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>,
              d,
            ) => {
              d.fx = event.x;
              d.fy = event.y;
            },
          )
          .on(
            "end",
            (
              event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>,
              d,
            ) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
            },
          ),
      );

    // Labels
    const label = g
      .append("g")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes)
      .join("text")
      .attr("dy", (d) => NODE_RADIUS[d.kind] + 10)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("fill", "var(--text-muted, #6b7280)")
      .style("pointer-events", "none")
      .style("user-select", "none")
      .text((d) =>
        d.label.length > 18 ? d.label.slice(0, 16) + "…" : d.label,
      );

    // Tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);
      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [data, width, height]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="block rounded-md bg-[var(--bg-elevated,#1e2130)]"
    />
  );
}
