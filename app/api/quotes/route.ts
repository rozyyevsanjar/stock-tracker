import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/market";

const CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE"]);

function normalizeSymbol(value: string) {
  const symbol = value.trim().toUpperCase();
  if (!symbol) return "";
  if (symbol.endsWith("-USD")) return symbol;
  return CRYPTO_SYMBOLS.has(symbol) ? `${symbol}-USD` : symbol;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = (searchParams.get("symbols") ?? "")
    .split(",")
    .map(normalizeSymbol)
    .filter(Boolean);

  if (!symbols.length) {
    return NextResponse.json({ quotes: {} });
  }

  const uniqueSymbols = Array.from(new Set(symbols)).slice(0, 30);
  const quotes = await fetchQuotes(uniqueSymbols);

  return NextResponse.json({ quotes });
}
