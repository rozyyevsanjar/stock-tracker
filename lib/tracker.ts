import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Quote, TrackedPosition, TrackerPosition } from "./types";

export type DisplayCurrency = "USD" | "EUR" | "AED";

export const DISPLAY_CURRENCIES: DisplayCurrency[] = ["USD", "EUR", "AED"];

type MetalPrice = {
  price: number;
  source: string;
};

type MetalPrices = Partial<Record<"GOLD" | "SILVER", MetalPrice>>;

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

function parseNumber(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripNumber(value: string | null | undefined) {
  if (!value) return null;
  return parseNumber(value.replace(/[^\d.-]/g, ""));
}

function metalKey(ticker: string): "GOLD" | "SILVER" | null {
  if (ticker === "GOLD") return "GOLD";
  if (ticker === "SILVER") return "SILVER";
  return null;
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

export async function loadTrackerPositions(): Promise<TrackerPosition[]> {
  const filePath = path.join(process.cwd(), "data", "tracker-positions.csv");
  const examplePath = path.join(process.cwd(), "data", "tracker-positions.example.csv");
  const content = await readFile(filePath, "utf8").catch(() => readFile(examplePath, "utf8"));
  const [headerLine, ...rows] = content.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine);

  return rows
    .filter((row) => row.trim())
    .map((row) => {
      const values = splitCsvLine(row);
      const record = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );

      return {
        asset: String(record.asset ?? "").trim(),
        assetType: String(record.asset_type ?? "").trim(),
        avgPrice: parseNumber(record.avg_price) ?? 0,
        marketTicker: String(record.market_ticker ?? "").toUpperCase().trim(),
        notes: String(record.notes ?? "").trim(),
        platform: String(record.platform ?? "").trim(),
        plCurrency: String(record.pl_currency ?? record.price_currency ?? "").trim(),
        priceCurrency: String(record.price_currency ?? "").trim(),
        quantity: parseNumber(record.quantity) ?? 0,
        snapshotPl: parseNumber(record.snapshot_pl),
        snapshotPrice: parseNumber(record.snapshot_price),
        snapshotReturn: parseNumber(record.snapshot_return),
        snapshotValue: parseNumber(record.snapshot_value),
        ticker: String(record.ticker ?? "").toUpperCase().trim(),
        unit: String(record.unit ?? "").trim(),
        valueCurrency: String(record.value_currency ?? record.price_currency ?? "").trim(),
      };
    })
    .filter((position) => position.ticker && position.quantity > 0);
}

export function buildTrackedPositions(
  positions: TrackerPosition[],
  quotes: Record<string, Quote>,
  metalPrices: MetalPrices = {},
): TrackedPosition[] {
  return positions.map((position) => {
    const quote = position.marketTicker ? quotes[position.marketTicker] : undefined;
    const metal = metalKey(position.ticker);
    const metalPrice = metal ? metalPrices[metal] : undefined;
    const livePrice = metalPrice?.price ?? quote?.price ?? null;
    const currentPrice = livePrice ?? position.snapshotPrice ?? position.avgPrice;
    const currentValue = position.quantity * currentPrice;
    const costBasis = position.quantity * position.avgPrice;
    const calculatedProfit = currentValue - costBasis;
    const usingLivePrice = livePrice !== null && livePrice !== undefined;
    const profit =
      usingLivePrice || position.snapshotPl === null ? calculatedProfit : position.snapshotPl;
    const returnPercent =
      costBasis ? (profit / costBasis) * 100 : (position.snapshotReturn ?? 0) * 100;

    return {
      ...position,
      costBasis,
      currentPrice,
      currentValue,
      dailyChange: usingLivePrice && quote?.dailyChange ? quote.dailyChange * position.quantity : null,
      dailyChangePercent: usingLivePrice ? quote?.dailyChangePercent ?? null : null,
      marketSource: metalPrice?.source ?? (usingLivePrice ? quote?.source ?? "Live quote" : "Workbook snapshot"),
      profit,
      returnPercent,
      usesLivePrice: usingLivePrice,
    };
  });
}

function isStakingEthPosition(position: TrackerPosition) {
  return (
    position.platform.toLowerCase() === "etoro" &&
    position.ticker === "ETH" &&
    position.marketTicker === "ETH-USD" &&
    position.quantity > 0 &&
    position.quantity < 0.01
  );
}

function combinedEthNotes(positions: TrackerPosition[]) {
  const ids = positions
    .map((position) => /eToro position\s+(\d+)/i.exec(position.notes)?.[1])
    .filter(Boolean);
  return `Combined staking ETH positions${ids.length ? `: ${ids.join(", ")}` : ""}`;
}

export function combineStakingEthPositions(positions: TrackerPosition[]) {
  const stakingPositions = positions.filter(isStakingEthPosition);
  if (stakingPositions.length < 2) return positions;

  const remainingPositions = positions.filter((position) => !isStakingEthPosition(position));
  const quantity = stakingPositions.reduce((total, position) => total + position.quantity, 0);
  const costBasis = stakingPositions.reduce(
    (total, position) => total + position.quantity * position.avgPrice,
    0,
  );
  const snapshotValue = stakingPositions.reduce(
    (total, position) =>
      total + (position.snapshotValue ?? position.quantity * (position.snapshotPrice ?? position.avgPrice)),
    0,
  );
  const snapshotPl = stakingPositions.reduce(
    (total, position) => total + (position.snapshotPl ?? 0),
    0,
  );
  const firstPosition = stakingPositions[0];
  const combinedPosition: TrackerPosition = {
    ...firstPosition,
    asset: "Ethereum staking rewards",
    avgPrice: quantity ? costBasis / quantity : firstPosition.avgPrice,
    notes: combinedEthNotes(stakingPositions),
    quantity,
    snapshotPl,
    snapshotPrice: quantity ? snapshotValue / quantity : firstPosition.snapshotPrice,
    snapshotReturn: costBasis ? snapshotPl / costBasis : firstPosition.snapshotReturn,
    snapshotValue,
  };

  const firstStakingIndex = positions.findIndex(isStakingEthPosition);
  const insertIndex = firstStakingIndex === -1 ? remainingPositions.length : firstStakingIndex;
  return [
    ...remainingPositions.slice(0, insertIndex),
    combinedPosition,
    ...remainingPositions.slice(insertIndex),
  ];
}

async function fetchYahooRate(from: string, to: string) {
  if (from === to) return 1;

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${from}${to}=X?range=5d&interval=1d`,
      { headers, next: { revalidate: 900 } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const closes: Array<number | null> =
      data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const rates = closes.filter((value): value is number => typeof value === "number");
    return rates[rates.length - 1] ?? null;
  } catch {
    return null;
  }
}

export async function fetchCurrencyRates(displayCurrency: DisplayCurrency) {
  const currencies: DisplayCurrency[] = ["USD", "EUR", "AED"];
  const rates = new Map<string, number>();
  rates.set(displayCurrency, 1);

  await Promise.all(
    currencies
      .filter((currency) => currency !== displayCurrency)
      .map(async (currency) => {
        const directRate = await fetchYahooRate(currency, displayCurrency);
        if (directRate) {
          rates.set(currency, directRate);
          return;
        }

        const toUsd = await fetchYahooRate(currency, "USD");
        const usdToDisplay = await fetchYahooRate("USD", displayCurrency);
        rates.set(currency, toUsd && usdToDisplay ? toUsd * usdToDisplay : 1);
      }),
  );

  return rates;
}

export function convertTrackedPositions(
  positions: TrackedPosition[],
  displayCurrency: DisplayCurrency,
  rates: Map<string, number>,
) {
  return positions.map((position) => {
    const currency = position.priceCurrency || position.valueCurrency || "USD";
    const rate = rates.get(currency) ?? 1;
    return {
      ...position,
      costBasisDisplay: position.costBasis * rate,
      currentPriceDisplay: position.currentPrice * rate,
      currentValueDisplay: position.currentValue * rate,
      displayCurrency,
      profitDisplay: position.profit * rate,
      sourceCurrency: currency,
    };
  });
}

export async function fetchDubaiMetalPrices(): Promise<MetalPrices> {
  try {
    const response = await fetch("https://mintjewels.ae/live-gold-price-dubai/", {
      headers,
      next: { revalidate: 900 },
    });
    if (!response.ok) return {};
    const html = await response.text();
    const gold = stripNumber(/Gold 24K[\s\S]{0,120}?AED\s*([\d,.]+)/i.exec(html)?.[1]);
    const silver = stripNumber(/Silver 999[\s\S]{0,120}?AED\s*([\d,.]+)/i.exec(html)?.[1]);
    const source = "Dubai live metal rate";

    return {
      ...(gold ? { GOLD: { price: gold, source } } : {}),
      ...(silver ? { SILVER: { price: silver, source } } : {}),
    };
  } catch {
    return {};
  }
}
