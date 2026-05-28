"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, formatPercent, signed } from "@/lib/format";
import { assetLogoFallback, assetLogoUrl } from "@/lib/logos";
import type { PricePoint, Quote, ResearchNewsItem, ResearchProfile } from "@/lib/types";

type Timeframe = "1d" | "1w" | "1m" | "1y" | "all";

type Suggestion = {
  symbol: string;
  name: string;
  type: string;
  source: string;
};

type WatchlistItem = {
  addedAt: string;
  symbol: string;
};

type PortfolioExposure = {
  allocationPercent: number;
  company: string;
  currentValue: number;
  dailyChange: number;
  invested: number;
  profit: number;
  profitPercent: number;
  shares: number;
  symbol: string;
  totalPortfolioValue: number;
};

const TIMEFRAMES: Array<{ label: string; value: Timeframe }> = [
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1m" },
  { label: "1Y", value: "1y" },
  { label: "All", value: "all" },
];

const WATCHLIST_KEY = "research-watchlist";

function tone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatResearchDate(value: string, timeframe: Timeframe) {
  const date = new Date(value);
  if (timeframe === "1d") {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (timeframe === "1w") {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  if (timeframe === "1y" || timeframe === "all") {
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDate(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function limitDescription(value: string, maxLength = 520) {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength);
  const lastSentence = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("; "),
    clipped.lastIndexOf(", "),
  );
  return `${clipped.slice(0, lastSentence > 240 ? lastSentence + 1 : maxLength).trim()}...`;
}

function MetricCard({
  label,
  value,
  delta,
  deltaValue = 0,
  help,
  valueTone,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaValue?: number;
  help: string;
  valueTone?: string;
}) {
  return (
    <section className="metric">
      <div className="metricLabel">
        {label}
        <span className="help" title={help}>
          ?
        </span>
      </div>
      <div className={`metricValue ${valueTone ?? ""}`}>{value}</div>
      {delta ? <div className={`metricDelta ${tone(deltaValue)}`}>{delta}</div> : null}
    </section>
  );
}

function readWatchlist() {
  try {
    const saved = window.localStorage.getItem(WATCHLIST_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is WatchlistItem => typeof item?.symbol === "string")
      .map((item) => ({
        addedAt: typeof item.addedAt === "string" ? item.addedAt : new Date().toISOString(),
        symbol: item.symbol.toUpperCase(),
      }));
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchlistItem[]) {
  try {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
  } catch {
    // The watchlist still works for the current page state if storage is unavailable.
  }
}

function LogoImage({
  className,
  fallbackClassName,
  name,
  src,
  symbol,
}: {
  className: string;
  fallbackClassName: string;
  name?: string;
  src?: string;
  symbol: string;
}) {
  const [failed, setFailed] = useState(false);
  const logoSrc = src || assetLogoUrl(symbol, name);

  if (failed || !logoSrc) {
    return <span className={fallbackClassName}>{assetLogoFallback(symbol)}</span>;
  }

  return <img alt="" className={className} onError={() => setFailed(true)} src={logoSrc} />;
}

function WatchlistPanel({
  quote,
  symbol,
  timeframe,
}: {
  quote: Quote | undefined;
  symbol: string;
  timeframe: Timeframe;
}) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);

  useEffect(() => {
    setItems(readWatchlist());
  }, []);

  useEffect(() => {
    if (!items.length) {
      setQuotes({});
      return;
    }

    const controller = new AbortController();
    const symbols = items.map((item) => item.symbol).join(",");
    setIsLoadingQuotes(true);

    fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { quotes: {} }))
      .then((data) => {
        if (!controller.signal.aborted) {
          setQuotes(data.quotes ?? {});
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setQuotes({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingQuotes(false);
      });

    return () => controller.abort();
  }, [items]);

  const isSaved = Boolean(symbol && items.some((item) => item.symbol === symbol));

  function updateItems(nextItems: WatchlistItem[]) {
    setItems(nextItems);
    saveWatchlist(nextItems);
  }

  function addCurrentSymbol() {
    if (!symbol || isSaved) return;
    updateItems([{ addedAt: new Date().toISOString(), symbol }, ...items]);
    if (quote) setQuotes((currentQuotes) => ({ ...currentQuotes, [symbol]: quote }));
  }

  function removeSymbol(symbolToRemove: string) {
    updateItems(items.filter((item) => item.symbol !== symbolToRemove));
  }

  return (
    <section className="watchlistCard">
      <div className="sectionHeader">
        <div>
          <h2>Watchlist</h2>
          <p className="sectionNote">Saved locally in this browser.</p>
        </div>
        {symbol ? (
          <button disabled={isSaved} onClick={addCurrentSymbol} type="button">
            {isSaved ? "Saved" : `Add ${symbol}`}
          </button>
        ) : null}
      </div>

      {items.length ? (
        <div className="watchlistItems">
          {items.map((item) => {
            const isActive = item.symbol === symbol;
            const displayQuote = isActive && quote ? quote : quotes[item.symbol];
            const change = displayQuote?.dailyChange ?? null;
            const percentChange = displayQuote?.dailyChangePercent ?? null;

            return (
              <div className="watchlistItem" key={item.symbol}>
                <a
                  className={isActive ? "active" : ""}
                  href={`/?tab=research&symbol=${encodeURIComponent(item.symbol)}&range=${timeframe}`}
                >
                  <LogoImage
                    className="watchlistLogo"
                    fallbackClassName="watchlistLogoFallback"
                    symbol={item.symbol}
                  />
                  <strong>{item.symbol}</strong>
                  <span className="watchlistQuote">
                    <b>
                      {displayQuote?.price === null || displayQuote?.price === undefined
                        ? isLoadingQuotes ? "Loading..." : "Open chart"
                        : formatMoney(displayQuote.price)}
                    </b>
                    <small>{displayQuote?.source ?? "Research"}</small>
                  </span>
                  <span className="watchlistChange">
                    {change !== null ? (
                      <>
                        <em className={tone(change)}>{signed(change, formatMoney)}</em>
                        <small className={tone(change)}>
                          {percentChange === null ? "-" : signed(percentChange, formatPercent)}
                        </small>
                      </>
                    ) : (
                      <em>-</em>
                    )}
                  </span>
                </a>
                <button
                  aria-label={`Remove ${item.symbol} from watchlist`}
                  onClick={() => removeSymbol(item.symbol)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Search a symbol, then add it here for quick access.</p>
      )}
    </section>
  );
}

function ResearchSearch({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }) {
  const [query, setQuery] = useState(symbol);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  function updateQuery(value: string) {
    setQuery(value);
    setIsFocused(true);
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/symbol-search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <section>
      <form className="researchSearch" action="/">
        <input name="tab" type="hidden" value="research" />
        <input name="range" type="hidden" value={timeframe} />
        <label htmlFor="symbol">Search symbol</label>
        <div className="researchInputWrap">
          <input
            autoComplete="off"
            id="symbol"
            name="symbol"
            onBlur={() => window.setTimeout(() => setIsFocused(false), 140)}
            onChange={(event) => updateQuery(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onInput={(event) => updateQuery(event.currentTarget.value)}
            placeholder="AAPL, TSLA, BTC, ETH-USD"
            value={query}
          />
          <button type="submit">Search</button>
          {isFocused && suggestions.length ? (
            <div className="suggestionMenu">
              {suggestions.map((suggestion) => (
                <a
                  href={`/?tab=research&symbol=${encodeURIComponent(suggestion.symbol)}&range=${timeframe}`}
                  key={`${suggestion.symbol}-${suggestion.source}`}
                >
                  <LogoImage
                    className="suggestionLogo"
                    fallbackClassName="suggestionLogoFallback"
                    name={suggestion.name}
                    symbol={suggestion.symbol}
                  />
                  <strong>{suggestion.symbol}</strong>
                  <span>{suggestion.name}</span>
                  <em>{suggestion.type}</em>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function ResearchPriceChart({
  points,
  symbol,
  timeframe,
}: {
  points: PricePoint[];
  symbol: string;
  timeframe: Timeframe;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (!points.length) return null;

    const width = 760;
    const height = 320;
    const padding = { top: 24, right: 22, bottom: 44, left: 70 };
    const prices = points.map((point) => point.price);
    const minPrice = Math.min(...prices) * 0.98;
    const maxPrice = Math.max(...prices) * 1.02;
    const x = (index: number) =>
      padding.left +
      (index / Math.max(points.length - 1, 1)) *
        (width - padding.left - padding.right);
    const y = (price: number) =>
      height -
      padding.bottom -
      ((price - minPrice) / (maxPrice - minPrice || 1)) *
        (height - padding.top - padding.bottom);
    const path = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.price)}`)
      .join(" ");
    const yTicks = Array.from({ length: 5 }, (_, index) => {
      const value = minPrice + ((maxPrice - minPrice) / 4) * index;
      return { value, y: y(value) };
    });
    const xTickIndexes = Array.from(
      new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
    );

    return { height, padding, path, width, x, xTickIndexes, y, yTicks };
  }, [points]);

  function setActiveFromPointer(clientX: number) {
    if (!chart || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const viewBoxX = ((clientX - rect.left) / rect.width) * chart.width;
    const plotWidth = chart.width - chart.padding.left - chart.padding.right;
    const ratio = Math.min(
      1,
      Math.max(0, (viewBoxX - chart.padding.left) / Math.max(plotWidth, 1)),
    );
    setActiveIndex(Math.round(ratio * Math.max(points.length - 1, 0)));
  }

  if (!points.length || !chart) {
    return (
      <div className="chartShell researchChartShell">
        <p className="muted">No price history found for this symbol.</p>
      </div>
    );
  }

  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeX = activeIndex === null ? null : chart.x(activeIndex);
  const activeY = activePoint ? chart.y(activePoint.price) : null;

  return (
    <div className="chartShell researchChartShell">
      <svg
        aria-label={`${symbol} price chart`}
        onMouseLeave={() => setActiveIndex(null)}
        onMouseMove={(event) => setActiveFromPointer(event.clientX)}
        onTouchMove={(event) => setActiveFromPointer(event.touches[0]?.clientX ?? 0)}
        className="researchChart"
        ref={svgRef}
        role="img"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
      >
        {chart.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={chart.padding.left}
              y1={tick.y}
              x2={chart.width - chart.padding.right}
              y2={tick.y}
              className="gridLine"
            />
            <text x={chart.padding.left - 10} y={tick.y + 4} className="axisLabel" textAnchor="end">
              {formatMoney(tick.value)}
            </text>
          </g>
        ))}
        {chart.xTickIndexes.map((index) => (
          <text
            className="axisLabel"
            key={points[index].date}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            x={chart.x(index)}
            y={chart.height - 12}
          >
            {formatResearchDate(points[index].date, timeframe)}
          </text>
        ))}
        <line
          x1={chart.padding.left}
          y1={chart.padding.top}
          x2={chart.padding.left}
          y2={chart.height - chart.padding.bottom}
          className="axis"
        />
        <line
          x1={chart.padding.left}
          y1={chart.height - chart.padding.bottom}
          x2={chart.width - chart.padding.right}
          y2={chart.height - chart.padding.bottom}
          className="axis"
        />
        <path d={chart.path} className="valueLine" />
        {activePoint && activeX !== null && activeY !== null ? (
          <g className="activePoint">
            <line
              x1={activeX}
              y1={chart.padding.top}
              x2={activeX}
              y2={chart.height - chart.padding.bottom}
              className="hoverGuide visible"
            />
            <circle cx={activeX} cy={activeY} r="5" className="valueDot visible" />
          </g>
        ) : null}
      </svg>
      {activePoint && activeX !== null && activeY !== null ? (
        <div
          className="chartTooltip researchTooltip"
          style={{
            left: `${(activeX / chart.width) * 100}%`,
            top: `${(activeY / chart.height) * 100}%`,
          }}
        >
          <strong>{formatResearchDate(activePoint.date, timeframe)}</strong>
          <span>Price: {formatMoney(activePoint.price)}</span>
        </div>
      ) : null}
      <div className="chartLegend">
        <span><i className="legendValue" /> {symbol} price</span>
      </div>
    </div>
  );
}

function ResearchProfilePanel({ profile }: { profile: ResearchProfile | null }) {
  const fundamentals = profile?.fundamentals;

  return (
    <section className="profileCard">
      <div className="sectionHeader">
        <div className="profileTitle">
          <LogoImage
            className="profileLogo"
            fallbackClassName="profileLogoFallback"
            name={profile?.name}
            src={profile?.logoUrl}
            symbol={profile?.symbol ?? "?"}
          />
          <div>
            <h2>{profile?.name ?? "Asset profile"}</h2>
            <p className="sectionNote">{profile?.source ?? "Profile source unavailable"}</p>
          </div>
        </div>
        {profile?.sourceUrl ? (
          <a className="sourceLink" href={profile.sourceUrl} rel="noreferrer" target="_blank">
            Source
          </a>
        ) : null}
      </div>

      <p className="profileDescription">
        {limitDescription(profile?.description ?? "No description found for this symbol yet.")}
      </p>

      {profile?.sector || profile?.industry || profile?.website ? (
        <div className="profileMeta">
          {profile.sector ? (
            <span>
              Sector <strong>{profile.sector}</strong>
            </span>
          ) : null}
          {profile.industry ? (
            <span>
              Industry <strong>{profile.industry}</strong>
            </span>
          ) : null}
          {profile.website ? (
            <a href={profile.website} rel="noreferrer" target="_blank">
              Website
            </a>
          ) : null}
        </div>
      ) : null}

      {fundamentals?.earnings || fundamentals?.dividend ? (
        <div className="fundamentalsGrid">
          {fundamentals.earnings ? (
            <div className="fundamentalCard">
              <h3>Earnings</h3>
              <dl>
                <div>
                  <dt>Last report</dt>
                  <dd>{formatDate(fundamentals.earnings.lastReportDate ?? "") || "-"}</dd>
                </div>
                <div>
                  <dt>Next estimate</dt>
                  <dd>{formatDate(fundamentals.earnings.nextReportDateEstimate ?? "") || "-"}</dd>
                </div>
                <div>
                  <dt>EPS</dt>
                  <dd>{fundamentals.earnings.eps || "-"}</dd>
                </div>
                <div>
                  <dt>Surprise</dt>
                  <dd>{fundamentals.earnings.surprise || "-"}</dd>
                </div>
              </dl>
              <a href={fundamentals.earnings.sourceUrl} rel="noreferrer" target="_blank">
                {fundamentals.earnings.source}
              </a>
            </div>
          ) : null}

          {fundamentals.dividend ? (
            <div className="fundamentalCard">
              <h3>Dividend</h3>
              <dl>
                <div>
                  <dt>Ex-dividend</dt>
                  <dd>{formatDate(fundamentals.dividend.exDividendDate ?? "") || "-"}</dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd>{formatDate(fundamentals.dividend.paymentDate ?? "") || "-"}</dd>
                </div>
                <div>
                  <dt>Latest</dt>
                  <dd>{fundamentals.dividend.latestAmount || "-"}</dd>
                </div>
                <div>
                  <dt>Yield</dt>
                  <dd>{fundamentals.dividend.yield || "-"}</dd>
                </div>
              </dl>
              <a href={fundamentals.dividend.sourceUrl} rel="noreferrer" target="_blank">
                {fundamentals.dividend.source}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ResearchNewsPanel({ news }: { news: ResearchNewsItem[] }) {
  return (
    <section className="newsCard">
      <div className="sectionHeader">
        <div>
          <h2>Relevant news</h2>
          <p className="sectionNote">Latest related headlines from Yahoo Finance.</p>
        </div>
      </div>

      {news.length ? (
        <div className="newsList">
          {news.map((item) => (
            <a className="newsItem" href={item.url} key={item.url} rel="noreferrer" target="_blank">
              {item.thumbnail ? <img alt="" src={item.thumbnail} /> : null}
              <span>
                <strong>{item.title}</strong>
                <em>
                  {item.publisher}
                  {item.publishedAt ? ` · ${formatDate(item.publishedAt)}` : ""}
                </em>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="muted">No recent related headlines found for this symbol.</p>
      )}
    </section>
  );
}

function PortfolioExposurePanel({
  exposure,
  symbol,
}: {
  exposure: PortfolioExposure | null;
  symbol: string;
}) {
  return (
    <section className="exposureCard">
      <div className="sectionHeader">
        <div>
          <h2>Portfolio exposure</h2>
          <p className="sectionNote">How this searched asset connects to your current portfolio.</p>
        </div>
        <span className="statusPill">Decision intelligence</span>
      </div>

      {exposure ? (
        <>
          <p className="exposureSummary">
            You currently hold <strong>{formatPercent(exposure.allocationPercent, 1)}</strong>{" "}
            {exposure.symbol} exposure.
          </p>
          <div className="exposureGrid">
            <div>
              <span>Position value</span>
              <strong>{formatMoney(exposure.currentValue)}</strong>
            </div>
            <div>
              <span>Shares / units</span>
              <strong>{exposure.shares.toLocaleString("en-US", { maximumFractionDigits: 8 })}</strong>
            </div>
            <div>
              <span>Invested</span>
              <strong>{formatMoney(exposure.invested)}</strong>
            </div>
            <div>
              <span>P/L</span>
              <strong className={tone(exposure.profit)}>
                {formatMoney(exposure.profit)} ({formatPercent(exposure.profitPercent)})
              </strong>
            </div>
          </div>
          <p className="exposureNote">
            Adding to this asset would increase your {exposure.symbol} concentration above{" "}
            {formatPercent(exposure.allocationPercent, 1)} of the portfolio.
          </p>
        </>
      ) : (
        <p className="exposureSummary">
          You do not currently hold <strong>{symbol}</strong> in this portfolio.
        </p>
      )}
    </section>
  );
}

export function ResearchView({
  exposure,
  history,
  news,
  profile,
  quote,
  symbol,
  timeframe,
}: {
  exposure: PortfolioExposure | null;
  history: PricePoint[];
  news: ResearchNewsItem[];
  profile: ResearchProfile | null;
  quote: Quote | undefined;
  symbol: string;
  timeframe: Timeframe;
}) {
  const latest = quote?.price ?? null;
  const dailyChange = quote?.dailyChange ?? 0;
  const dailyChangePercent = quote?.dailyChangePercent ?? 0;

  return (
    <>
      <ResearchSearch symbol={symbol} timeframe={timeframe} />
      <WatchlistPanel quote={quote} symbol={symbol} timeframe={timeframe} />

      {symbol ? (
        <>
          <section className="metricsGrid">
            <MetricCard
              label="Symbol"
              value={symbol}
              help="For supported crypto, BTC/ETH/SOL/ADA/XRP/DOGE are normalized to -USD pairs."
            />
            <MetricCard
              label="Current price"
              value={latest === null ? "Unavailable" : formatMoney(latest)}
              help={`Latest quote source: ${quote?.source ?? "Unavailable"}.`}
            />
            <MetricCard
              label="Daily change"
              value={signed(dailyChange, formatMoney)}
              valueTone={tone(dailyChange)}
              delta={`${formatPercent(Math.abs(dailyChangePercent))} today`}
              deltaValue={dailyChange}
              help="Latest daily change from Yahoo Finance for stocks or CoinGecko for supported crypto."
            />
            <MetricCard
              label="Data source"
              value={quote?.source ?? "Unavailable"}
              help="Stocks use Yahoo Finance. Supported crypto uses CoinGecko."
            />
          </section>

          <PortfolioExposurePanel exposure={exposure} symbol={symbol} />

          <section>
            <div className="sectionHeader">
              <div>
                <h2>{symbol} research chart</h2>
                <p className="sectionNote">
                  Price history from Yahoo Finance for stocks and CoinGecko for supported crypto.
                </p>
              </div>
              <nav className="timeframeNav" aria-label="Research timeframe">
                {TIMEFRAMES.map((item) => (
                  <a
                    className={item.value === timeframe ? "active" : ""}
                    href={`/?tab=research&symbol=${encodeURIComponent(symbol)}&range=${item.value}`}
                    key={item.value}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
            <ResearchPriceChart points={history} symbol={symbol} timeframe={timeframe} />
          </section>

          <div className="researchInfoGrid">
            <ResearchProfilePanel profile={profile} />
            <ResearchNewsPanel news={news} />
          </div>
        </>
      ) : (
        <section>
          <h2>Start researching</h2>
          <p className="sectionNote">
            Search for a stock ticker like AAPL or TSLA. For supported crypto, use BTC,
            ETH, SOL, ADA, XRP, DOGE, or the -USD pair.
          </p>
        </section>
      )}
    </>
  );
}
