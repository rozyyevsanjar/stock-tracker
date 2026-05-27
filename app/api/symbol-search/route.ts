import { NextResponse } from "next/server";

const CRYPTO_SUGGESTIONS = [
  { symbol: "BTC-USD", name: "Bitcoin", type: "Crypto", source: "CoinGecko" },
  { symbol: "ETH-USD", name: "Ethereum", type: "Crypto", source: "CoinGecko" },
  { symbol: "SOL-USD", name: "Solana", type: "Crypto", source: "CoinGecko" },
  { symbol: "ADA-USD", name: "Cardano", type: "Crypto", source: "CoinGecko" },
  { symbol: "XRP-USD", name: "XRP", type: "Crypto", source: "CoinGecko" },
  { symbol: "DOGE-USD", name: "Dogecoin", type: "Crypto", source: "CoinGecko" },
];

const FALLBACK_STOCKS = [
  { symbol: "AAPL", name: "Apple Inc.", type: "Equity", source: "Yahoo Finance" },
  { symbol: "MSFT", name: "Microsoft Corporation", type: "Equity", source: "Yahoo Finance" },
  { symbol: "NVDA", name: "NVIDIA Corporation", type: "Equity", source: "Yahoo Finance" },
  { symbol: "TSLA", name: "Tesla, Inc.", type: "Equity", source: "Yahoo Finance" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", type: "Equity", source: "Yahoo Finance" },
  { symbol: "META", name: "Meta Platforms, Inc.", type: "Equity", source: "Yahoo Finance" },
  { symbol: "GOOGL", name: "Alphabet Inc.", type: "Equity", source: "Yahoo Finance" },
  { symbol: "IONQ", name: "IonQ, Inc.", type: "Equity", source: "Yahoo Finance" },
  { symbol: "AAL", name: "American Airlines Group Inc.", type: "Equity", source: "Yahoo Finance" },
];

type Suggestion = {
  symbol: string;
  name: string;
  type: string;
  source: string;
};

function matches(query: string, suggestion: Suggestion) {
  const value = query.toUpperCase();
  return (
    suggestion.symbol.toUpperCase().includes(value) ||
    suggestion.name.toUpperCase().includes(value)
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();

  if (!query) {
    return NextResponse.json({ suggestions: [] });
  }

  const localSuggestions = [...CRYPTO_SUGGESTIONS, ...FALLBACK_STOCKS].filter((item) =>
    matches(query, item),
  );

  try {
    const response = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        next: { revalidate: 300 },
      },
    );

    if (!response.ok) {
      return NextResponse.json({ suggestions: localSuggestions.slice(0, 8) });
    }

    const data = await response.json();
    const yahooSuggestions: Suggestion[] = (data.quotes ?? [])
      .filter((quote: Record<string, unknown>) => typeof quote.symbol === "string")
      .map((quote: Record<string, unknown>) => ({
        symbol: String(quote.symbol),
        name: String(quote.shortname ?? quote.longname ?? quote.symbol),
        type: String(quote.quoteType ?? "Symbol"),
        source: "Yahoo Finance",
      }));

    const unique = new Map<string, Suggestion>();
    for (const suggestion of [...localSuggestions, ...yahooSuggestions]) {
      unique.set(suggestion.symbol, suggestion);
    }

    return NextResponse.json({ suggestions: Array.from(unique.values()).slice(0, 8) });
  } catch {
    return NextResponse.json({ suggestions: localSuggestions.slice(0, 8) });
  }
}
