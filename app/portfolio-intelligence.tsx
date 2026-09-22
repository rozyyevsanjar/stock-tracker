"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { holdingAssetClass, isSavingsHolding, summarizeExposure } from "@/lib/exposure";
import type { Holding } from "@/lib/types";

type View = "overall" | "investments";
type TargetMap = Record<string, number>;

const TARGET_KEY = "portfolio-allocation-targets";
const DEFAULT_TARGETS: TargetMap = { "Global equities": 30, "Individual stocks": 30, Crypto: 15, Metals: 10, Savings: 15, "Bonds / Sukuk": 0 };

export function PortfolioIntelligence({ currency, holdings }: { currency: "USD" | "EUR" | "AED"; holdings: Holding[] }) {
  const [view, setView] = useState<View>("overall");
  const [targets, setTargets] = useState<TargetMap>(DEFAULT_TARGETS);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TARGET_KEY);
      if (saved) setTargets({ ...DEFAULT_TARGETS, ...JSON.parse(saved) });
    } catch {
      // Keep useful defaults when browser storage is unavailable.
    }
  }, []);

  const visible = useMemo(
    () => (view === "overall" ? holdings : holdings.filter((holding) => !isSavingsHolding(holding))),
    [holdings, view],
  );
  const total = visible.reduce((sum, holding) => sum + holding.currentValue, 0);
  const categories = Array.from(
    visible.reduce((map, holding) => {
      const category = holdingAssetClass(holding);
      map.set(category, (map.get(category) ?? 0) + holding.currentValue);
      return map;
    }, new Map<string, number>()),
  )
    .map(([category, value]) => ({ category, percent: total ? (value / total) * 100 : 0, value }))
    .sort((a, b) => b.value - a.value);
  const largest = [...visible].sort((a, b) => b.currentValue - a.currentValue)[0];
  const topThree = [...visible].sort((a, b) => b.currentValue - a.currentValue).slice(0, 3);
  const topThreePercent = total ? (topThree.reduce((sum, item) => sum + item.currentValue, 0) / total) * 100 : 0;
  const maxValue = Math.max(...visible.map((holding) => holding.currentValue), 1);
  const sectors = summarizeExposure(visible, "sector");
  const countries = summarizeExposure(visible, "country");

  function updateTarget(category: string, value: number) {
    const next = { ...targets, [category]: Math.max(0, Math.min(100, value || 0)) };
    setTargets(next);
    window.localStorage.setItem(TARGET_KEY, JSON.stringify(next));
  }

  return (
    <section className="portfolioIntelligence">
      <div className="sectionHeader">
        <div>
          <h2>Allocation & targets</h2>
          <p className="sectionNote">Compare current exposure with the mix you want to maintain.</p>
        </div>
        <div className="segmentedControl" aria-label="Portfolio view">
          <button className={view === "overall" ? "active" : ""} onClick={() => setView("overall")} type="button">Overall assets</button>
          <button className={view === "investments" ? "active" : ""} onClick={() => setView("investments")} type="button">Investments</button>
        </div>
      </div>

      <div className="concentrationStrip">
        <span>Total <strong>{formatCurrency(total, currency)}</strong></span>
        <span>Largest <strong>{largest ? `${largest.ticker} · ${formatPercent(total ? largest.currentValue / total * 100 : 0)}` : "-"}</strong></span>
        <span>Top 3 concentration <strong>{formatPercent(topThreePercent)}</strong></span>
      </div>

      <div className="exposureDimensions">
        <span>Largest sector <strong>{sectors[0] ? `${sectors[0].label} · ${formatPercent(sectors[0].percent)}` : "-"}</strong></span>
        <span>Largest geography <strong>{countries[0] ? `${countries[0].label} · ${formatPercent(countries[0].percent)}` : "-"}</strong></span>
      </div>

      <div className="portfolioValueBars">
        {visible.map((holding) => (
          <div key={holding.ticker}>
            <span>{holding.ticker}</span>
            <i><b style={{ width: `${holding.currentValue / maxValue * 100}%` }} /></i>
            <strong>{formatCurrency(holding.currentValue, currency)}</strong>
          </div>
        ))}
      </div>

      <div className="allocationTargetsGrid">
        <div>
          <h3>Current mix</h3>
          <div className="allocationList">
            {categories.map((item) => (
              <div className="categoryAllocationRow" key={item.category}>
                <span>{item.category}</span>
                <div className="barTrack"><div className="barFill" style={{ width: `${Math.min(item.percent, 100)}%` }} /></div>
                <strong>{formatPercent(item.percent)}</strong>
                <em>{formatCurrency(item.value, currency)}</em>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>Target drift</h3>
          <div className="targetList">
            {Array.from(new Set([...Object.keys(targets), ...categories.map((item) => item.category)]))
              .filter((category) => view === "overall" || category !== "Savings")
              .map((category) => {
                const current = categories.find((item) => item.category === category)?.percent ?? 0;
                const target = targets[category] ?? 0;
                const drift = current - target;
                return (
                  <div className="targetRow" key={category}>
                    <span>{category}</span>
                    <label><input aria-label={`${category} target`} min="0" max="100" onChange={(event) => updateTarget(category, Number(event.target.value))} type="number" value={target} />%</label>
                    <strong className={Math.abs(drift) < 1 ? "neutral" : drift > 0 ? "negative" : "positive"}>{drift > 0 ? "+" : ""}{drift.toFixed(1)}%</strong>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </section>
  );
}
