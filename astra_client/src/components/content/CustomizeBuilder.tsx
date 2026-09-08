// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// "Customize Experience" — a flowchart pipeline builder (React Flow).
//
// The pipeline is a node graph on a canvas: Mic → ASR → LLM → TTS → Speaker,
// with Persona and Tools feeding the LLM. Drag components from the palette onto
// the canvas, wire them up like a flowchart, or pull them out. Connections are
// type-checked — you can't wire TTS→ASR, LLM→ASR, etc. The connected Mic→Speaker
// path is what launches, so the graph is authoritative.

import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useApp } from "../../context/useApp";
import { useVoiceSession } from "../../hooks/useVoiceSession";
import { isToolVisible } from "../../demo/presets";
import type { LLMService, SimpleService } from "../../api";

type Kind = "mic" | "asr" | "llm" | "tts" | "speaker" | "persona" | "tools";

interface NodeData extends Record<string, unknown> {
  kind: Kind;
  /** selected service id for asr/llm/tts nodes */
  serviceId?: string;
}

const KIND_META: Record<Kind, { icon: string; title: string; accent: string }> = {
  mic: { icon: "🎧", title: "You (Mic)", accent: "#6b7280" },
  asr: { icon: "🎙️", title: "Speech Recognition", accent: "#38bdf8" },
  llm: { icon: "🧠", title: "Language Model", accent: "#a3e635" },
  tts: { icon: "🔊", title: "Text-to-Speech", accent: "#22d3ee" },
  speaker: { icon: "🗣️", title: "Agent (Speaker)", accent: "#6b7280" },
  persona: { icon: "🎭", title: "Persona", accent: "#c084fc" },
  tools: { icon: "🛠️", title: "Tools", accent: "#f59e0b" },
};

// Allowed edges by source→target kind. Everything else is rejected.
const ALLOWED: Record<Kind, Kind[]> = {
  mic: ["asr"],
  asr: ["llm"],
  llm: ["tts"],
  tts: ["speaker"],
  persona: ["llm"],
  tools: ["llm"],
  speaker: [],
};

let idSeq = 100;
const nextId = () => `n${idSeq++}`;

/* ------------------------------------------------------------------ */
/*  Custom nodes                                                        */
/* ------------------------------------------------------------------ */

function IoNode({ data }: NodeProps<Node<NodeData>>) {
  const meta = KIND_META[data.kind];
  const isMic = data.kind === "mic";
  return (
    <div className="fx-node fx-node--io" style={{ ["--fx" as string]: meta.accent }}>
      <span className="fx-node__icon" aria-hidden>{meta.icon}</span>
      <span className="fx-node__title">{meta.title}</span>
      {isMic
        ? <Handle type="source" position={Position.Right} className="fx-handle" />
        : <Handle type="target" position={Position.Left} className="fx-handle" />}
    </div>
  );
}

function ComponentNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const meta = KIND_META[data.kind];
  const app = useApp();
  const { setNodes } = useReactFlow();

  const remove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((nds) => nds.filter((n) => n.id !== id));
  };

  // model nodes carry a service selection
  const catalog: (LLMService | SimpleService)[] =
    data.kind === "asr" ? app.asrServices : data.kind === "tts" ? app.ttsServices : data.kind === "llm" ? app.llms : [];
  const svc = catalog.find((s) => s.id === data.serviceId) ?? catalog[0];

  const setService = (serviceId: string) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, serviceId } } : n)));
    if (data.kind === "asr") app.selectASR(serviceId);
    else if (data.kind === "tts") app.selectTTS(serviceId);
    else if (data.kind === "llm") app.selectLLM(serviceId);
  };

  const isModel = data.kind === "asr" || data.kind === "llm" || data.kind === "tts";
  const hasInput = data.kind !== "persona" && data.kind !== "tools";

  return (
    <div className={`fx-node ${selected ? "fx-node--selected" : ""}`} style={{ ["--fx" as string]: meta.accent }}>
      {hasInput && <Handle type="target" position={Position.Left} className="fx-handle" />}
      <button className="fx-node__x" onClick={remove} title="Remove" aria-label="Remove node">×</button>
      <div className="fx-node__head">
        <span className="fx-node__icon" aria-hidden>{meta.icon}</span>
        <span className="fx-node__kind">{meta.title}</span>
      </div>
      {isModel ? (
        <select
          className="fx-node__select nodrag"
          value={svc?.id ?? ""}
          onChange={(e) => setService(e.target.value)}
        >
          {catalog.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      ) : (
        <div className="fx-node__value">
          {data.kind === "persona" ? (app.activePrompt?.title ?? "Default") : `${app.selectedTools.length} selected`}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="fx-handle" />
    </div>
  );
}

const nodeTypes = { io: IoNode, component: ComponentNode };

/* ------------------------------------------------------------------ */
/*  Builder                                                            */
/* ------------------------------------------------------------------ */

function BuilderInner({ onLaunched }: { onLaunched?: () => void }) {
  const app = useApp();
  const { connect, isConnecting } = useVoiceSession();
  const { screenToFlowPosition } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inspect, setInspect] = useState<Kind | null>(null);

  const selectedIds = {
    asr: app.selectedASR?.id,
    llm: app.selectedLLM?.id,
    tts: app.selectedTTS?.id,
  };

  const initialNodes: Node<NodeData>[] = useMemo(() => ([
    { id: "mic", type: "io", position: { x: 0, y: 120 }, data: { kind: "mic" }, deletable: false, draggable: true },
    { id: "asr", type: "component", position: { x: 180, y: 110 }, data: { kind: "asr", serviceId: selectedIds.asr } },
    { id: "llm", type: "component", position: { x: 420, y: 110 }, data: { kind: "llm", serviceId: selectedIds.llm } },
    { id: "tts", type: "component", position: { x: 660, y: 110 }, data: { kind: "tts", serviceId: selectedIds.tts } },
    { id: "speaker", type: "io", position: { x: 900, y: 120 }, data: { kind: "speaker" }, deletable: false },
    { id: "persona", type: "component", position: { x: 380, y: 300 }, data: { kind: "persona" } },
    { id: "tools", type: "component", position: { x: 560, y: 300 }, data: { kind: "tools" } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);

  const initialEdges: Edge[] = useMemo(() => ([
    { id: "e-mic-asr", source: "mic", target: "asr", animated: true },
    { id: "e-asr-llm", source: "asr", target: "llm", animated: true },
    { id: "e-llm-tts", source: "llm", target: "tts", animated: true },
    { id: "e-tts-speaker", source: "tts", target: "speaker", animated: true },
    { id: "e-persona-llm", source: "persona", target: "llm", animated: true },
    { id: "e-tools-llm", source: "tools", target: "llm", animated: true },
  ]), []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const kindOf = useCallback((nodeId: string): Kind | undefined =>
    nodes.find((n) => n.id === nodeId)?.data.kind, [nodes]);

  const isValidConnection = useCallback((c: Connection | Edge): boolean => {
    const s = kindOf(c.source!);
    const t = kindOf(c.target!);
    if (!s || !t) return false;
    return ALLOWED[s]?.includes(t) ?? false;
  }, [kindOf]);

  const onConnect = useCallback((c: Connection) => {
    if (!isValidConnection(c)) return;
    setEdges((eds) => addEdge({ ...c, animated: true }, eds));
  }, [isValidConnection, setEdges]);

  const onDragOver = useCallback((e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/reactflow");
    if (!raw) return;
    const { kind, serviceId } = JSON.parse(raw) as { kind: Kind; serviceId?: string };
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes((nds) => nds.concat({
      id: nextId(), type: "component", position,
      data: { kind, serviceId },
    }));
  }, [screenToFlowPosition, setNodes]);

  // Derive the launch config from the connected Mic→…→Speaker path.
  const chain = useMemo(() => {
    const adj = new Map<string, string[]>();
    edges.forEach((e) => { adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]); });
    const found: Partial<Record<Kind, string>> = {};
    const seen = new Set<string>();
    const walk = (nid: string) => {
      if (seen.has(nid)) return; seen.add(nid);
      const k = kindOf(nid);
      const node = nodes.find((n) => n.id === nid);
      if (k && ["asr", "llm", "tts"].includes(k) && node?.data.serviceId) found[k] = node.data.serviceId;
      (adj.get(nid) ?? []).forEach(walk);
    };
    walk("mic");
    // persona/tools attached to the llm node (regardless of path direction)
    const llmNode = nodes.find((n) => n.data.kind === "llm");
    const personaLinked = edges.some((e) => e.target === llmNode?.id && kindOf(e.source) === "persona");
    const toolsLinked = edges.some((e) => e.target === llmNode?.id && kindOf(e.source) === "tools");
    return { found, personaLinked, toolsLinked };
  }, [edges, nodes, kindOf]);

  const ready = Boolean(chain.found.asr && chain.found.llm && chain.found.tts);

  const launch = () => {
    if (!ready || isConnecting) return;
    // Sync context selections to the graph, then connect (uses context).
    if (chain.found.asr) app.selectASR(chain.found.asr);
    if (chain.found.llm) app.selectLLM(chain.found.llm);
    if (chain.found.tts) app.selectTTS(chain.found.tts);
    void connect();
    onLaunched?.();
  };

  return (
    <div className="fx-builder">
      <div className="fx-builder__head">
        <h2>Build your pipeline</h2>
        <p>Wire components into a flow — drag from the palette, pull nodes out, reconnect. Only valid links stick
          (you can't feed TTS into ASR). The connected <strong>Mic → Speaker</strong> path is what launches.</p>
      </div>

      <div className="fx-stage">
        <div className="fx-canvas" ref={wrapRef} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => {
              const k = (n.data as NodeData).kind;
              setInspect(k === "persona" || k === "tools" ? k : null);
            }}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true }}
          >
            <Background gap={18} color="rgba(255,255,255,0.06)" />
            <MiniMap pannable zoomable className="fx-minimap" nodeColor={(n) => KIND_META[(n.data as NodeData).kind]?.accent ?? "#666"} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <Palette />
      </div>

      {inspect === "persona" && <PersonaInspector onClose={() => setInspect(null)} />}
      {inspect === "tools" && <ToolsInspector onClose={() => setInspect(null)} />}

      <div className="fx-launch">
        <div className="fx-launch__summary">
          <span className={`cfg-chip ${chain.found.asr ? "" : "cfg-chip--missing"}`}>ASR {chain.found.asr ? "✓" : "—"}</span>
          <span className={`cfg-chip ${chain.found.llm ? "" : "cfg-chip--missing"}`}>LLM {chain.found.llm ? "✓" : "—"}</span>
          <span className={`cfg-chip ${chain.found.tts ? "" : "cfg-chip--missing"}`}>TTS {chain.found.tts ? "✓" : "—"}</span>
          <span className="cfg-chip">{app.activePrompt?.title ?? "Persona"}</span>
          <span className="cfg-chip">{app.selectedTools.length} tools</span>
        </div>
        <button type="button" className="btn-primary btn-bubbly" onClick={launch} disabled={!ready || isConnecting}>
          {isConnecting ? "Launching…" : ready ? "Launch this pipeline" : "Connect Mic → Speaker"}
        </button>
      </div>
    </div>
  );
}

function Palette() {
  const app = useApp();
  const onDragStart = (e: DragEvent, kind: Kind, serviceId?: string) => {
    e.dataTransfer.setData("application/reactflow", JSON.stringify({ kind, serviceId }));
    e.dataTransfer.effectAllowed = "move";
  };
  const groups: { kind: Kind; items: { id?: string; name: string }[] }[] = [
    { kind: "asr", items: app.asrServices.map((s) => ({ id: s.id, name: s.name })) },
    { kind: "llm", items: app.llms.map((s) => ({ id: s.id, name: s.name })) },
    { kind: "tts", items: app.ttsServices.map((s) => ({ id: s.id, name: s.name })) },
    { kind: "persona", items: [{ name: "Persona / prompt" }] },
    { kind: "tools", items: [{ name: "Tools" }] },
  ];
  return (
    <aside className="fx-palette">
      <p className="fx-palette__title">Components</p>
      <p className="fx-palette__hint">Drag onto the canvas.</p>
      {groups.map((g) => (
        <div key={g.kind} className="fx-palette__group" style={{ ["--fx" as string]: KIND_META[g.kind].accent }}>
          <p className="fx-palette__label">{KIND_META[g.kind].icon} {KIND_META[g.kind].title}</p>
          {g.items.map((it) => (
            <div
              key={it.id ?? it.name}
              className="fx-chip"
              draggable
              onDragStart={(e) => onDragStart(e, g.kind, it.id)}
              title="Drag onto the canvas"
            >
              <span className="fx-chip__grip" aria-hidden>⠿</span>
              {it.name}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

function PersonaInspector({ onClose }: { onClose: () => void }) {
  const { demoPrompts, activePromptId, selectDemoPrompt, updateDemoPrompt, addDemoPrompt, removeDemoPrompt } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const active = demoPrompts.find((p) => p.id === activePromptId);
  return (
    <div className="fx-inspector">
      <div className="fx-inspector__head">
        <h3>🎭 Persona &amp; prompt</h3>
        <button className="fx-inspector__x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="prompt-tabs">
        {demoPrompts.map((p) => (
          <button key={p.id} className={`prompt-tab ${activePromptId === p.id ? "active" : ""}`} onClick={() => selectDemoPrompt(p.id)}>
            {p.title}
            {!p.builtIn && <span className="prompt-tab__x" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); removeDemoPrompt(p.id); }} onKeyDown={() => {}}>×</span>}
          </button>
        ))}
        <button className="prompt-tab prompt-tab--add" onClick={() => setAdding((v) => !v)}>+ New</button>
      </div>
      {adding && (
        <div className="prompt-add">
          <input placeholder="New prompt name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn-primary" onClick={() => { addDemoPrompt(title || "My prompt", active?.content ?? ""); setTitle(""); setAdding(false); }}>Create</button>
        </div>
      )}
      {active && (
        <>
          <input className="prompt-title-input" value={active.title} disabled={active.builtIn} onChange={(e) => updateDemoPrompt(active.id, { title: e.target.value })} />
          <textarea className="prompt-editor" value={active.content} rows={8} onChange={(e) => updateDemoPrompt(active.id, { content: e.target.value })} />
        </>
      )}
    </div>
  );
}

function ToolsInspector({ onClose }: { onClose: () => void }) {
  const { tools, selectedTools, toggleTool } = useApp();
  const visible = tools.filter((t) => isToolVisible(t.name));
  return (
    <div className="fx-inspector">
      <div className="fx-inspector__head">
        <h3>🛠️ Tools <span className="widget-count">{selectedTools.length} on</span></h3>
        <button className="fx-inspector__x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="tool-grid">
        {visible.map((t) => {
          const on = selectedTools.includes(t.name);
          return (
            <button key={t.name} className={`tool-widget ${on ? "on" : ""}`} onClick={() => toggleTool(t.name)} aria-pressed={on}>
              <span className="tool-widget__check" aria-hidden>{on ? "✓" : "+"}</span>
              <span className="tool-widget__body">
                <code className="tool-widget__name">{t.name}</code>
                <span className="tool-widget__desc">{t.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CustomizeBuilder({ onLaunched }: Readonly<{ onLaunched?: () => void }>) {
  return (
    <ReactFlowProvider>
      <BuilderInner onLaunched={onLaunched} />
    </ReactFlowProvider>
  );
}
