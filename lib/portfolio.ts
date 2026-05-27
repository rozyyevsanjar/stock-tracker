import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Holding, Lot, Quote } from "./types";

export const CASH_BALANCE = 8.62;

function parseNumber(value: string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
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

export async function loadLots(): Promise<Lot[]> {
  const filePath = path.join(process.cwd(), "data", "portfolio.csv");
  const content = await readFile(filePath, "utf8");
  const [headerLine, ...rows] = content.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine);

  return rows
    .map((row) => {
      const values = splitCsvLine(row);
      const record = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );

      return {
        ticker: String(record.ticker ?? "").toUpperCase().trim(),
        company: String(record.company ?? "").trim(),
        purchaseDate: String(record.purchase_date ?? "").trim(),
        shares: parseNumber(record.shares),
        buyPrice: parseNumber(record.buy_price),
        fees: parseNumber(record.fees),
        notes: String(record.notes ?? "").trim(),
      };
    })
    .filter((lot) => lot.ticker && lot.ticker !== "CASH");
}

export function parsePurchaseDate(date: string) {
  if (!date) return null;
  const [day, month, year] = date.split(/[/-]/).map(Number);
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function aggregateLots(lots: Lot[], quotes: Record<string, Quote>): Holding[] {
  const byTicker = new Map<string, Lot[]>();
  for (const lot of lots) {
    byTicker.set(lot.ticker, [...(byTicker.get(lot.ticker) ?? []), lot]);
  }

  const holdings: Holding[] = Array.from(byTicker.entries()).map(([ticker, tickerLots]) => {
    const quote = quotes[ticker] ?? {
      price: null,
      previousPrice: null,
      dailyChange: null,
      dailyChangePercent: null,
      source: "Unavailable",
    };
    const shares = tickerLots.reduce((total, lot) => total + lot.shares, 0);
    const invested = tickerLots.reduce(
      (total, lot) => total + lot.shares * lot.buyPrice + lot.fees,
      0,
    );
    const currentPrice = quote.price ?? (shares ? invested / shares : 0);
    const previousPrice = quote.previousPrice ?? currentPrice;
    const currentValue = shares * currentPrice;
    const previousValue = shares * previousPrice;
    const profit = currentValue - invested;

    return {
      ticker,
      company: tickerLots[0]?.company ?? ticker,
      shares,
      buyPrice: shares ? invested / shares : 0,
      invested,
      fees: tickerLots.reduce((total, lot) => total + lot.fees, 0),
      lots: tickerLots.length,
      currentPrice,
      previousPrice,
      dailyChange: quote.dailyChange ?? 0,
      dailyChangePercent: quote.dailyChangePercent ?? 0,
      currentValue,
      previousValue,
      valueDailyChange: currentValue - previousValue,
      profit,
      profitPercent: invested ? (profit / invested) * 100 : 0,
      allocationPercent: 0,
      priceSource: quote.source,
    };
  });

  holdings.push({
    ticker: "CASH",
    company: "Uninvested cash",
    shares: 1,
    buyPrice: CASH_BALANCE,
    invested: 0,
    fees: 0,
    lots: 1,
    currentPrice: CASH_BALANCE,
    previousPrice: CASH_BALANCE,
    dailyChange: 0,
    dailyChangePercent: 0,
    currentValue: CASH_BALANCE,
    previousValue: CASH_BALANCE,
    valueDailyChange: 0,
    profit: 0,
    profitPercent: 0,
    allocationPercent: 0,
    priceSource: "Cash",
  });

  const totalValue = holdings.reduce((total, holding) => total + holding.currentValue, 0);
  return holdings
    .map((holding) => ({
      ...holding,
      allocationPercent: totalValue ? (holding.currentValue / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.currentValue - a.currentValue);
}
