import type {
  Lot,
  PerformancePoint,
  PricePoint,
  Quote,
  ResearchNewsItem,
  ResearchProfile,
} from "./types";
import { parsePurchaseDate } from "./portfolio";
import { assetLogoUrl } from "./logos";

export type Timeframe = "1d" | "1w" | "1m" | "1y" | "all";

export const TIMEFRAMES: Array<{ label: string; value: Timeframe }> = [
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1m" },
  { label: "1Y", value: "1y" },
  { label: "All", value: "all" },
];

const YAHOO_HISTORY: Record<Timeframe, { range: string; interval: string }> = {
  "1d": { range: "1d", interval: "5m" },
  "1w": { range: "5d", interval: "1h" },
  "1m": { range: "1mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  all: { range: "1y", interval: "1d" },
};

const COINGECKO_HISTORY: Record<Timeframe, { days: string; interval?: string }> = {
  "1d": { days: "1" },
  "1w": { days: "7" },
  "1m": { days: "30" },
  "1y": { days: "365", interval: "daily" },
  all: { days: "max" },
};

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
};

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

const ANALYSIS_NEWS_PATTERN =
  /\b(analyst|analysts|rating|ratings|price target|downgrade|upgrade|valuation|fair value|technical analysis|zacks rank|should you buy|buy sell or hold|is .+ a buy|stock to buy|stocks to buy)\b/i;

const WEAK_ASSOCIATION_PATTERN = /\b(former apple|jony ive)\b/i;

const ANALYSIS_PUBLISHERS = [
  "zacks",
  "motley fool",
  "simply wall st",
  "seeking alpha",
  "tipranks",
  "gurufocus",
  "marketbeat",
];

const COMPANY_NAME_STOP_WORDS = new Set([
  "inc",
  "inc.",
  "corp",
  "corp.",
  "corporation",
  "company",
  "co",
  "co.",
  "ltd",
  "ltd.",
  "plc",
  "class",
  "ordinary",
  "common",
  "stock",
]);

type NewsCandidate = ResearchNewsItem & {
  summary?: string;
};

const nasdaqHeaders = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

function isCryptoTicker(ticker: string) {
  const base = ticker.split("-")[0];
  return ticker.endsWith("-USD") && Boolean(CRYPTO_IDS[base]);
}

function cryptoIdForTicker(ticker: string) {
  return CRYPTO_IDS[ticker.split("-")[0]];
}

function quoteFromPrices(
  price: number | null,
  previousPrice: number | null,
  source: string,
): Quote {
  if (price === null) {
    return {
      price: null,
      previousPrice: null,
      dailyChange: null,
      dailyChangePercent: null,
      source,
    };
  }

  const dailyChange = previousPrice ? price - previousPrice : null;
  return {
    price,
    previousPrice,
    dailyChange,
    dailyChangePercent:
      dailyChange !== null && previousPrice ? (dailyChange / previousPrice) * 100 : null,
    source,
  };
}

function cleanHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPublishedAt(timestamp: unknown) {
  return typeof timestamp === "number" ? new Date(timestamp * 1000).toISOString() : "";
}

function formatDateString(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

function estimateNextQuarterDate(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  const date = new Date(timestamp);
  date.setMonth(date.getMonth() + 3);
  return date.toISOString();
}

function relevanceKeywords(symbol: string, name: string) {
  const symbolBase = symbol.split("-")[0].toLowerCase();
  const nameWords = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !COMPANY_NAME_STOP_WORDS.has(word));

  return Array.from(new Set([symbolBase, ...nameWords]));
}

function scoreNewsItem(item: NewsCandidate, symbol: string, name: string) {
  const title = item.title.toLowerCase();
  const summary = (item.summary ?? "").toLowerCase();
  const publisher = item.publisher.toLowerCase();
  const keywords = relevanceKeywords(symbol, name);
  let score = 0;

  for (const keyword of keywords) {
    const symbolBase = symbol.split("-")[0].toLowerCase();
    if (title.includes(keyword)) score += keyword === symbolBase ? 5 : 4;
    if (summary.includes(`${keyword}'s`) || summary.includes(`${keyword}’s`)) score += 3;
    else if (summary.includes(keyword)) score += 2;
  }

  if (item.thumbnail) score += 1;
  if (item.publishedAt) score += 1;
  if (ANALYSIS_NEWS_PATTERN.test(item.title)) score -= 8;
  if (WEAK_ASSOCIATION_PATTERN.test(`${item.title} ${item.summary ?? ""}`)) score -= 4;
  if (ANALYSIS_PUBLISHERS.some((analysisPublisher) => publisher.includes(analysisPublisher))) {
    score -= 8;
  }

  return score;
}

function rankNewsItems(items: NewsCandidate[], context: { symbol: string; name: string }) {
  const scoredItems = items.map((item) => ({
    item,
    score: scoreNewsItem(item, context.symbol, context.name),
  }));
  const strictItems = scoredItems.filter(({ score }) => score >= 4);
  const fallbackItems = scoredItems.filter(
    ({ item, score }) =>
      score > -6 &&
      !ANALYSIS_NEWS_PATTERN.test(item.title) &&
      !ANALYSIS_PUBLISHERS.some((publisher) =>
        item.publisher.toLowerCase().includes(publisher),
      ),
  );

  return (strictItems.length ? strictItems : fallbackItems)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => {
      const { summary: _summary, ...publicItem } = item;
      return publicItem;
    })
    .slice(0, 6);
}

function yahooNewsToItems(
  news: Array<Record<string, unknown>> = [],
  context?: { symbol: string; name: string },
): NewsCandidate[] {
  const items = news
    .filter((item) => typeof item.title === "string" && typeof item.link === "string")
    .map((item) => {
      const thumbnail = Array.isArray((item.thumbnail as Record<string, unknown> | undefined)?.resolutions)
        ? ((item.thumbnail as { resolutions?: Array<{ url?: string }> }).resolutions ?? [])[0]?.url
        : undefined;

      return {
        title: String(item.title),
        publisher: String(item.publisher ?? "Yahoo Finance"),
        url: String(item.link),
        publishedAt: formatPublishedAt(item.providerPublishTime),
        thumbnail,
        summary: typeof item.summary === "string" ? item.summary : undefined,
      };
    });

  if (!context) return items.slice(0, 6);

  return rankNewsItems(items, context);
}

async function fetchYahooSearchData(query: string, newsCount = 6) {
  try {
    const response = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=4&newsCount=${newsCount}`,
      { headers, next: { revalidate: 900 } },
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function publisherFromUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.replace(/^finance\./, "").split(".")[0] || "Yahoo Finance";
  } catch {
    return "Yahoo Finance";
  }
}

async function fetchYahooRssNews(symbol: string): Promise<NewsCandidate[]> {
  try {
    const response = await fetch(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,
      { headers, next: { revalidate: 900 } },
    );
    if (!response.ok) return [];
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

    return items
      .map((item): NewsCandidate | null => {
        const title = xmlTag(item, "title");
        const url = xmlTag(item, "link");
        if (!title || !url) return null;

        return {
          title,
          publisher: publisherFromUrl(url),
          url,
          publishedAt: formatDateString(xmlTag(item, "pubDate")),
          summary: cleanHtml(xmlTag(item, "description")),
        };
      })
      .filter((item): item is NewsCandidate => Boolean(item));
  } catch {
    return [];
  }
}

function uniqueNews(items: NewsCandidate[]) {
  const byUrl = new Map<string, NewsCandidate>();
  for (const item of items) {
    byUrl.set(item.url, item);
  }
  return Array.from(byUrl.values());
}

async function fetchNasdaqEarnings(symbol: string) {
  try {
    const response = await fetch(
      `https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/earnings-surprise`,
      { headers: nasdaqHeaders, next: { revalidate: 3600 } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const row = data.data?.earningsSurpriseTable?.rows?.[0];
    if (!row?.dateReported) return null;

    return {
      consensusForecast: String(row.consensusForecast ?? ""),
      eps: String(row.eps ?? ""),
      fiscalQuarter: String(row.fiscalQtrEnd ?? ""),
      lastReportDate: formatDateString(String(row.dateReported ?? "")),
      nextReportDateEstimate: estimateNextQuarterDate(String(row.dateReported ?? "")),
      source: "Nasdaq",
      sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}/earnings`,
      surprise: row.percentageSurprise ? `${row.percentageSurprise}%` : "",
    };
  } catch {
    return null;
  }
}

async function fetchNasdaqDividend(symbol: string) {
  try {
    const response = await fetch(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/dividends?assetclass=stocks`,
      { headers: nasdaqHeaders, next: { revalidate: 3600 } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const dividend = data.data;
    const latest = dividend?.dividends?.rows?.[0];
    if (!dividend || (!dividend.exDividendDate && !latest?.amount)) return null;

    return {
      annualDividend: dividend.annualizedDividend
        ? `$${dividend.annualizedDividend}`
        : undefined,
      exDividendDate: formatDateString(String(dividend.exDividendDate ?? "")),
      latestAmount: latest?.amount ? String(latest.amount) : undefined,
      paymentDate: formatDateString(String(dividend.dividendPaymentDate ?? "")),
      source: "Nasdaq",
      sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}/dividend-history`,
      yield: dividend.yield ? String(dividend.yield) : undefined,
    };
  } catch {
    return null;
  }
}

async function fetchStockFundamentals(symbol: string) {
  const [earnings, dividend] = await Promise.all([
    fetchNasdaqEarnings(symbol),
    fetchNasdaqDividend(symbol),
  ]);

  return {
    dividend: dividend ?? undefined,
    earnings: earnings ?? undefined,
  };
}

async function fetchWikipediaSummary(title: string) {
  try {
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers, next: { revalidate: 86400 } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const description = typeof data.extract === "string" ? data.extract : "";
    if (!description) return null;
    return {
      description,
      sourceUrl:
        typeof data.content_urls?.desktop?.page === "string"
          ? data.content_urls.desktop.page
          : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return null;
  }
}

async function fetchStockResearch(symbol: string) {
  const data = await fetchYahooSearchData(symbol, 0);
  const quotes: Array<Record<string, unknown>> = data?.quotes ?? [];
  const quote =
    quotes.find((item) => item.symbol === symbol) ??
    quotes.find((item) => typeof item.symbol === "string");
  const name = String(quote?.longname ?? quote?.shortname ?? symbol);
  const [rssNews, newsData, fundamentals] = await Promise.all([
    fetchYahooRssNews(symbol),
    fetchYahooSearchData(name, 16),
    fetchStockFundamentals(symbol),
  ]);
  const wikipedia = await fetchWikipediaSummary(name);

  const profile: ResearchProfile = {
    symbol,
    name,
    description:
      wikipedia?.description ??
      "Description unavailable from the current data sources. The quote metadata and latest news are still shown below.",
    fundamentals,
    logoUrl: assetLogoUrl(symbol, name),
    source: wikipedia ? "Wikipedia + Yahoo Finance" : "Yahoo Finance",
    sourceUrl: wikipedia?.sourceUrl ?? `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    sector: typeof quote?.sector === "string" ? quote.sector : undefined,
    industry: typeof quote?.industry === "string" ? quote.industry : undefined,
  };

  return {
    profile,
    news: rankNewsItems(
      uniqueNews([...rssNews, ...yahooNewsToItems(newsData?.news ?? [])]),
      { symbol, name },
    ),
  };
}

async function fetchCryptoResearch(symbol: string) {
  const coinId = cryptoIdForTicker(symbol);
  const fallbackName = symbol.split("-")[0];
  let profile: ResearchProfile = {
    symbol,
    name: fallbackName,
    description: "Description unavailable from CoinGecko right now.",
    source: "CoinGecko",
    sourceUrl: `https://www.coingecko.com/en/coins/${coinId ?? fallbackName.toLowerCase()}`,
  };

  try {
    if (coinId) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
        { next: { revalidate: 3600 } },
      );
      if (response.ok) {
        const data = await response.json();
        const description = cleanHtml(String(data.description?.en ?? ""));
        profile = {
          symbol,
          name: String(data.name ?? fallbackName),
          description: description || profile.description,
          logoUrl: typeof data.image?.large === "string" ? data.image.large : undefined,
          source: "CoinGecko",
          sourceUrl:
            typeof data.links?.homepage?.[0] === "string" && data.links.homepage[0]
              ? data.links.homepage[0]
              : profile.sourceUrl,
          website:
            typeof data.links?.homepage?.[0] === "string" && data.links.homepage[0]
              ? data.links.homepage[0]
              : undefined,
        };
      }
    }
  } catch {
    // Keep the fallback profile.
  }

  const [rssNews, newsData] = await Promise.all([
    fetchYahooRssNews(symbol),
    fetchYahooSearchData(profile.name || symbol, 16),
  ]);

  return {
    profile,
    news: rankNewsItems(
      uniqueNews([...rssNews, ...yahooNewsToItems(newsData?.news ?? [])]),
      { symbol, name: profile.name },
    ),
  };
}

export async function fetchResearchOverview(symbol: string): Promise<{
  profile: ResearchProfile | null;
  news: ResearchNewsItem[];
}> {
  if (!symbol) return { profile: null, news: [] };
  return isCryptoTicker(symbol) ? fetchCryptoResearch(symbol) : fetchStockResearch(symbol);
}

async function fetchYahooQuote(ticker: string): Promise<Quote | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`,
      { headers, next: { revalidate: 900 } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const closes: Array<number | null> =
      data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const prices = closes.filter((value): value is number => typeof value === "number");
    if (!prices.length) return null;
    return quoteFromPrices(
      prices[prices.length - 1],
      prices.length > 1 ? prices[prices.length - 2] : null,
      "Yahoo Finance",
    );
  } catch {
    return null;
  }
}

async function fetchCoinGeckoQuote(ticker: string): Promise<Quote | null> {
  try {
    const coinId = CRYPTO_IDS[ticker.split("-")[0]];
    if (!coinId) return null;

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`,
      { next: { revalidate: 900 } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const price = data[coinId]?.usd;
    const changePercent = data[coinId]?.usd_24h_change;
    if (typeof price !== "number") return null;
    const previousPrice =
      typeof changePercent === "number" ? price / (1 + changePercent / 100) : null;
    return quoteFromPrices(price, previousPrice, "CoinGecko");
  } catch {
    return null;
  }
}

export async function fetchQuotes(tickers: string[]) {
  const uniqueTickers = Array.from(new Set(tickers));
  const entries = await Promise.all(
    uniqueTickers.map(async (ticker) => {
      const quote = isCryptoTicker(ticker)
        ? await fetchCoinGeckoQuote(ticker)
        : await fetchYahooQuote(ticker);
      return [ticker, quote ?? quoteFromPrices(null, null, "Unavailable")] as const;
    }),
  );

  return Object.fromEntries(entries);
}

function formatPointDate(timestamp: number, timeframe: Timeframe) {
  const date = new Date(timestamp);
  return timeframe === "1d" || timeframe === "1w"
    ? date.toISOString()
    : date.toISOString().slice(0, 10);
}

function historyStartSeconds(startDate: Date) {
  return Math.floor(startDate.getTime() / 1000);
}

function historyEndSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function fetchYahooHistory(
  ticker: string,
  timeframe: Timeframe,
  startDate?: Date,
): Promise<PricePoint[]> {
  try {
    const config = YAHOO_HISTORY[timeframe];
    const query =
      timeframe === "all" && startDate
        ? `period1=${historyStartSeconds(startDate)}&period2=${historyEndSeconds()}&interval=1d`
        : `range=${config.range}&interval=${config.interval}`;
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?${query}`,
      { headers, next: { revalidate: 3600 } },
    );
    if (!response.ok) return [];
    const data = await response.json();
    const timestamps: number[] = data.chart?.result?.[0]?.timestamp ?? [];
    const closes: Array<number | null> =
      data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];

    return timestamps
      .map((timestamp, index) => ({
        date: formatPointDate(timestamp * 1000, timeframe),
        price: closes[index],
        ticker,
      }))
      .filter((point): point is PricePoint => typeof point.price === "number");
  } catch {
    return [];
  }
}

async function fetchCoinGeckoHistory(
  ticker: string,
  timeframe: Timeframe,
  startDate?: Date,
): Promise<PricePoint[]> {
  try {
    const coinId = CRYPTO_IDS[ticker.split("-")[0]];
    if (!coinId) return [];
    const config = COINGECKO_HISTORY[timeframe];
    const interval = config.interval ? `&interval=${config.interval}` : "";
    const url =
      timeframe === "all" && startDate
        ? `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${historyStartSeconds(startDate)}&to=${historyEndSeconds()}`
        : `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${config.days}${interval}`;

    const response = await fetch(url, { next: { revalidate: 3600 } });
    if (!response.ok) return [];
    const data = await response.json();
    const prices: Array<[number, number]> = data.prices ?? [];

    const byDate = new Map<string, PricePoint>();
    for (const [timestamp, price] of prices) {
      const pointDate = formatPointDate(timestamp, timeframe);
      byDate.set(pointDate, {
        date: pointDate,
        price,
        ticker,
      });
    }
    return Array.from(byDate.values());
  } catch {
    return [];
  }
}

export async function fetchPriceHistory(
  tickers: string[],
  timeframe: Timeframe,
  startDate?: Date,
) {
  const uniqueTickers = Array.from(new Set(tickers));
  const chunks = await Promise.all(
    uniqueTickers.map((ticker) =>
      isCryptoTicker(ticker)
        ? fetchCoinGeckoHistory(ticker, timeframe, startDate)
        : fetchYahooHistory(ticker, timeframe, startDate),
    ),
  );
  return chunks.flat();
}

export function buildPerformance(history: PricePoint[], lots: Lot[]): PerformancePoint[] {
  const tickers = Array.from(new Set(lots.map((lot) => lot.ticker)));
  const dates = Array.from(new Set(history.map((point) => point.date))).sort();
  const pointsByDate = new Map<string, PricePoint[]>();

  for (const point of history) {
    const pointsForDate = pointsByDate.get(point.date) ?? [];
    pointsForDate.push(point);
    pointsByDate.set(point.date, pointsForDate);
  }

  const sortedLots = lots.map((lot) => ({
    ...lot,
    parsedDate: parsePurchaseDate(lot.purchaseDate),
    invested: lot.shares * lot.buyPrice + lot.fees,
  }));

  const points: PerformancePoint[] = [];
  const latestPrices = new Map<string, number>();

  for (const date of dates) {
    for (const point of pointsByDate.get(date) ?? []) {
      latestPrices.set(point.ticker, point.price);
    }

    const currentDate = new Date(date.includes("T") ? date : `${date}T00:00:00.000Z`);
    const activeLots = sortedLots.filter((lot) => {
      const purchaseDate = lot.parsedDate;
      return !purchaseDate || purchaseDate <= currentDate;
    });
    if (!activeLots.length) continue;

    let invested = 0;
    let marketValue = 0;
    let missingPrice = false;

    for (const ticker of tickers) {
      const tickerLots = activeLots.filter((lot) => lot.ticker === ticker);
      if (!tickerLots.length) continue;
      const price = latestPrices.get(ticker);
      if (price === undefined) {
        missingPrice = true;
        break;
      }
      const shares = tickerLots.reduce((total, lot) => total + lot.shares, 0);
      invested += tickerLots.reduce((total, lot) => total + lot.invested, 0);
      marketValue += shares * price;
    }

    if (missingPrice || !invested) continue;
    const profit = marketValue - invested;
    points.push({
      date,
      marketValue,
      invested,
      profit,
      returnPercent: (profit / invested) * 100,
    });
  }

  return points;
}
