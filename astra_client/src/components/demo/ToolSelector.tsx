// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import type { Tool } from "../../api";

const TOOL_LABELS: Record<string, string> = {
  get_weather: "Weather",
  get_stock_price: "Stock price",
  web_search: "Web search",
  calculate_bmi: "BMI",
  generate_random_number: "Random number",
};

function labelFor(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ToolSelector({
  tools,
  selectedTools,
  loading,
  onToggle,
}: Readonly<{
  tools: Tool[];
  selectedTools: string[];
  loading: boolean;
  onToggle: (name: string) => void;
}>) {
  if (loading) return <p className="tool-selector__status">Loading available tools…</p>;
  if (tools.length === 0) return <p className="tool-selector__status">No selectable tools are registered for this example.</p>;

  return (
    <div className="ex-config__tools tool-selector" role="group" aria-label="Available agent tools">
      {tools.map((tool) => {
        const selected = selectedTools.includes(tool.name);
        return (
          <label key={tool.name} className={`ex-tool ${selected ? "on" : ""}`} title={tool.description}>
            <input type="checkbox" checked={selected} onChange={() => onToggle(tool.name)} />
            <span>{labelFor(tool.name)}</span>
          </label>
        );
      })}
    </div>
  );
}
