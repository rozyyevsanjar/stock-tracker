import type { Holding } from "./types";

export type PortfolioExposure = {
  allocationPercent: number;
  directAllocationPercent: number;
  directValue: number;
  effectiveValue: number;
  etfOverlaps: Array<{ ticker: string; value: number; weightPercent: number }>;
  indirectAllocationPercent: number;
  indirectValue: number;
  investmentAllocationPercent: number;
  holding: Holding | null;
  symbol: string;
  totalAssetsValue: number;
  totalInvestmentValue: number;
};

// Approximate published index weights. These are deliberately labelled as estimates in the UI.
const ETF_COMPANY_WEIGHTS: Record<string, Record<string, number>> = {
  CSPX: { AAPL: 0.061, MSFT: 0.052, NVDA: 0.079, AMZN: 0.038, META: 0.027, GOOGL: 0.031, GOOG: 0.025, TSLA: 0.018 },
  QQQ: { AAPL: 0.078, MSFT: 0.071, NVDA: 0.091, AMZN: 0.052, META: 0.036, GOOGL: 0.029, GOOG: 0.027, TSLA: 0.031 },
  SPY: { AAPL: 0.061, MSFT: 0.052, NVDA: 0.079, AMZN: 0.038, META: 0.027, GOOGL: 0.031, GOOG: 0.025, TSLA: 0.018 },
  VOO: { AAPL: 0.061, MSFT: 0.052, NVDA: 0.079, AMZN: 0.038, META: 0.027, GOOGL: 0.031, GOOG: 0.025, TSLA: 0.018 },
  VUAA: { AAPL: 0.061, MSFT: 0.052, NVDA: 0.079, AMZN: 0.038, META: 0.027, GOOGL: 0.031, GOOG: 0.025, TSLA: 0.018 },
  VWRA: { AAPL: 0.041, MSFT: 0.035, NVDA: 0.052, AMZN: 0.026, META: 0.018, GOOGL: 0.02, GOOG: 0.016, TSLA: 0.012 },
  VWRL: { AAPL: 0.041, MSFT: 0.035, NVDA: 0.052, AMZN: 0.026, META: 0.018, GOOGL: 0.02, GOOG: 0.016, TSLA: 0.012 },
};

const ASSET_METADATA: Record<string, { country: string; sector: string }> = {
  AAL: { country: "United States", sector: "Industrials" },
  "BMW.DE": { country: "Germany", sector: "Consumer discretionary" },
  ETH: { country: "Global", sector: "Crypto" },
  "ETH-USD": { country: "Global", sector: "Crypto" },
  BTC: { country: "Global", sector: "Crypto" },
  "BTC-USD": { country: "Global", sector: "Crypto" },
  GOLD: { country: "Global", sector: "Precious metals" },
  SILVER: { country: "Global", sector: "Precious metals" },
  CSPX: { country: "United States", sector: "Broad market ETF" },
  QQQ: { country: "United States", sector: "Technology ETF" },
  SPY: { country: "United States", sector: "Broad market ETF" },
  VOO: { country: "United States", sector: "Broad market ETF" },
  VUAA: { country: "United States", sector: "Broad market ETF" },
  VWRA: { country: "Global", sector: "Broad market ETF" },
  VWRL: { country: "Global", sector: "Broad market ETF" },
};

export function isSavingsHolding(holding: Pick<Holding, "ticker">) {
  return holding.ticker.startsWith("SAVINGS");
}

export function holdingAssetClass(holding: Pick<Holding, "ticker">) {
  const ticker = holding.ticker.toUpperCase();
  if (ticker.startsWith("SAVINGS")) return "Savings";
  if (ticker === "GOLD" || ticker === "SILVER") return "Metals";
  if (ticker.includes("BTC") || ticker.includes("ETH") || ticker.endsWith("-USD")) return "Crypto";
  if (ETF_COMPANY_WEIGHTS[ticker]) return "Global equities";
  return "Individual stocks";
}

export function summarizeExposure(holdings: Holding[], dimension: "country" | "sector") {
  const total = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const values = holdings.reduce((map, holding) => {
    const ticker = holding.ticker.toUpperCase();
    const fallback = isSavingsHolding(holding)
      ? { country: "United Arab Emirates", sector: "Cash & savings" }
      : { country: "Other", sector: holdingAssetClass(holding) };
    const label = (ASSET_METADATA[ticker] ?? fallback)[dimension];
    map.set(label, (map.get(label) ?? 0) + holding.currentValue);
    return map;
  }, new Map<string, number>());

  return Array.from(values, ([label, value]) => ({
    label,
    percent: total ? (value / total) * 100 : 0,
    value,
  })).sort((a, b) => b.value - a.value);
}

export function calculatePortfolioExposure(holdings: Holding[], rawSymbol: string): PortfolioExposure {
  const symbol = rawSymbol.toUpperCase().replace(/-USD$/, "");
  const totalAssetsValue = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const investments = holdings.filter((holding) => !isSavingsHolding(holding));
  const totalInvestmentValue = investments.reduce((sum, holding) => sum + holding.currentValue, 0);
  const holding = investments.find((item) => item.ticker.replace(/-USD$/, "") === symbol) ?? null;
  const directValue = holding?.currentValue ?? 0;
  const etfOverlaps = investments.flatMap((item) => {
    const weight = ETF_COMPANY_WEIGHTS[item.ticker]?.[symbol] ?? 0;
    return weight > 0
      ? [{ ticker: item.ticker, value: item.currentValue * weight, weightPercent: weight * 100 }]
      : [];
  });
  const indirectValue = etfOverlaps.reduce((sum, item) => sum + item.value, 0);
  const effectiveValue = directValue + indirectValue;

  return {
    allocationPercent: totalAssetsValue ? (effectiveValue / totalAssetsValue) * 100 : 0,
    directAllocationPercent: totalAssetsValue ? (directValue / totalAssetsValue) * 100 : 0,
    directValue,
    effectiveValue,
    etfOverlaps,
    holding,
    indirectAllocationPercent: totalAssetsValue ? (indirectValue / totalAssetsValue) * 100 : 0,
    indirectValue,
    investmentAllocationPercent: totalInvestmentValue ? (effectiveValue / totalInvestmentValue) * 100 : 0,
    symbol: rawSymbol,
    totalAssetsValue,
    totalInvestmentValue,
  };
}
