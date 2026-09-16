import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Quote, TrackedPosition, TrackerPosition } from "./types";

function parseNumber(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
): TrackedPosition[] {
  return positions.map((position) => {
    const quote = position.marketTicker ? quotes[position.marketTicker] : undefined;
    const livePrice = quote?.price ?? null;
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
      marketSource: usingLivePrice ? quote?.source ?? "Live quote" : "Workbook snapshot",
      profit,
      returnPercent,
      usesLivePrice: usingLivePrice,
    };
  });
}
