"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { formatMoney, formatPercent } from "@/lib/format";
import type { PerformancePoint } from "@/lib/types";

type Timeframe = "1d" | "1w" | "1m" | "1y" | "all";

const TIMEFRAMES: Array<{ label: string; value: Timeframe }> = [
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1m" },
  { label: "1Y", value: "1y" },
  { label: "All", value: "all" },
];

const SCROLL_STORAGE_KEY = "portfolio-performance-scroll-y";

function tone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatAxisMoney(value: number) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

function formatAxisDate(value: string, timeframe: Timeframe) {
  const date = new Date(value);
  if (timeframe === "1d") {
    return date.toLocaleTimeString("en-US", { hour: "numeric" });
  }
  if (timeframe === "1w") {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  if (timeframe === "1y" || timeframe === "all") {
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTooltipDate(value: string, timeframe: Timeframe) {
  const date = new Date(value);
  if (timeframe === "1d" || timeframe === "1w") {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PerformanceChart({
  points,
  timeframe,
}: {
  points: PerformancePoint[];
  timeframe: Timeframe;
}) {
  const pathname = usePathname();

  useEffect(() => {
    const savedScrollY = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (!savedScrollY) return;

    window.sessionStorage.removeItem(SCROLL_STORAGE_KEY);
    const scrollY = Number(savedScrollY);
    if (!Number.isFinite(scrollY)) return;

    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });
  }, [timeframe]);

  function rememberScrollPosition() {
    window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
  }

  function timeframeHref(nextTimeframe: Timeframe) {
    return `${pathname}?range=${nextTimeframe}#portfolio-performance`;
  }

  if (!points.length) {
    return <p className="muted">Not enough dated history to build performance yet.</p>;
  }

  const width = 760;
  const height = 320;
  const padding = { top: 24, right: 22, bottom: 44, left: 70 };
  const values = points.flatMap((point) => [point.marketValue, point.invested]);
  const minValue = Math.min(...values) * 0.96;
  const maxValue = Math.max(...values) * 1.03;
  const x = (index: number) =>
    padding.left +
    (index / Math.max(points.length - 1, 1)) *
      (width - padding.left - padding.right);
  const y = (value: number) =>
    height -
    padding.bottom -
    ((value - minValue) / (maxValue - minValue || 1)) *
      (height - padding.top - padding.bottom);
  const toPath = (key: "marketValue" | "invested") =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point[key])}`)
      .join(" ");
  const latest = points[points.length - 1];
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = minValue + ((maxValue - minValue) / 4) * index;
    return { value, y: y(value) };
  });
  const xTickIndexes = Array.from(
    new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  );

  return (
    <section id="portfolio-performance">
      <div className="sectionHeader">
        <div>
          <h2>Portfolio performance</h2>
          <p className="sectionNote">
            Uses your purchase dates and lots. Market value starts counting a lot after
            its purchase date, while invested capital steps up when you buy more.
          </p>
        </div>
        <nav className="timeframeNav" aria-label="Performance timeframe">
          {TIMEFRAMES.map((item) => (
            <Link
              aria-current={item.value === timeframe ? "page" : undefined}
              className={item.value === timeframe ? "active" : ""}
              href={timeframeHref(item.value)}
              key={item.value}
              onClick={rememberScrollPosition}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="chartShell">
        <svg
          aria-label="Portfolio performance chart"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {yTicks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={padding.left}
                y1={tick.y}
                x2={width - padding.right}
                y2={tick.y}
                className="gridLine"
              />
              <text x={padding.left - 10} y={tick.y + 4} className="axisLabel" textAnchor="end">
                {formatAxisMoney(tick.value)}
              </text>
            </g>
          ))}
          {xTickIndexes.map((index) => (
            <text
              className="axisLabel"
              key={points[index].date}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
              x={x(index)}
              y={height - 12}
            >
              {formatAxisDate(points[index].date, timeframe)}
            </text>
          ))}
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={height - padding.bottom}
            className="axis"
          />
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            className="axis"
          />
          <path d={toPath("invested")} className="investedLine" />
          <path d={toPath("marketValue")} className="valueLine" />
          {points.map((point, index) => {
            const pointX = x(index);
            const valueY = y(point.marketValue);
            const investedY = y(point.invested);
            const tooltipX = pointX > width - 210 ? -190 : 12;
            const tooltipY = valueY < 112 ? 16 : -92;
            const tooltipDate = formatTooltipDate(point.date, timeframe);

            return (
              <g className="dataPoint" key={point.date}>
                <line
                  x1={pointX}
                  y1={padding.top}
                  x2={pointX}
                  y2={height - padding.bottom}
                  className="hoverGuide"
                />
                <circle cx={pointX} cy={investedY} r="4" className="investedDot" />
                <circle cx={pointX} cy={valueY} r="5" className="valueDot" />
                <g className="svgTooltip" transform={`translate(${pointX + tooltipX} ${valueY + tooltipY})`}>
                  <rect width="178" height="78" rx="8" />
                  <text x="10" y="18" className="tooltipTitle">{tooltipDate}</text>
                  <text x="10" y="34">Value: {formatMoney(point.marketValue)}</text>
                  <text x="10" y="48">Invested: {formatMoney(point.invested)}</text>
                  <text x="10" y="62">P/L: {formatMoney(point.profit)}</text>
                  <text x="10" y="74">Return: {formatPercent(point.returnPercent)}</text>
                </g>
                <circle
                  aria-label={`${tooltipDate} portfolio value ${formatMoney(point.marketValue)}`}
                  className="dataHitArea"
                  cx={pointX}
                  cy={valueY}
                  r="8"
                  tabIndex={0}
                />
              </g>
            );
          })}
        </svg>
        <div className="chartLegend">
          <span><i className="legendValue" /> Market value</span>
          <span><i className="legendInvested" /> Invested capital</span>
        </div>
      </div>
      <div className="performanceSummary">
        <span>Latest value: <strong>{formatMoney(latest.marketValue)}</strong></span>
        <span>Invested: <strong>{formatMoney(latest.invested)}</strong></span>
        <span>P/L: <strong className={tone(latest.profit)}>{formatMoney(latest.profit)}</strong></span>
        <span>Return: <strong className={tone(latest.returnPercent)}>{formatPercent(latest.returnPercent)}</strong></span>
      </div>
    </section>
  );
}
