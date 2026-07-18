"use client";

import {
  Activity,
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  Eye,
  GitBranch,
  Grid2X2,
  History,
  LayoutDashboard,
  Maximize2,
  Network,
  PanelLeftClose,
  Play,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TimerReset,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ADAPTED_POSTERIORS,
  DEMO_QUERY,
  INITIAL_DAG,
  INITIAL_POSTERIORS,
  LEARNING_CURVE,
  PANELS,
  RECENT_INCIDENTS,
  ROOT_CAUSE,
} from "@/lib/telemetry/mock-data";
import type {
  DagNode,
  InvestigationEvent,
  PanelData,
  Posterior,
  RewardEvent,
  RootCause,
} from "@/lib/types";
import {
  AreaChart,
  Heatmap,
  LearningChart,
  PosteriorBars,
  TraceWaterfall,
} from "@/components/visualizations";

type View = "canvas" | "dag" | "learning";

const suggestions = [
  "Why did checkout latency spike after Tuesday's deploy?",
  "Show me where the 5xx burst started",
  "Find the slowest trace in the last hour",
];

function EyeMark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "eye-mark small" : "eye-mark"} aria-hidden="true">
      <span>
        <i />
      </span>
    </span>
  );
}

function updateNode(list: DagNode[], incoming: DagNode) {
  const index = list.findIndex((node) => node.id === incoming.id);
  if (index === -1) return [...list, incoming];
  return list.map((node, nodeIndex) =>
    nodeIndex === index ? { ...node, ...incoming } : node,
  );
}

function PanelVisual({ panel }: { panel: PanelData }) {
  if (panel.kind === "timeline" && panel.series) {
    return (
      <div className="panel-visual timeline-visual">
        <div className="chart-legend">
          <span>
            <i className="legend-orange" /> p99
          </span>
          <span>
            <i className="legend-cyan" /> baseline
          </span>
          <b>deploy 14:02</b>
        </div>
        <AreaChart data={panel.series} compact />
      </div>
    );
  }

  if (panel.kind === "heatmap" && panel.heatmap) {
    return (
      <div className="panel-visual">
        <Heatmap cells={panel.heatmap} />
      </div>
    );
  }

  if (panel.kind === "trace" && panel.spans) {
    return (
      <div className="panel-visual">
        <TraceWaterfall spans={panel.spans} />
      </div>
    );
  }

  if (panel.kind === "deploy") {
    return (
      <div className="panel-visual deploy-diff">
        <div className="diff-line muted">
          <span>DB_POOL_MIN</span>
          <b>8</b>
        </div>
        <div className="diff-line remove">
          <span>− DB_POOL_MAX</span>
          <b>40</b>
        </div>
        <div className="diff-line add">
          <span>+ DB_POOL_MAX</span>
          <b>12</b>
        </div>
        <div className="deploy-marker">
          <GitBranch size={14} />
          <span>rollout completed</span>
          <b>14:02:11</b>
        </div>
      </div>
    );
  }

  if (panel.kind === "cardinality" && panel.series) {
    return (
      <div className="panel-visual cardinality-visual">
        <AreaChart data={panel.series} compact />
        <span className="clear-stamp">
          <ShieldCheck size={15} /> no anomaly
        </span>
      </div>
    );
  }

  return <div className="panel-visual empty-visual">Probe complete</div>;
}

function InvestigationPanel({
  panel,
  selected,
  onSelect,
  onExpand,
}: {
  panel: PanelData;
  selected: boolean;
  onSelect: (panel: PanelData) => void;
  onExpand: (panel: PanelData) => void;
}) {
  return (
    <article
      className={`investigation-panel accent-${panel.accent} ${selected ? "selected" : ""}`}
      onClick={() => onSelect(panel)}
    >
      <header>
        <div>
          <span className="panel-eyebrow">
            <i /> {panel.eyebrow}
          </span>
          <h3>{panel.title}</h3>
        </div>
        <button
          className="icon-button"
          aria-label={`Expand ${panel.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onExpand(panel);
          }}
        >
          <Maximize2 size={15} />
        </button>
      </header>
      <PanelVisual panel={panel} />
      <div className="panel-finding">
        <Sparkles size={14} />
        <span>{panel.finding}</span>
      </div>
      <footer>
        <div className="panel-stats">
          {panel.stats?.map((stat) => (
            <span key={stat.label}>
              <small>{stat.label}</small>
              <b className={stat.tone}>{stat.value}</b>
            </span>
          ))}
        </div>
        <span className="confidence">{panel.confidence}% confidence</span>
      </footer>
    </article>
  );
}

function RootCauseCard({
  rootCause,
  confirmed,
  onConfirm,
}: {
  rootCause: RootCause;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  return (
    <section className={`root-cause ${confirmed ? "confirmed" : ""}`}>
      <div className="root-pulse">
        <span>
          <CircleDot size={18} />
        </span>
      </div>
      <div className="root-copy">
        <div className="root-kicker">
          <span>LIKELY ROOT CAUSE</span>
          <b>{rootCause.confidence}% confidence</b>
        </div>
        <h2>
          {rootCause.title} <span>in {rootCause.service}</span>
        </h2>
        <p>{rootCause.detail}</p>
        <div className="root-evidence">
          <span>
            <TerminalSquare size={13} /> trace {rootCause.traceId}
          </span>
          <span>
            <TimerReset size={13} /> since {rootCause.since}
          </span>
        </div>
      </div>
      <button className="confirm-button" onClick={onConfirm} disabled={confirmed}>
        {confirmed ? <Check size={16} /> : <ShieldCheck size={16} />}
        {confirmed ? "Root cause confirmed" : "Confirm root cause"}
      </button>
    </section>
  );
}

function DagRail({
  nodes,
  posteriors,
  active,
}: {
  nodes: DagNode[];
  posteriors: Posterior[];
  active: boolean;
}) {
  return (
    <aside className="thinking-rail">
      <div className="rail-header">
        <div>
          <span className={`live-dot ${active ? "active" : ""}`} />
          <h2>Watch it think</h2>
        </div>
        <span className="durable-pill">
          <Zap size={11} /> durable run
        </span>
      </div>
      <div className="dag-list">
        {nodes.map((node, index) => (
          <div className={`dag-item ${node.status}`} key={node.id}>
            {index < nodes.length - 1 && <span className="dag-line" />}
            <span className="dag-icon">
              {node.status === "complete" || node.status === "adapted" ? (
                <Check size={12} />
              ) : node.status === "running" ? (
                <span className="spinner" />
              ) : (
                <i />
              )}
            </span>
            <div>
              <strong>{node.label}</strong>
              <span>{node.detail}</span>
              <small>
                {node.score !== undefined
                  ? `sample ${node.score.toFixed(2)}`
                  : node.duration ?? "queued"}
              </small>
            </div>
            {node.status === "adapted" && <em>adapted</em>}
          </div>
        ))}
      </div>
      <section className="policy-card">
        <header>
          <div>
            <Sparkles size={13} />
            <span>Live policy</span>
          </div>
          <small>Thompson sampling</small>
        </header>
        <PosteriorBars posteriors={posteriors} dense />
        <p>
          <span /> diamond = this turn&apos;s sample
        </p>
      </section>
      <section className="rail-systems">
        <div>
          <Database size={14} />
          <span>
            <b>ClickHouse</b>
            reward stream · posterior MV
          </span>
          <i className="healthy" />
        </div>
        <div>
          <Zap size={14} />
          <span>
            <b>Trigger.dev</b>
            agent · 3 probe tasks
          </span>
          <i className="healthy" />
        </div>
      </section>
    </aside>
  );
}

function LearningView({ posteriors }: { posteriors: Posterior[] }) {
  return (
    <div className="learning-view">
      <section className="learning-hero">
        <div>
          <span className="section-eyebrow">OUTER LOOP · ACROSS QUERIES</span>
          <h1>The third eye is getting sharper.</h1>
          <p>
            Simulated SRE replays bootstrap the policy honestly. Real panel
            interactions update the same ClickHouse reward stream.
          </p>
        </div>
        <div className="learning-summary">
          <span>
            <small>Episodes replayed</small>
            <b>312</b>
            <em>+48 today</em>
          </span>
          <span>
            <small>Reward events</small>
            <b>2,847</b>
            <em>materialized live</em>
          </span>
          <span>
            <small>Policy lift</small>
            <b>+42%</b>
            <em>vs. uniform policy</em>
          </span>
        </div>
      </section>
      <div className="learning-grid">
        <section className="learning-panel curve-panel">
          <header>
            <div>
              <span className="section-eyebrow">7-DAY LEARNING CURVE</span>
              <h2>Correct probe in the first fan-out</h2>
            </div>
            <span className="bootstrap-pill">simulated-SRE bootstrap</span>
          </header>
          <LearningChart data={LEARNING_CURVE} />
        </section>
        <section className="learning-panel posterior-panel">
          <header>
            <div>
              <span className="section-eyebrow">POSTERIOR STATE</span>
              <h2>latency_after_deploy</h2>
            </div>
            <Braces size={17} />
          </header>
          <PosteriorBars posteriors={posteriors} />
        </section>
        <section className="learning-panel mechanics-panel">
          <header>
            <span className="section-eyebrow">CLICKHOUSE IS THE LEARNER</span>
            <h2>No training infrastructure.</h2>
          </header>
          <div className="mechanic-flow">
            <span>
              <MouseSignal />
              <b>Panel signal</b>
              click · dwell · confirm
            </span>
            <ArrowRight />
            <span>
              <Database />
              <b>reward_events</b>
              propensity logged
            </span>
            <ArrowRight />
            <span>
              <Activity />
              <b>posterior MV</b>
              sufficient statistics
            </span>
            <ArrowRight />
            <span>
              <Sparkles />
              <b>Next choice</b>
              sampled in &lt;10 ms
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

function MouseSignal() {
  return <CircleDot />;
}

function FullscreenPanel({
  panel,
  onClose,
}: {
  panel: PanelData;
  onClose: () => void;
}) {
  return (
    <div className="panel-overlay" role="dialog" aria-modal="true">
      <div className="panel-dialog">
        <button className="overlay-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <span className="panel-eyebrow">
          <i /> {panel.eyebrow}
        </span>
        <h2>{panel.title}</h2>
        <p>{panel.summary}</p>
        <PanelVisual panel={panel} />
        <div className="dialog-detail-grid">
          <span>
            <small>Policy sample</small>
            <b>{panel.sampledScore.toFixed(2)}</b>
          </span>
          <span>
            <small>Logged propensity</small>
            <b>{panel.propensity.toFixed(2)}</b>
          </span>
          <span>
            <small>Evidence confidence</small>
            <b>{panel.confidence}%</b>
          </span>
        </div>
      </div>
    </div>
  );
}

export function TrinetraDashboard() {
  const [view, setView] = useState<View>("canvas");
  const [query, setQuery] = useState(DEMO_QUERY);
  const [submittedQuery, setSubmittedQuery] = useState(DEMO_QUERY);
  const [episodeId, setEpisodeId] = useState("demo-episode");
  const [panels, setPanels] = useState<PanelData[]>([]);
  const [nodes, setNodes] = useState<DagNode[]>(INITIAL_DAG.slice(0, 2));
  const [posteriors, setPosteriors] =
    useState<Posterior[]>(INITIAL_POSTERIORS);
  const [rootCause, setRootCause] = useState<RootCause | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null);
  const [expandedPanel, setExpandedPanel] = useState<PanelData | null>(null);
  const [adaptation, setAdaptation] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const startedRef = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  const pushToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2900);
  }, []);

  const recordInteraction = useCallback(
    async (
      panel: PanelData,
      eventType: RewardEvent["eventType"],
      value: number,
    ) => {
      if (!episodeId) return null;
      const response = await fetch("/api/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeId,
          contextBucket: "latency_after_deploy",
          arm: panel.arm,
          panelId: panel.id,
          eventType,
          value,
          propensity: panel.propensity,
        } satisfies RewardEvent),
      });
      if (!response.ok) return null;
      return response.json() as Promise<{
        accepted: boolean;
        policyShift: null | {
          posteriors: Posterior[];
          nextPanel: PanelData;
          node: DagNode;
        };
      }>;
    },
    [episodeId],
  );

  const runInvestigation = useCallback(
    async (nextQuery: string) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setLoading(true);
      setConfirmed(false);
      setAdaptation(false);
      setPanels([]);
      setNodes([]);
      setRootCause(null);
      setPosteriors(INITIAL_POSTERIORS);
      setSubmittedQuery(nextQuery);
      setView("canvas");

      try {
        const response = await fetch("/api/investigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: nextQuery }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error("Investigation could not be started");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const raw of lines) {
            if (!raw.trim()) continue;
            const event = JSON.parse(raw) as InvestigationEvent;
            if (event.type === "episode" && event.episodeId) {
              setEpisodeId(event.episodeId);
            }
            if (event.type === "node" && event.node) {
              setNodes((current) => updateNode(current, event.node!));
            }
            if (event.type === "panel" && event.panel) {
              setPanels((current) => {
                if (current.some((panel) => panel.id === event.panel!.id)) {
                  return current;
                }
                return [...current, event.panel!];
              });
            }
            if (event.type === "posterior" && event.posterior) {
              setPosteriors(event.posterior);
            }
            if (event.type === "root_cause" && event.rootCause) {
              setRootCause(event.rootCause);
            }
            if (event.type === "done") setLoading(false);
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setPanels([PANELS.timeline, PANELS.heatmap, PANELS.deploy]);
          setNodes(INITIAL_DAG.map((node) => ({ ...node, status: "complete" })));
          setRootCause(ROOT_CAUSE);
          pushToast("Cloud stream unavailable · switched to local evidence");
        }
      } finally {
        setLoading(false);
      }
    },
    [pushToast],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const timer = window.setTimeout(() => void runInvestigation(DEMO_QUERY), 260);
    return () => {
      window.clearTimeout(timer);
      activeRequest.current?.abort();
    };
  }, [runInvestigation]);

  const selectPanel = useCallback(
    async (panel: PanelData) => {
      setSelectedPanel(panel.id);
      const response = await recordInteraction(panel, "click", 0.62);
      if (response?.policyShift && !adaptation) {
        setAdaptation(true);
        setPosteriors(response.policyShift.posteriors);
        setNodes((current) => updateNode(current, response.policyShift!.node));
        pushToast("Signal received · trace mining promoted from 4th to 1st");
        window.setTimeout(() => {
          setPanels((current) =>
            current.some(
              (candidate) => candidate.id === response.policyShift!.nextPanel.id,
            )
              ? current
              : [...current, response.policyShift!.nextPanel],
          );
        }, 720);
      }
    },
    [adaptation, pushToast, recordInteraction],
  );

  const expandPanel = useCallback(
    async (panel: PanelData) => {
      setExpandedPanel(panel);
      const response = await recordInteraction(panel, "expand", 0.78);
      if (response?.policyShift && !adaptation) {
        setAdaptation(true);
        setPosteriors(response.policyShift.posteriors);
        setNodes((current) => updateNode(current, response.policyShift!.node));
        setPanels((current) =>
          current.some(
            (candidate) => candidate.id === response.policyShift!.nextPanel.id,
          )
            ? current
            : [...current, response.policyShift!.nextPanel],
        );
        pushToast("Posterior shifted · the next probe changed");
      }
    },
    [adaptation, pushToast, recordInteraction],
  );

  const confirmRootCause = useCallback(async () => {
    const evidence = panels.find((panel) => panel.arm === "trace_mining") ??
      panels[0] ??
      PANELS.timeline;
    await recordInteraction(evidence, "confirm_root_cause", 1);
    setConfirmed(true);
    setPosteriors(ADAPTED_POSTERIORS);
    pushToast("Jackpot reward logged · credit assigned to 4 probes");
  }, [panels, pushToast, recordInteraction]);

  const showExploration = useCallback(() => {
    setPanels((current) =>
      current.some((panel) => panel.id === PANELS.cardinality.id)
        ? current
        : [...current, PANELS.cardinality],
    );
    setNodes((current) =>
      updateNode(current, {
        id: "cardinality_scan",
        label: "Cardinality scan",
        detail: "Explored, ruled out, policy recovered",
        arm: "cardinality_scan",
        status: "complete",
        duration: "816 ms",
        score: 0.39,
      }),
    );
    setView("canvas");
    pushToast("Exploratory arm shown · negative evidence is still evidence");
  }, [pushToast]);

  const canvasTitle = useMemo(
    () =>
      loading && panels.length === 0
        ? "Opening the third eye…"
        : "Incident canvas",
    [loading, panels.length],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <EyeMark small />
          <div>
            <strong>TRINETRA</strong>
            <span>TELEMETRY INTELLIGENCE</span>
          </div>
        </div>
        <nav className="top-nav" aria-label="Primary">
          <button
            className={view === "canvas" ? "active" : ""}
            onClick={() => setView("canvas")}
          >
            <Grid2X2 size={14} /> Canvas
          </button>
          <button
            className={view === "dag" ? "active" : ""}
            onClick={() => setView("dag")}
          >
            <Network size={14} /> Investigation
          </button>
          <button
            className={view === "learning" ? "active" : ""}
            onClick={() => setView("learning")}
          >
            <Activity size={14} /> Learning
          </button>
        </nav>
        <div className="top-status">
          <span>
            <i /> systems nominal
          </span>
          <button className="avatar">AK</button>
        </div>
      </header>

      <div className={`workspace ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        <aside className="sidebar">
          <button
            className="new-investigation"
            onClick={() => {
              setQuery("");
              setPanels([]);
              setRootCause(null);
            }}
          >
            <Sparkles size={14} /> New investigation
          </button>
          <div className="sidebar-section">
            <div className="sidebar-label">
              <span>RECENT INCIDENTS</span>
              <ChevronDown size={13} />
            </div>
            {RECENT_INCIDENTS.map((incident) => (
              <button className="incident-link" key={incident.id}>
                <i className={incident.tone} />
                <span>
                  <b>{incident.title}</b>
                  <small>{incident.id}</small>
                </span>
                <em>{incident.time}</em>
              </button>
            ))}
          </div>
          <div className="sidebar-section saved">
            <div className="sidebar-label">
              <span>SAVED VIEWS</span>
              <ChevronDown size={13} />
            </div>
            <button>
              <LayoutDashboard size={14} /> Production overview
            </button>
            <button>
              <History size={14} /> Last 24 hours
            </button>
          </div>
          <div className="sidebar-bottom">
            <div>
              <Database size={14} />
              <span>
                <b>Production</b>
                18.4M events / min
              </span>
              <ChevronRight size={13} />
            </div>
            <button
              aria-label="Collapse sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
        </aside>

        {!sidebarOpen && (
          <button
            className="sidebar-reopen"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Eye size={16} />
          </button>
        )}

        <section className="main-stage">
          {view === "learning" ? (
            <LearningView posteriors={posteriors} />
          ) : (
            <>
              <div className="query-strip">
                <div className="query-context">
                  <EyeMark />
                  <div>
                    <span>{canvasTitle}</span>
                    <h1>{submittedQuery}</h1>
                  </div>
                </div>
                <form
                  className="query-box"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (query.trim()) void runInvestigation(query.trim());
                  }}
                >
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Ask your telemetry anything…"
                    aria-label="Telemetry question"
                  />
                  <kbd>⌘ K</kbd>
                  <button disabled={loading || !query.trim()} aria-label="Send">
                    {loading ? <span className="spinner" /> : <Send size={15} />}
                  </button>
                </form>
                <div className="suggestion-row">
                  {suggestions.slice(1).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setQuery(suggestion);
                        void runInvestigation(suggestion);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              {view === "dag" ? (
                <div className="dag-full-view">
                  <div className="dag-full-header">
                    <div>
                      <span className="section-eyebrow">
                        TRIGGER.DEV DURABLE TASK GRAPH
                      </span>
                      <h1>Investigation fan-out</h1>
                      <p>
                        Every probe is independently retryable, observable, and
                        streamed back into the root chat session.
                      </p>
                    </div>
                    <button onClick={showExploration}>
                      <Play size={14} /> Replay exploratory miss
                    </button>
                  </div>
                  <div className="dag-canvas">
                    <div className="root-agent-node">
                      <EyeMark small />
                      <span>
                        <small>chat.agent()</small>
                        <b>trinetra-investigator</b>
                      </span>
                      <em>RUNNING</em>
                    </div>
                    <div className="fan-lines" />
                    <div className="probe-node-grid">
                      {nodes
                        .filter((node) => node.arm)
                        .map((node) => (
                          <div className={`probe-node ${node.status}`} key={node.id}>
                            <span>
                              {node.status === "complete" ||
                              node.status === "adapted" ? (
                                <Check size={13} />
                              ) : (
                                <span className="spinner" />
                              )}
                            </span>
                            <div>
                              <small>SUB-AGENT</small>
                              <b>{node.label}</b>
                              <p>{node.detail}</p>
                            </div>
                            <em>{node.duration ?? "running"}</em>
                            {node.score && (
                              <strong>sample {node.score.toFixed(2)}</strong>
                            )}
                          </div>
                        ))}
                    </div>
                    <div className="dag-data-row">
                      <div>
                        <Database size={19} />
                        <span>
                          <small>OLAP</small>
                          <b>ClickHouse Cloud</b>
                        </span>
                      </div>
                      <div>
                        <Database size={19} />
                        <span>
                          <small>OLTP</small>
                          <b>Managed Postgres</b>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="canvas-layout">
                  <div className="canvas-scroll">
                    {rootCause && (
                      <RootCauseCard
                        rootCause={rootCause}
                        confirmed={confirmed}
                        onConfirm={confirmRootCause}
                      />
                    )}
                    {loading && panels.length === 0 && (
                      <section className="opening-state">
                        <EyeMark />
                        <span>
                          <i />
                          <i />
                          <i />
                        </span>
                        <h2>Opening the third eye</h2>
                        <p>
                          Classifying intent, sampling the policy, and fanning
                          out durable probes.
                        </p>
                      </section>
                    )}
                    <div className="panel-grid">
                      {panels.map((panel) => (
                        <InvestigationPanel
                          key={panel.id}
                          panel={panel}
                          selected={selectedPanel === panel.id}
                          onSelect={selectPanel}
                          onExpand={expandPanel}
                        />
                      ))}
                      {loading && panels.length > 0 && (
                        <article className="panel-skeleton">
                          <span />
                          <i />
                          <i />
                          <i />
                          <p>Next probe is still running…</p>
                        </article>
                      )}
                    </div>
                    {!loading && panels.length > 0 && (
                      <section className="canvas-foot">
                        <div>
                          <Sparkles size={14} />
                          <span>
                            <b>
                              {adaptation
                                ? "This answer adapted to you."
                                : "This answer can adapt."}
                            </b>
                            {adaptation
                              ? " Your signal promoted trace mining and changed the next panel."
                              : " Open the error cluster to steer which probe runs next."}
                          </span>
                        </div>
                        <button onClick={showExploration}>
                          Show exploration <ArrowRight size={13} />
                        </button>
                      </section>
                    )}
                  </div>
                  <DagRail
                    nodes={nodes}
                    posteriors={posteriors}
                    active={loading}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {expandedPanel && (
        <FullscreenPanel
          panel={expandedPanel}
          onClose={() => setExpandedPanel(null)}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={14} />
          {toast}
        </div>
      )}
    </main>
  );
}
