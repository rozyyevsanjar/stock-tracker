const ASSET_LOGO_DOMAINS: Record<string, string> = {
  AAL: "aa.com",
  AAPL: "apple.com",
  ADA: "cardano.org",
  "ADA-USD": "cardano.org",
  AMZN: "amazon.com",
  BTC: "bitcoin.org",
  "BTC-USD": "bitcoin.org",
  DOGE: "dogecoin.com",
  "DOGE-USD": "dogecoin.com",
  ETH: "ethereum.org",
  "ETH-USD": "ethereum.org",
  GOOG: "google.com",
  GOOGL: "google.com",
  IONQ: "ionq.com",
  META: "meta.com",
  NVDA: "nvidia.com",
  ORCL: "oracle.com",
  SOL: "solana.com",
  "SOL-USD": "solana.com",
  TSLA: "tesla.com",
  XRP: "xrpl.org",
  "XRP-USD": "xrpl.org",
};

export function normalizedLogoSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

export function assetLogoFallback(symbol: string) {
  const normalized = normalizedLogoSymbol(symbol);
  const base = normalized.split("-")[0];
  return (base || "?").slice(0, 2);
}

export function assetLogoUrl(symbol: string, name = symbol) {
  const normalized = normalizedLogoSymbol(symbol);
  const base = normalized.split("-")[0];
  const domain = ASSET_LOGO_DOMAINS[normalized] ?? ASSET_LOGO_DOMAINS[base];

  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  }

  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    name || base || normalized || "?",
  )}&background=1d6fd7&color=fff&bold=true`;
}
