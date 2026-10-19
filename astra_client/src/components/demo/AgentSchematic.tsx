// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// A live schematic of the agent being built: each component fills in as the draft changes.
// The diagram is presentation only; the draft itself comes from the builder service.

import type { CSSProperties } from "react";
import type { AgentConfig, BuilderCatalog } from "../../demo/agentConfig";

const HEIGHT = 70;

interface NodeSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  title: string;
  value: string;
  sub?: string;
  chips?: string[];
  accent: string;
  filled: boolean;
}

interface EdgeSpec { from: [number, number]; to: [number, number]; between: [string, string]; dashed?: boolean }

const EDGES: EdgeSpec[] = [
  { from: [14.5, 37], to: [18.5, 37], between: ["mic", "asr"] },
  { from: [35.5, 37], to: [42, 37], between: ["asr", "talker"] },
  { from: [62, 37], to: [68.5, 37], between: ["talker", "tts"] },
  { from: [85.5, 37], to: [87, 37], between: ["tts", "speaker"] },
  { from: [52, 44], to: [52, 56], between: ["talker", "backend"] },
  { from: [64, 62], to: [67, 62], between: ["backend", "tools"] },
  { from: [50, 15], to: [50, 30], between: ["persona", "talker"], dashed: true },
];

function nameOf(list: { id: string; name: string }[] | undefined, id: string): string {
  return list?.find((item) => item.id === id)?.name ?? (id ? id.split(":").pop() ?? id : "");
}

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function buildNodes(config: AgentConfig, catalog: BuilderCatalog | null): NodeSpec[] {
  const persona = config.persona;
  const voice = catalog?.voices.find((item) => item.id === config.speech.voice)?.name ?? "";
  return [
    {
      id: "persona", x: 50, y: 9, w: 62, title: "Persona & domain", accent: "#76b900", filled: Boolean(persona.role),
      value: persona.name || config.name || "Unnamed agent",
      sub: [persona.role ? clip(persona.role, 70) : "Describe what it should do", persona.tone].filter(Boolean).join(" · "),
    },
    { id: "mic", x: 8, y: 37, w: 13, title: "You", value: "Speak", accent: "#94a3b8", filled: true },
    {
      id: "asr", x: 27, y: 37, w: 17, title: "Hears", accent: "#f59e0b", filled: Boolean(config.speech.asr),
      value: nameOf(catalog?.asr, config.speech.asr), sub: config.language,
    },
    {
      id: "talker", x: 52, y: 37, w: 20, title: "Frontend · talks", accent: "#38bdf8", filled: Boolean(config.models.talker),
      value: nameOf(catalog?.talkers, config.models.talker), sub: "Fast spoken replies",
    },
    {
      id: "tts", x: 77, y: 37, w: 17, title: "Speaks", accent: "#ec4899", filled: Boolean(config.speech.tts),
      value: nameOf(catalog?.tts, config.speech.tts), sub: voice || "Default voice",
    },
    { id: "speaker", x: 93, y: 37, w: 11, title: "You", value: "Listen", accent: "#94a3b8", filled: true },
    {
      id: "backend", x: 52, y: 62, w: 24, title: "Backend · thinks", accent: "#8b5cf6", filled: Boolean(config.models.backend),
      value: nameOf(catalog?.backends, config.models.backend), sub: "Reasoning planner",
    },
    {
      id: "tools", x: 82, y: 62, w: 30, title: "Tools", accent: "#22d3ee", filled: true,
      value: config.tools.length ? `${config.tools.length} enabled` : "None",
      chips: config.tools.map((tool) => tool.replace(/^(get_|calculate_|generate_)/, "").replace(/_/g, " ")),
    },
  ];
}

export function AgentSchematic({ config, catalog, busy }: Readonly<{ config: AgentConfig; catalog: BuilderCatalog | null; busy: boolean }>) {
  const nodes = buildNodes(config, catalog);
  const filled = new Set(nodes.filter((node) => node.filled).map((node) => node.id));
  const summary = nodes.map((node) => `${node.title}: ${node.value}`).join(". ");

  return (
    <figure className={`schematic ${busy ? "is-busy" : ""}`} aria-label="Your agent, as built so far">
      <svg className="schematic__edges" viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {EDGES.map((edge) => (
          <line
            key={edge.between.join("-")}
            className={`schematic__edge ${edge.dashed ? "is-dashed" : ""} ${edge.between.every((id) => filled.has(id)) ? "is-live" : ""}`}
            x1={edge.from[0]} y1={edge.from[1]} x2={edge.to[0]} y2={edge.to[1]}
          />
        ))}
      </svg>
      {nodes.map((node) => (
        <div
          key={node.id}
          className={`schematic__node ${node.filled ? "is-filled" : ""}`}
          style={{ left: `${node.x}%`, top: `${(node.y / HEIGHT) * 100}%`, width: `${node.w}%`, ["--node-accent" as string]: node.accent } as CSSProperties}
          role="group"
          aria-label={`${node.title}: ${node.value || "not set"}`}
          title={`${node.title}: ${node.value}${node.sub ? ` (${node.sub})` : ""}`}
        >
          <span className="schematic__title">{node.title}</span>
          <strong className="schematic__value" key={node.value}>{node.value || "—"}</strong>
          {node.sub && <span className="schematic__sub">{node.sub}</span>}
          {node.chips && node.chips.length > 0 && (
            <span className="schematic__chips">
              {node.chips.slice(0, 7).map((chip) => <span key={chip} className="schematic__chip">{chip}</span>)}
            </span>
          )}
        </div>
      ))}
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
