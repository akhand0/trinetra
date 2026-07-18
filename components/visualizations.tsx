"use client";

import type {
  HeatCell,
  Posterior,
  SeriesPoint,
  TraceSpan,
} from "@/lib/types";

function linePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function AreaChart({
  data,
  compact = false,
}: {
  data: SeriesPoint[];
  compact?: boolean;
}) {
  const width = 620;
  const height = compact ? 145 : 190;
  const pad = { x: 14, top: 14, bottom: 26 };
  const values = data.flatMap((point) =>
    point.secondary === undefined
      ? [point.value]
      : [point.value, point.secondary],
  );
  const max = Math.max(...values) * 1.08;
  const min = Math.min(...values) * 0.78;
  const x = (index: number) =>
    pad.x + (index / Math.max(data.length - 1, 1)) * (width - pad.x * 2);
  const y = (value: number) =>
    pad.top +
    ((max - value) / Math.max(max - min, 1)) *
      (height - pad.top - pad.bottom);
  const primary = data.map((point, index) => ({
    x: x(index),
    y: y(point.value),
  }));
  const secondary = data
    .filter((point) => point.secondary !== undefined)
    .map((point, index) => ({ x: x(index), y: y(point.secondary ?? 0) }));
  const area = `${linePath(primary)} L ${primary.at(-1)?.x} ${height - pad.bottom} L ${primary[0]?.x} ${height - pad.bottom} Z`;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Telemetry time series"
    >
      <defs>
        <linearGradient id="area-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff8a3d" stopOpacity=".34" />
          <stop offset="100%" stopColor="#ff8a3d" stopOpacity="0" />
        </linearGradient>
        <filter id="line-glow">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {[0.25, 0.5, 0.75].map((position) => (
        <line
          key={position}
          x1="0"
          x2={width}
          y1={position * (height - pad.bottom)}
          y2={position * (height - pad.bottom)}
          stroke="rgba(255,255,255,.06)"
        />
      ))}
      <path d={area} fill="url(#area-glow)" />
      <path
        d={linePath(primary)}
        fill="none"
        stroke="#ff8a3d"
        strokeWidth="2.5"
        filter="url(#line-glow)"
      />
      {secondary.length > 1 && (
        <path
          d={linePath(secondary)}
          fill="none"
          stroke="#70d9ff"
          strokeWidth="1.8"
          strokeDasharray="4 5"
        />
      )}
      {primary.map((point, index) =>
        index === primary.length - 1 || index === 5 ? (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#ff8a3d"
            stroke="#151922"
            strokeWidth="2"
          />
        ) : null,
      )}
      {data.map((point, index) =>
        index % Math.ceil(data.length / 5) === 0 ||
        index === data.length - 1 ? (
          <text
            key={point.label}
            x={x(index)}
            y={height - 6}
            fill="rgba(214,220,232,.46)"
            fontSize="10"
            textAnchor={
              index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"
            }
          >
            {point.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const rows = Array.from(new Set(cells.map((cell) => cell.row)));
  const columns = Array.from(new Set(cells.map((cell) => cell.column)));

  return (
    <div className="heatmap" role="img" aria-label="Error intensity by service">
      <div className="heatmap-spacer" />
      {columns.map((column, index) => (
        <span className="heatmap-time" key={`${column}-${index}`}>
          {index % 2 === 0 ? column : ""}
        </span>
      ))}
      {rows.map((row) => (
        <div className="heatmap-row" key={row}>
          <span>{row}</span>
          {columns.map((column, index) => {
            const cell = cells.find(
              (candidate) =>
                candidate.row === row &&
                candidate.column === column &&
                cells.indexOf(candidate) % columns.length === index,
            );
            const value = cell?.value ?? 0;
            return (
              <i
                key={`${row}-${column}-${index}`}
                title={`${row} · ${column} · ${Math.round(value * 100)}%`}
                style={{
                  background: `rgba(255, ${Math.round(133 - value * 64)}, 74, ${0.08 + value * 0.9})`,
                  boxShadow:
                    value > 0.7
                      ? `0 0 14px rgba(255, 92, 58, ${value * 0.45})`
                      : "none",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function TraceWaterfall({ spans }: { spans: TraceSpan[] }) {
  return (
    <div className="trace-waterfall" role="img" aria-label="Distributed trace">
      <div className="trace-scale">
        <span>0 ms</span>
        <span>156 ms</span>
        <span>312 ms</span>
      </div>
      {spans.map((span) => (
        <div className="trace-row" key={span.id}>
          <div className="trace-label">
            <strong>{span.service}</strong>
            <span>{span.operation}</span>
          </div>
          <div className="trace-track">
            <i
              className={span.status}
              style={{
                left: `${span.start}%`,
                width: `${span.duration}%`,
              }}
            >
              <span>{Math.round((span.duration / 100) * 312)} ms</span>
            </i>
          </div>
        </div>
      ))}
    </div>
  );
}

export function LearningChart({ data }: { data: SeriesPoint[] }) {
  const width = 780;
  const height = 260;
  const points = data.map((item, index) => ({
    x: 32 + (index / Math.max(data.length - 1, 1)) * (width - 64),
    y: 22 + (1 - item.value) * (height - 64),
  }));
  const area = `${linePath(points)} L ${points.at(-1)?.x} ${height - 38} L ${points[0]?.x} ${height - 38} Z`;

  return (
    <svg
      className="learning-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Policy precision over time"
    >
      <defs>
        <linearGradient id="learning-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c6cff" stopOpacity=".32" />
          <stop offset="100%" stopColor="#7c6cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.4, 0.6, 0.8].map((level) => {
        const y = 22 + (1 - level) * (height - 64);
        return (
          <g key={level}>
            <line
              x1="32"
              x2={width - 32}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,.07)"
              strokeDasharray="3 5"
            />
            <text x="0" y={y + 4} fill="#697080" fontSize="10">
              {Math.round(level * 100)}%
            </text>
          </g>
        );
      })}
      <path d={area} fill="url(#learning-fill)" />
      <path
        d={linePath(points)}
        fill="none"
        stroke="#9588ff"
        strokeWidth="3"
      />
      {points.map((point, index) => (
        <g key={data[index].label}>
          <circle cx={point.x} cy={point.y} r="4" fill="#c0b7ff" />
          <text
            x={point.x}
            y={height - 12}
            textAnchor="middle"
            fill="#737b8e"
            fontSize="11"
          >
            {data[index].label}
          </text>
          {index === points.length - 1 && (
            <text
              x={point.x - 8}
              y={point.y - 12}
              textAnchor="end"
              fill="#d8d4ff"
              fontSize="12"
              fontWeight="600"
            >
              84% precision
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function PosteriorBars({
  posteriors,
  dense = false,
}: {
  posteriors: Posterior[];
  dense?: boolean;
}) {
  return (
    <div className={dense ? "posterior-list dense" : "posterior-list"}>
      {posteriors.map((posterior) => (
        <div className="posterior-row" key={posterior.arm}>
          <div className="posterior-meta">
            <span>{posterior.label}</span>
            <b>{Math.round(posterior.mean * 100)}%</b>
          </div>
          <div className="posterior-track">
            <i style={{ width: `${posterior.mean * 100}%` }} />
            <em style={{ left: `${posterior.sampled * 100}%` }} />
          </div>
          {!dense && (
            <div className="posterior-foot">
              <span>
                β({posterior.alpha.toFixed(0)}, {posterior.beta.toFixed(0)})
              </span>
              <span>
                sample {posterior.sampled.toFixed(2)}
                {posterior.delta ? ` · +${Math.round(posterior.delta * 100)}pt` : ""}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
