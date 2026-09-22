import { CASH_BALANCE, aggregateLots, loadLots, parsePurchaseDate } from "@/lib/portfolio";
import {
  TIMEFRAMES,
  type Timeframe,
  buildPerformance,
  fetchPriceHistory,
  fetchQuotes,
  fetchResearchOverview,
} from "@/lib/market";
import { formatCurrency, formatMoney, formatPercent, formatShares, signed } from "@/lib/format";
import { buildTransactionLots, cashImpact, loadTransactions } from "@/lib/transactions";
import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
  buildTrackedPositions,
  combineStakingEthPositions,
  convertTrackedPositions,
  fetchCurrencyRates,
  fetchDubaiMetalPrices,
  loadTrackerPositions,
} from "@/lib/tracker";
import { assetLogoFallback, assetLogoUrl } from "@/lib/logos";
import type {
  Holding,
  Lot,
  PerformancePoint,
  PricePoint,
  Quote,
  ResearchNewsItem,
  ResearchProfile,
  TrackerPosition,
  TrackedPosition,
  TransactionLot,
} from "@/lib/types";
import { MarketStatus } from "./market-status";
import { PerformanceChart } from "./performance-chart";
import { ResearchView } from "./research-tools";
import { ThemeToggle } from "./theme-toggle";
import { CloseLotForm } from "./close-lot-form";
import { TransactionEditForm } from "./transaction-edit-form";
import { OpenLotForm } from "./open-lot-form";
import { AssistantChat } from "./assistant-chat";
import { DailyPortfolioSummary } from "./daily-portfolio-summary";
import type { ReactNode } from "react";

export const revalidate = 900;

type Tab = "home" | "tracker" | "transactions" | "research" | "assistant" | "learn";

function formatDailyPercent(value: number) {
  const absolute = Math.abs(value);
  const digits = absolute === 0 || absolute >= 0.01 ? 2 : absolute >= 0.001 ? 3 : 4;
  return formatPercent(value, digits);
}
type LotStatusFilter = "all" | "open" | "closed";
type LotResultFilter = "all" | "profitable" | "loss" | "flat";
type LotSort = "newest" | "oldest" | "profit" | "loss" | "value";
const SAVINGS_ACCOUNTS = [
  { balance: 60163, label: "Savings 3.5%", rate: 3.5, ticker: "SAVINGS-35" },
  { balance: 40000, label: "Savings 6%", rate: 6, ticker: "SAVINGS-60" },
];

type LotFilters = {
  result: LotResultFilter;
  sort: LotSort;
  status: LotStatusFilter;
  ticker: string;
};

const RESEARCH_CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE"]);

function tone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
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

function LiveTicker({
  displayCurrency,
  holding,
  lots,
}: {
  displayCurrency: DisplayCurrency;
  holding: Holding;
  lots: Lot[];
}) {
  const holdingLots = lots.filter((lot) => lot.ticker === holding.ticker);
  const isSavings = holding.ticker.startsWith("SAVINGS");

  return (
    <details className="tickerItem" name="live-tickers">
      <summary>
        <SymbolLink
          className="tickerIdentity"
          name={holding.company}
          showLogo
          ticker={holding.ticker}
        >
          <span className="tickerText">
            <span className="tickerSymbol">{holding.ticker}</span>
            <span className="tickerCompany">{holding.company}</span>
          </span>
        </SymbolLink>
        <span className="tickerPrice">
          <span>{formatCurrency(holding.currentValue, displayCurrency)}</span>
          <span className={`tickerDelta ${isSavings ? "positive" : tone(holding.profit)}`}>
            {isSavings ? (
              <>Yield {holding.priceSource.replace(" yearly interest", "")}</>
            ) : (
              <>
                P/L {signed(holding.profit, (value) => formatCurrency(value, displayCurrency))} (
                {formatPercent(holding.profitPercent)})
              </>
            )}
          </span>
        </span>
      </summary>

      <div className="tickerDetails">
        {isSavings ? (
          <div className="detailGrid">
            <span>Balance</span>
            <strong>{formatCurrency(holding.currentValue, displayCurrency)}</strong>
            <span>Yearly rate</span>
            <strong>{holding.priceSource.replace(" yearly interest", "")}</strong>
            <span>Yearly interest</span>
            <strong>
              {formatCurrency(
                holding.currentValue * (Number.parseFloat(holding.priceSource) / 100),
                displayCurrency,
              )}
            </strong>
            <span>Source</span>
            <strong>AED savings</strong>
          </div>
        ) : (
          <div className="detailGrid">
            <span>Shares</span>
            <strong>{formatShares(holding.shares)}</strong>
            <span>Avg buy</span>
            <strong>{formatCurrency(holding.buyPrice, displayCurrency)}</strong>
            <span>Value</span>
            <strong>{formatCurrency(holding.currentValue, displayCurrency)}</strong>
            <span>P/L</span>
            <strong className={tone(holding.profit)}>
              {formatCurrency(holding.profit, displayCurrency)} ({formatPercent(holding.profitPercent)})
            </strong>
          </div>
        )}

        {holding.ticker === "CASH" ? (
          <p className="muted">Cash is tracked as uninvested account value.</p>
        ) : holding.ticker.startsWith("SAVINGS") ? (
          <p className="muted">
            Savings are stored in AED and converted for display.
          </p>
        ) : holdingLots.length === 0 ? (
          <p className="muted">
            {holding.priceSource} for {formatShares(holding.shares)}{" "}
            {holding.ticker === "GOLD" || holding.ticker === "SILVER" ? "g" : "shares"}.
          </p>
        ) : (
          <table className="compactTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Qty</th>
                <th>Buy</th>
                <th>Cost</th>
                <th>P/L</th>
              </tr>
            </thead>
            <tbody>
              {holdingLots.map((lot) => {
                const cost = lot.shares * lot.buyPrice + lot.fees;
                const value = lot.shares * holding.currentPrice;
                const profit = value - cost;
                return (
                  <tr key={`${lot.ticker}-${lot.purchaseDate}-${lot.shares}`}>
                    <td>{lot.purchaseDate || "Unknown"}</td>
                    <td>{formatShares(lot.shares)}</td>
                    <td>{formatCurrency(lot.buyPrice, displayCurrency)}</td>
                    <td>{formatCurrency(cost, displayCurrency)}</td>
                    <td className={tone(profit)}>{formatCurrency(profit, displayCurrency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

function AllocationTable({ holdings }: { holdings: Holding[] }) {
  return (
    <section>
      <h2>
        Allocation <span className="help" title="How your current account value is split across visible holdings.">?</span>
      </h2>
      <div className="allocationList">
        {holdings.map((holding) => (
          <div className="allocationRow" key={holding.ticker}>
            <SymbolLink
              className="compactTickerLink"
              name={holding.company}
              showLogo
              ticker={holding.ticker}
            >
              {holding.ticker}
            </SymbolLink>
            <div className="barTrack">
              <div
                className="barFill"
                style={{ width: `${Math.min(holding.allocationPercent, 100)}%` }}
              />
            </div>
            <strong>{formatPercent(holding.allocationPercent)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function holdingCategory(holding: Holding) {
  const ticker = holding.ticker.toUpperCase();
  if (ticker.startsWith("SAVINGS")) return "Savings";
  if (ticker === "CASH") return "Cash";
  if (ticker === "GOLD" || ticker === "SILVER") return "Metals";
  if (ticker.includes("BTC") || ticker.includes("ETH") || ticker.endsWith("-USD")) return "Crypto";
  return "Stocks";
}

function CategoryAllocationTable({
  displayCurrency,
  holdings,
}: {
  displayCurrency: DisplayCurrency;
  holdings: Holding[];
}) {
  const totalValue = holdings.reduce((total, holding) => total + holding.currentValue, 0);
  const categories = Array.from(
    holdings.reduce((totals, holding) => {
      const category = holdingCategory(holding);
      totals.set(category, (totals.get(category) ?? 0) + holding.currentValue);
      return totals;
    }, new Map<string, number>()),
  )
    .map(([category, value]) => ({
      category,
      percent: totalValue ? (value / totalValue) * 100 : 0,
      value,
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <section>
      <h2>
        Category allocation{" "}
        <span className="help" title="How your current account value is split across asset categories.">?</span>
      </h2>
      <div className="allocationList">
        {categories.map((item) => (
          <div className="categoryAllocationRow" key={item.category}>
            <span>{item.category}</span>
            <div className="barTrack">
              <div className="barFill" style={{ width: `${Math.min(item.percent, 100)}%` }} />
            </div>
            <strong>{formatPercent(item.percent)}</strong>
            <em>{formatCurrency(item.value, displayCurrency)}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function HoldingValueChart({
  displayCurrency,
  holdings,
}: {
  displayCurrency: DisplayCurrency;
  holdings: Holding[];
}) {
  const max = Math.max(...holdings.map((holding) => holding.currentValue), 1);
  return (
    <section>
      <h2>Holding value</h2>
      <div className="holdingBars">
        {holdings.map((holding) => (
          <div className="holdingBarRow" key={holding.ticker}>
            <SymbolLink
              className="compactTickerLink"
              name={holding.company}
              showLogo
              ticker={holding.ticker}
            >
              {holding.ticker}
            </SymbolLink>
            <div className="barTrack">
              <div
                className={`barFill ${tone(holding.profit)}`}
                style={{ width: `${(holding.currentValue / max) * 100}%` }}
              />
            </div>
            <strong>{formatCurrency(holding.currentValue, displayCurrency)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function TabBar({ activeTab }: { activeTab: Tab }) {
  const tabs: Array<{ label: string; value: Tab; href: string }> = [
    { label: "Home", value: "home", href: "/" },
    { label: "Transaction history", value: "transactions", href: "/?tab=transactions" },
    { label: "Research", value: "research", href: "/?tab=research" },
    { label: "Assistant", value: "assistant", href: "/?tab=assistant" },
    { label: "Learn", value: "learn", href: "/?tab=learn" },
  ];

  return (
    <nav className="appTabs" aria-label="Dashboard sections">
      {tabs.map((tab) => (
        <a
          aria-current={activeTab === tab.value ? "page" : undefined}
          className={activeTab === tab.value ? "active" : ""}
          href={tab.href}
          key={tab.value}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

const LEARN_COURSES = [
  {
    title: "Stock Market Basics",
    description: "Start with what shares represent, how exchanges work, and why prices move.",
    level: "Beginner",
    topics: ["Stocks", "Indexes", "Orders"],
    url: "https://www.youtube.com/results?search_query=stock+market+basics+for+beginners",
  },
  {
    title: "Reading Financial Statements",
    description: "Learn the income statement, balance sheet, cash flow, and the ratios investors use.",
    level: "Beginner",
    topics: ["Revenue", "Margins", "Cash flow"],
    url: "https://www.youtube.com/results?search_query=financial+statements+for+investors+beginner",
  },
  {
    title: "Portfolio Risk",
    description: "Understand diversification, position sizing, volatility, and drawdowns before chasing returns.",
    level: "Core",
    topics: ["Risk", "Diversification", "Allocation"],
    url: "https://www.youtube.com/results?search_query=portfolio+risk+management+for+beginners+investing",
  },
  {
    title: "Crypto Fundamentals",
    description: "A plain-English path through Bitcoin, Ethereum, wallets, exchanges, and blockchain basics.",
    level: "Beginner",
    topics: ["Bitcoin", "Ethereum", "Wallets"],
    url: "https://www.youtube.com/results?search_query=cryptocurrency+for+beginners+blockchain+wallets",
  },
  {
    title: "Crypto Security",
    description: "Focus on seed phrases, self-custody, exchange risk, scams, and safer habits.",
    level: "Core",
    topics: ["Security", "Custody", "Scams"],
    url: "https://www.youtube.com/results?search_query=crypto+wallet+security+seed+phrase+self+custody+beginner",
  },
  {
    title: "Market Psychology",
    description: "Recognize FOMO, panic selling, overconfidence, and the behavior loops behind bad trades.",
    level: "Mindset",
    topics: ["Behavior", "FOMO", "Discipline"],
    url: "https://www.youtube.com/results?search_query=investing+psychology+fomo+panic+selling+beginner",
  },
] as const;

const LEARN_PLAYLISTS = [
  {
    title: "Build Your Foundation",
    description: "A quick search path for beginner-friendly stock market explainers.",
    href: "https://www.youtube.com/results?search_query=investing+for+beginners+stocks+explained",
  },
  {
    title: "Understand Crypto Before Buying",
    description: "Videos focused on blockchain basics, wallets, and security instead of hype.",
    href: "https://www.youtube.com/results?search_query=crypto+basics+for+beginners+no+hype",
  },
  {
    title: "Learn Risk First",
    description: "Lessons on losing less, sizing positions, and surviving volatile markets.",
    href: "https://www.youtube.com/results?search_query=investing+risk+management+position+sizing+beginners",
  },
] as const;

function LearnView() {
  return (
    <>
      <section className="learnHero">
        <div>
          <span className="eyebrow">Learning hub</span>
          <h2>Stocks and crypto, without the noise.</h2>
          <p>
            A simple starting shelf for videos and study paths. Later this can connect to
            your holdings and watchlist so the lessons match what you actually own or track.
          </p>
        </div>
        <div className="learnHeroStats" aria-label="Learning categories">
          <strong>{LEARN_COURSES.length}</strong>
          <span>starter topics</span>
        </div>
      </section>

      <section>
        <div className="sectionHeader">
          <div>
            <h2>YouTube learning picks</h2>
            <p className="sectionNote">
              These open YouTube searches for relevant educational videos. No API key needed yet.
            </p>
          </div>
          <span className="statusPill">Basic version</span>
        </div>

        <div className="learnGrid">
          {LEARN_COURSES.map((course) => (
            <a className="learnCard" href={course.url} key={course.title} rel="noreferrer" target="_blank">
              <span className="typePill split">{course.level}</span>
              <h3>{course.title}</h3>
              <p>{course.description}</p>
              <span className="learnTopics">
                {course.topics.map((topic) => (
                  <small key={topic}>{topic}</small>
                ))}
              </span>
              <strong>Find videos on YouTube</strong>
            </a>
          ))}
        </div>
      </section>

      <section>
        <div className="sectionHeader">
          <div>
            <h2>Suggested paths</h2>
            <p className="sectionNote">A tiny curriculum for the next version of this tab.</p>
          </div>
        </div>
        <div className="learnPathList">
          {LEARN_PLAYLISTS.map((item, index) => (
            <a className="learnPathItem" href={item.href} key={item.title} rel="noreferrer" target="_blank">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}

function TopBar({ activeTab }: { activeTab: Tab }) {
  return (
    <div className="topBar">
      <TabBar activeTab={activeTab} />
      <div className="topBarActions">
        <ThemeToggle />
        <form action="/api/auth/logout" method="post">
          <button className="logoutButton" title="Log out" type="submit">Log out</button>
        </form>
      </div>
    </div>
  );
}

function normalizeResearchSymbol(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const symbol = String(raw ?? "").trim().toUpperCase();
  if (!symbol) return "";
  if (symbol.endsWith("-USD")) return symbol;
  return RESEARCH_CRYPTO_SYMBOLS.has(symbol) ? `${symbol}-USD` : symbol;
}

function researchHref(ticker: string) {
  const symbol = normalizeResearchSymbol(ticker);
  return `/?tab=research&symbol=${encodeURIComponent(symbol)}&range=1y`;
}

function SymbolLink({
  ticker,
  children,
  className,
  name,
  showLogo = false,
}: {
  ticker: string;
  children: ReactNode;
  className?: string;
  name?: string;
  showLogo?: boolean;
}) {
  if (ticker === "CASH" || ticker.startsWith("SAVINGS")) {
    return (
      <span className={className}>
        {showLogo ? <AssetLogo name={name} ticker={ticker} /> : null}
        {children}
      </span>
    );
  }

  return (
    <a className={`symbolLink ${className ?? ""}`.trim()} href={researchHref(ticker)}>
      {showLogo ? <AssetLogo name={name} ticker={ticker} /> : null}
      {children}
    </a>
  );
}

function AssetLogo({ ticker, name }: { ticker: string; name?: string }) {
  return (
    <span className="assetLogoFrame" aria-hidden="true">
      <img alt="" className="assetLogo" src={assetLogoUrl(ticker, name)} />
      <span>{assetLogoFallback(ticker)}</span>
    </span>
  );
}

function TrackerTicker({ position }: { position: TrackedPosition }) {
  const ticker = position.marketTicker || position.ticker;
  const content = (
    <>
      <AssetLogo name={position.asset} ticker={ticker} />
      <span className="tickerText">
        <span className="tickerSymbol">{position.ticker}</span>
        <span className="tickerCompany">{position.asset}</span>
      </span>
    </>
  );

  if (!position.marketTicker) {
    return <span className="tickerIdentity">{content}</span>;
  }

  return (
    <SymbolLink className="tickerIdentity" name={position.asset} ticker={ticker}>
      {content}
    </SymbolLink>
  );
}

function CurrencySelector({
  activeCurrency,
  range,
  tab = "tracker",
}: {
  activeCurrency: DisplayCurrency;
  range?: Timeframe;
  tab?: Tab;
}) {
  return (
    <nav className="currencyNav" aria-label="Display currency">
      {DISPLAY_CURRENCIES.map((currency) => {
        const params = new URLSearchParams();
        if (tab !== "home") params.set("tab", tab);
        if (range) params.set("range", range);
        params.set("currency", currency);

        return (
          <a
            aria-current={activeCurrency === currency ? "page" : undefined}
            className={activeCurrency === currency ? "active" : ""}
            href={`/?${params.toString()}`}
            key={currency}
          >
            {currency}
          </a>
        );
      })}
    </nav>
  );
}

function CurrencyControl({
  activeCurrency,
  range,
  tab,
}: {
  activeCurrency: DisplayCurrency;
  range?: Timeframe;
  tab: Tab;
}) {
  return (
    <div className="trackerControls">
      <div>
        <h2>Display currency</h2>
        <p className="sectionNote">All values are converted using live FX rates.</p>
      </div>
      <CurrencySelector activeCurrency={activeCurrency} range={range} tab={tab} />
    </div>
  );
}

function TrackerView({
  displayCurrency,
  positions,
}: {
  displayCurrency: DisplayCurrency;
  positions: Array<TrackedPosition & {
    costBasisDisplay: number;
    currentPriceDisplay: number;
    currentValueDisplay: number;
    displayCurrency: DisplayCurrency;
    profitDisplay: number;
    sourceCurrency: string;
  }>;
}) {
  const liveCount = positions.filter((position) => position.usesLivePrice).length;
  const totalCost = positions.reduce((total, position) => total + position.costBasisDisplay, 0);
  const totalValue = positions.reduce((total, position) => total + position.currentValueDisplay, 0);
  const totalProfit = positions.reduce((total, position) => total + position.profitDisplay, 0);
  const totalReturn = totalCost ? (totalProfit / totalCost) * 100 : 0;
  const platformTotals = Array.from(
    positions.reduce((totals, position) => {
      const key = position.platform || "Other";
      totals.set(key, (totals.get(key) ?? 0) + position.currentValueDisplay);
      return totals;
    }, new Map<string, number>()),
  ).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <CurrencyControl activeCurrency={displayCurrency} tab="tracker" />

      <section className="metricsGrid">
        <MetricCard
          label="Tracked assets"
          value={String(positions.length)}
          delta={`${liveCount} live, ${positions.length - liveCount} snapshot`}
          help="Positions imported from the current investment positions workbook."
        />
        <MetricCard
          label="Current value"
          value={formatCurrency(totalValue, displayCurrency)}
          help="Current market value converted into the selected display currency."
        />
        <MetricCard
          label="Profit / loss"
          value={formatCurrency(totalProfit, displayCurrency)}
          valueTone={tone(totalProfit)}
          delta={`${formatPercent(totalReturn)} total return`}
          deltaValue={totalProfit}
          help="Unrealized P/L converted into the selected display currency."
        />
        <MetricCard
          label="Price source"
          value={liveCount === positions.length ? "Live" : "Mixed"}
          help="Live rows come from Yahoo Finance or CoinGecko. Snapshot rows use the workbook values."
        />
      </section>

      <section>
        <div className="sectionHeader">
          <div>
            <h2>Tracked positions</h2>
            <p className="sectionNote">
              Stocks and crypto use market quotes. Gold and silver use live Dubai AED-per-gram rates.
            </p>
          </div>
          <span className="statusPill">XLSX import</span>
        </div>

        <div className="trackerTableWrap">
          <table className="trackerTable">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Platform</th>
                <th>Qty</th>
                <th>Avg price</th>
                <th>Current price</th>
                <th>Current value</th>
                <th>P/L</th>
                <th>Return</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => {
                return (
                  <tr key={`${position.platform}-${position.asset}-${position.quantity}`}>
                    <td>
                      <TrackerTicker position={position} />
                    </td>
                    <td>
                      <span className="typePill split">{position.platform || "Other"}</span>
                    </td>
                    <td>{formatShares(position.quantity)} {position.unit}</td>
                    <td>{formatCurrency(position.avgPrice, position.sourceCurrency)}</td>
                    <td>{formatCurrency(position.currentPriceDisplay, displayCurrency)}</td>
                    <td>{formatCurrency(position.currentValueDisplay, displayCurrency)}</td>
                    <td className={tone(position.profitDisplay)}>{formatCurrency(position.profitDisplay, displayCurrency)}</td>
                    <td className={tone(position.returnPercent)}>{formatPercent(position.returnPercent)}</td>
                    <td>
                      <span className={`sourceBadge ${position.usesLivePrice ? "live" : ""}`}>
                        {position.marketSource}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Platform value</h2>
        <div className="trackerPlatformList">
          {platformTotals.map(([key, value]) => {
            return (
              <div className="trackerPlatformRow" key={key}>
                <span>{key}</span>
                <strong>{formatCurrency(value, displayCurrency)}</strong>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function FilterLink({
  children,
  filters,
  next,
}: {
  children: ReactNode;
  filters: LotFilters;
  next: Partial<LotFilters>;
}) {
  const params = new URLSearchParams({
    tab: "transactions",
    lotResult: next.result ?? filters.result,
    lotSort: next.sort ?? filters.sort,
    lotStatus: next.status ?? filters.status,
  });
  const ticker = next.ticker ?? filters.ticker;
  if (ticker !== "all") params.set("lotTicker", ticker);

  return <a href={`/?${params.toString()}`}>{children}</a>;
}

function InvestmentLots({
  allLots,
  filters,
  lots,
}: {
  allLots: TransactionLot[];
  filters: LotFilters;
  lots: TransactionLot[];
}) {
  const openLots = allLots.filter((lot) => lot.status === "open");
  const closedLots = allLots.filter((lot) => lot.status === "closed");
  const totalProfit = lots.reduce((total, lot) => total + lot.profit, 0);
  const openValue = openLots.reduce((total, lot) => total + lot.currentValue, 0);
  const tickerOptions = Array.from(new Set(allLots.map((lot) => lot.ticker))).sort();
  const buyTransactions = new Map(
    allLots.flatMap((lot) =>
      lot.buyTransaction ? [[lot.id, lot.buyTransaction] as const] : [],
    ),
  );

  return (
    <>
      <section className="metricsGrid transactionMetrics">
        <MetricCard
          label="Lots"
          value={String(lots.length)}
          help="Each lot is one buy transaction, with linked sells folded into it."
        />
        <MetricCard
          label="Open lots"
          value={String(openLots.length)}
          help="Lots that still have unsold quantity."
        />
        <MetricCard
          label="Open value"
          value={formatMoney(openValue)}
          help="Current market value of all open lots with available live prices."
        />
        <MetricCard
          label="Total lot P/L"
          value={formatMoney(totalProfit)}
          valueTone={tone(totalProfit)}
          help="Realized P/L on closed lots plus unrealized P/L on open lots."
        />
      </section>

      <section>
        <div className="sectionHeader">
          <div>
            <h2>Investment lots</h2>
            <p className="sectionNote">
              Each row is a buy lot. Open lots use live price data; closed lots use
              linked sell transactions from data/transactions.csv.
            </p>
          </div>
          <span className="statusPill">{openLots.length} open, {closedLots.length} closed</span>
        </div>

        <div className="lotFilterPanel">
          <div className="filterGroup" aria-label="Lot status filter">
            <FilterLink filters={filters} next={{ status: "all" }}>
              <span className={filters.status === "all" ? "active" : ""}>All</span>
            </FilterLink>
            <FilterLink filters={filters} next={{ status: "open" }}>
              <span className={filters.status === "open" ? "active" : ""}>Open</span>
            </FilterLink>
            <FilterLink filters={filters} next={{ status: "closed" }}>
              <span className={filters.status === "closed" ? "active" : ""}>Closed</span>
            </FilterLink>
          </div>

          <div className="filterGroup" aria-label="Lot result filter">
            <FilterLink filters={filters} next={{ result: "all" }}>
              <span className={filters.result === "all" ? "active" : ""}>Any P/L</span>
            </FilterLink>
            <FilterLink filters={filters} next={{ result: "profitable" }}>
              <span className={filters.result === "profitable" ? "active" : ""}>Profit</span>
            </FilterLink>
            <FilterLink filters={filters} next={{ result: "loss" }}>
              <span className={filters.result === "loss" ? "active" : ""}>Loss</span>
            </FilterLink>
            <FilterLink filters={filters} next={{ result: "flat" }}>
              <span className={filters.result === "flat" ? "active" : ""}>Flat</span>
            </FilterLink>
          </div>

          <form className="lotFilterForm" action="/">
            <input name="tab" type="hidden" value="transactions" />
            <input name="lotStatus" type="hidden" value={filters.status} />
            <input name="lotResult" type="hidden" value={filters.result} />
            <label>
              Ticker
              <select name="lotTicker" defaultValue={filters.ticker}>
                <option value="all">All tickers</option>
                {tickerOptions.map((ticker) => (
                  <option key={ticker} value={ticker}>
                    {ticker}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort
              <select name="lotSort" defaultValue={filters.sort}>
                <option value="newest">Newest buy</option>
                <option value="oldest">Oldest buy</option>
                <option value="profit">Highest profit</option>
                <option value="loss">Biggest loss</option>
                <option value="value">Highest value</option>
              </select>
            </label>
            <button type="submit">Apply</button>
            <a href="/?tab=transactions">Reset</a>
          </form>

          <p className="filterSummary">
            Showing <strong>{lots.length}</strong> of <strong>{allLots.length}</strong> lots
          </p>
        </div>

        <div className="lotList">
          {lots.length ? (
            lots.map((lot) => {
              const closed = lot.status === "closed";
              const displayPrice = closed ? lot.averageSellPrice : lot.currentPrice;
              const displayValue = closed ? lot.sellProceeds : lot.currentValue;

              return (
                <details className="lotItem" key={lot.id}>
                  <summary>
                    <SymbolLink
                      className="tickerIdentity"
                      name={lot.company || lot.id}
                      showLogo
                      ticker={lot.ticker}
                    >
                      <span className="tickerText">
                        <span className="tickerSymbol">{lot.ticker}</span>
                        <span className="tickerCompany">{lot.company || lot.id}</span>
                      </span>
                    </SymbolLink>
                    <span className={`typePill ${closed ? "sell" : "buy"}`}>
                      {closed ? "Closed" : "Open"}
                    </span>
                    <span>{lot.buyDate || "Unknown"}</span>
                    <span>{formatShares(lot.buyQuantity)}</span>
                    <span>{formatMoney(lot.buyPrice)}</span>
                    <span>{displayPrice ? formatMoney(displayPrice) : "-"}</span>
                    <span>{displayValue ? formatMoney(displayValue) : "-"}</span>
                    <strong className={tone(lot.profit)}>
                      {formatMoney(lot.profit)} ({formatPercent(lot.profitPercent)})
                    </strong>
                  </summary>

                  <div className="lotDetails">
                    <div className="lotDetailGrid">
                      <span>Lot ID</span>
                      <strong>{lot.id}</strong>
                      <span>Status</span>
                      <strong>{closed ? "Closed" : "Open"}</strong>
                      <span>Buy total</span>
                      <strong>{formatMoney(lot.buyTotal)}</strong>
                      <span>Buy fees</span>
                      <strong>{formatMoney(lot.buyFees)}</strong>
                      <span>Sold qty</span>
                      <strong>{formatShares(lot.soldQuantity)}</strong>
                      <span>Remaining qty</span>
                      <strong>{formatShares(lot.remainingQuantity)}</strong>
                      <span>Realized P/L</span>
                      <strong className={tone(lot.realizedProfit)}>{formatMoney(lot.realizedProfit)}</strong>
                      <span>Unrealized P/L</span>
                      <strong className={tone(lot.unrealizedProfit)}>{formatMoney(lot.unrealizedProfit)}</strong>
                      <span>Price source</span>
                      <strong>{lot.priceSource}</strong>
                    </div>

                    <div className="transactionPair">
                      <div>
                        <h3>Buy</h3>
                        <p>{lot.buyDate || "Unknown"} at {formatMoney(lot.buyPrice)}</p>
                        <p>{formatShares(lot.buyQuantity)} shares for {formatMoney(lot.buyTotal)}</p>
                        {buyTransactions.get(lot.id) ? (
                          <TransactionEditForm transaction={buyTransactions.get(lot.id)!} />
                        ) : null}
                      </div>
                      <div>
                        <h3>{closed ? "Sell" : "Current"}</h3>
                        {closed ? (
                          lot.sellTransactions.map((transaction) => (
                            <div className="sellTransaction" key={`${transaction.rowIndex}-${transaction.date}-${transaction.total}`}>
                              <p>
                                {transaction.date || "Unknown"} at {formatMoney(transaction.price)}:
                                {" "}{formatShares(transaction.quantity)} for {formatMoney(transaction.total)}
                              </p>
                              <TransactionEditForm transaction={transaction} />
                            </div>
                          ))
                        ) : (
                          <>
                            <p>
                              Current price {lot.currentPrice ? formatMoney(lot.currentPrice) : "unavailable"};
                              value {formatMoney(lot.currentValue)}
                            </p>
                            <CloseLotForm lot={lot} />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </details>
              );
            })
          ) : (
            <p className="emptyState">No buy lots yet. Add BUY rows to data/transactions.csv and refresh.</p>
          )}
        </div>
      </section>
    </>
  );
}

function normalizeTimeframe(value: string | string[] | undefined): Timeframe {
  const raw = Array.isArray(value) ? value[0] : value;
  return TIMEFRAMES.some((item) => item.value === raw) ? (raw as Timeframe) : "1y";
}

function normalizeTab(value: string | string[] | undefined): Tab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "research") return "research";
  if (raw === "assistant") return "assistant";
  if (raw === "learn") return "learn";
  return raw === "transactions" ? "transactions" : "home";
}

function oneParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeDisplayCurrency(value: string | string[] | undefined): DisplayCurrency {
  const raw = String(oneParam(value) ?? "USD").toUpperCase();
  return raw === "EUR" || raw === "AED" ? raw : "USD";
}

function convertHoldings(holdings: Holding[], rate: number): Holding[] {
  return holdings.map((holding) => ({
    ...holding,
    buyPrice: holding.buyPrice * rate,
    currentPrice: holding.currentPrice * rate,
    currentValue: holding.currentValue * rate,
    dailyChange: holding.dailyChange * rate,
    fees: holding.fees * rate,
    invested: holding.invested * rate,
    previousPrice: holding.previousPrice * rate,
    previousValue: holding.previousValue * rate,
    profit: holding.profit * rate,
    valueDailyChange: holding.valueDailyChange * rate,
  }));
}

function convertLots(lots: Lot[], rate: number): Lot[] {
  return lots.map((lot) => ({
    ...lot,
    buyPrice: lot.buyPrice * rate,
    fees: lot.fees * rate,
  }));
}

function convertPerformance(points: PerformancePoint[], rate: number): PerformancePoint[] {
  return points.map((point) => ({
    ...point,
    invested: point.invested * rate,
    marketValue: point.marketValue * rate,
    profit: point.profit * rate,
  }));
}

function trackedPositionToHolding(
  position: TrackedPosition & {
    costBasisDisplay: number;
    currentPriceDisplay: number;
    currentValueDisplay: number;
    dailyChangeDisplay: number;
    profitDisplay: number;
  },
): Holding {
  const previousValue = position.currentValueDisplay - position.dailyChangeDisplay;
  const previousPrice = position.quantity ? previousValue / position.quantity : position.currentPriceDisplay;
  return {
    ticker: position.ticker,
    company: position.asset,
    shares: position.quantity,
    buyPrice: position.quantity ? position.costBasisDisplay / position.quantity : 0,
    invested: position.costBasisDisplay,
    fees: 0,
    lots: 1,
    currentPrice: position.currentPriceDisplay,
    previousPrice,
    dailyChange: position.dailyChangeDisplay,
    dailyChangePercent: position.dailyChangePercent ?? 0,
    currentValue: position.currentValueDisplay,
    previousValue,
    valueDailyChange: position.dailyChangeDisplay,
    profit: position.profitDisplay,
    profitPercent: position.returnPercent,
    allocationPercent: 0,
    priceSource: position.marketSource,
  };
}

function combinedHoldingCompany(ticker: string, holdings: Holding[]) {
  if (ticker === "ETH") return "Ethereum";
  if (ticker === "BTC") return "Bitcoin";

  const names = Array.from(
    new Set(holdings.map((holding) => holding.company.replace(/\s+-\s+Position\s+\d+$/i, "").trim())),
  ).filter(Boolean);
  return names.length === 1 ? names[0] : `${ticker} positions`;
}

function combineHoldingsByTicker(holdings: Holding[]) {
  const grouped = new Map<string, Holding[]>();
  for (const holding of holdings) {
    grouped.set(holding.ticker, [...(grouped.get(holding.ticker) ?? []), holding]);
  }

  return Array.from(grouped.entries()).map(([ticker, tickerHoldings]) => {
    if (tickerHoldings.length === 1) return tickerHoldings[0];

    const shares = tickerHoldings.reduce((total, holding) => total + holding.shares, 0);
    const invested = tickerHoldings.reduce((total, holding) => total + holding.invested, 0);
    const fees = tickerHoldings.reduce((total, holding) => total + holding.fees, 0);
    const currentValue = tickerHoldings.reduce((total, holding) => total + holding.currentValue, 0);
    const previousValue = tickerHoldings.reduce((total, holding) => total + holding.previousValue, 0);
    const profit = tickerHoldings.reduce((total, holding) => total + holding.profit, 0);
    const dailyChange = currentValue - previousValue;

    return {
      ...tickerHoldings[0],
      company: combinedHoldingCompany(ticker, tickerHoldings),
      shares,
      buyPrice: shares ? invested / shares : 0,
      invested,
      fees,
      lots: tickerHoldings.reduce((total, holding) => total + holding.lots, 0),
      currentPrice: shares ? currentValue / shares : 0,
      previousPrice: shares ? previousValue / shares : 0,
      dailyChange,
      dailyChangePercent: previousValue ? (dailyChange / previousValue) * 100 : 0,
      currentValue,
      previousValue,
      valueDailyChange: dailyChange,
      profit,
      profitPercent: invested ? (profit / invested) * 100 : 0,
      priceSource: Array.from(new Set(tickerHoldings.map((holding) => holding.priceSource))).join(" + "),
    };
  });
}

function savingsHoldings(aedDisplayRate: number): Holding[] {
  return SAVINGS_ACCOUNTS.map((account) => {
    const value = account.balance * aedDisplayRate;

    return {
      ticker: account.ticker,
      company: account.label,
      shares: 1,
      buyPrice: value,
      invested: value,
      fees: 0,
      lots: 1,
      currentPrice: value,
      previousPrice: value,
      dailyChange: 0,
      dailyChangePercent: 0,
      currentValue: value,
      previousValue: value,
      valueDailyChange: 0,
      profit: 0,
      profitPercent: 0,
      allocationPercent: 0,
      priceSource: `${formatPercent(account.rate)} yearly interest`,
    };
  });
}

function isSavingsHolding(holding: Holding) {
  return holding.ticker.startsWith("SAVINGS-");
}

function withAllocation(holdings: Holding[]) {
  const totalValue = holdings.reduce((total, holding) => total + holding.currentValue, 0);
  return holdings
    .map((holding) => ({
      ...holding,
      allocationPercent: totalValue ? (holding.currentValue / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.currentValue - a.currentValue);
}

function trackerHomePositions(positions: TrackerPosition[]) {
  return positions.filter((position) => {
    const ticker = position.ticker.toUpperCase();
    return Boolean(ticker);
  });
}

function normalizeLotStatus(value: string | string[] | undefined): LotStatusFilter {
  const raw = oneParam(value);
  return raw === "open" || raw === "closed" ? raw : "all";
}

function normalizeLotResult(value: string | string[] | undefined): LotResultFilter {
  const raw = oneParam(value);
  if (raw === "profitable" || raw === "loss" || raw === "flat") return raw;
  return "all";
}

function normalizeLotSort(value: string | string[] | undefined): LotSort {
  const raw = oneParam(value);
  if (raw === "oldest" || raw === "profit" || raw === "loss" || raw === "value") return raw;
  return "newest";
}

function normalizeLotFilters(params: Record<string, string | string[] | undefined>): LotFilters {
  const rawTicker = String(oneParam(params.lotTicker) ?? "all").trim();
  const ticker = !rawTicker || rawTicker.toLowerCase() === "all" ? "all" : rawTicker.toUpperCase();

  return {
    result: normalizeLotResult(params.lotResult),
    sort: normalizeLotSort(params.lotSort),
    status: normalizeLotStatus(params.lotStatus),
    ticker,
  };
}

function lotDateValue(value: string) {
  const [day, month, year] = value.split("/");
  const parsed = Date.parse(`${year}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function filterTransactionLots(lots: TransactionLot[], filters: LotFilters) {
  return lots
    .filter((lot) => filters.status === "all" || lot.status === filters.status)
    .filter((lot) => filters.ticker === "all" || lot.ticker === filters.ticker)
    .filter((lot) => {
      if (filters.result === "profitable") return lot.profit > 0;
      if (filters.result === "loss") return lot.profit < 0;
      if (filters.result === "flat") return lot.profit === 0;
      return true;
    })
    .sort((a, b) => {
      if (filters.sort === "oldest") return lotDateValue(a.buyDate) - lotDateValue(b.buyDate);
      if (filters.sort === "profit") return b.profit - a.profit;
      if (filters.sort === "loss") return a.profit - b.profit;
      if (filters.sort === "value") return b.currentValue - a.currentValue;
      return lotDateValue(b.buyDate) - lotDateValue(a.buyDate);
    });
}

function snapshotLotIds(lots: Lot[]) {
  const counts = new Map<string, number>();

  return new Set(
    lots.map((lot) => {
      const date = parsePurchaseDate(lot.purchaseDate);
      const dateKey = date
        ? `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`
        : lot.purchaseDate.replace(/\D/g, "");
      const key = `${lot.ticker}-${dateKey}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return `${key}-${String(count).padStart(2, "0")}`;
    }),
  );
}

function snapshotBaselineRowIndex(transactions: Awaited<ReturnType<typeof loadTransactions>>, snapshotIds: Set<string>) {
  const indexes = transactions
    .filter((transaction) => transaction.type === "BUY" && snapshotIds.has(transaction.lotId))
    .map((transaction) => transaction.rowIndex);

  return indexes.length ? Math.max(...indexes) : -1;
}

async function loadPortfolioStateFromTransactions(): Promise<{ cashBalance: number; lots: Lot[] }> {
  const [transactions, snapshotLots] = await Promise.all([loadTransactions(), loadLots()]);
  const transactionLots = buildTransactionLots(transactions);
  const snapshotIds = snapshotLotIds(snapshotLots);
  const baselineRowIndex = snapshotBaselineRowIndex(transactions, snapshotIds);
  const cashBalance =
    CASH_BALANCE +
    transactions
      .filter((transaction) => transaction.rowIndex > baselineRowIndex)
      .reduce((total, transaction) => total + cashImpact(transaction), 0);
  const lots = transactionLots
    .filter((lot) => lot.status === "open" && lot.remainingQuantity > 0)
    .map((lot) => ({
      ticker: lot.ticker,
      company: lot.company,
      purchaseDate: lot.buyDate,
      shares: lot.remainingQuantity,
      buyPrice: lot.remainingQuantity ? lot.remainingCost / lot.remainingQuantity : lot.buyPrice,
      fees: 0,
      notes: lot.id,
    }));

  return { cashBalance, lots };
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const activeTab = normalizeTab(params.tab);
  const timeframe = normalizeTimeframe(params.range);

  if (activeTab === "learn") {
    return (
      <main>
        <TopBar activeTab={activeTab} />
        <header className="pageHeader">
          <div>
            <h1>Learn</h1>
            <p>Simple learning resources for stocks, crypto, risk, and market behavior.</p>
          </div>
          <span className="statusPill">YouTube resources</span>
        </header>
        <LearnView />
      </main>
    );
  }

  if (activeTab === "research") {
    const symbol = normalizeResearchSymbol(params.symbol);
    const { cashBalance, lots } = await loadPortfolioStateFromTransactions();
    const portfolioTickers = Array.from(new Set(lots.map((lot) => lot.ticker)));
    const quoteTickers = Array.from(new Set(symbol ? [...portfolioTickers, symbol] : portfolioTickers));
    const [quotes, history, research]: [
      Record<string, Quote>,
      PricePoint[],
      { profile: ResearchProfile | null; news: ResearchNewsItem[] },
    ] = symbol
      ? await Promise.all([
          fetchQuotes(quoteTickers),
          fetchPriceHistory([symbol], timeframe),
          fetchResearchOverview(symbol),
        ])
      : [await fetchQuotes(quoteTickers), [] as PricePoint[], { profile: null, news: [] }];
    const holdings = aggregateLots(lots, quotes, cashBalance).filter((holding) => holding.ticker !== "CASH");
    const exposureHolding = symbol
      ? holdings.find((holding) => holding.ticker === symbol) ?? null
      : null;
    const totalPortfolioValue = holdings.reduce((total, holding) => total + holding.currentValue, 0);
    const exposure = exposureHolding
      ? {
          allocationPercent: exposureHolding.allocationPercent,
          company: exposureHolding.company,
          currentValue: exposureHolding.currentValue,
          dailyChange: exposureHolding.valueDailyChange,
          invested: exposureHolding.invested,
          profit: exposureHolding.profit,
          profitPercent: exposureHolding.profitPercent,
          shares: exposureHolding.shares,
          symbol: exposureHolding.ticker,
          totalPortfolioValue,
        }
      : null;

    return (
      <main>
        <TopBar activeTab={activeTab} />
        <header className="pageHeader">
          <div>
            <h1>Research</h1>
            <p>Search stocks and crypto, then inspect price history.</p>
          </div>
          <span className="statusPill">Yahoo + CoinGecko</span>
        </header>
        <ResearchView
          exposure={exposure}
          history={history}
          news={research.news}
          profile={research.profile}
          quote={symbol ? quotes[symbol] : undefined}
          symbol={symbol}
          timeframe={timeframe}
        />
      </main>
    );
  }

  if (activeTab === "assistant") {
    return (
      <main>
        <TopBar activeTab={activeTab} />
        <header className="pageHeader">
          <div>
            <h1>Assistant</h1>
            <p>Ask questions about your portfolio, allocation, lots, savings, and tracked assets.</p>
          </div>
          <span className="statusPill">Private Gemini</span>
        </header>
        <AssistantChat />
      </main>
    );
  }

  if (activeTab === "transactions") {
    const transactions = await loadTransactions();
    const transactionTickers = Array.from(
      new Set(transactions.filter((transaction) => transaction.type === "BUY").map((transaction) => transaction.ticker)),
    );
    const quotes = await fetchQuotes(transactionTickers);
    const transactionLots = buildTransactionLots(transactions, quotes);
    const lotFilters = normalizeLotFilters(params);
    const filteredLots = filterTransactionLots(transactionLots, lotFilters);

    return (
      <main>
        <TopBar activeTab={activeTab} />
        <header className="pageHeader">
          <div>
            <h1>Transaction History</h1>
            <p>A lot-based view of open and closed investments.</p>
          </div>
          <span className="statusPill">CSV-backed</span>
        </header>
        <OpenLotForm />
        <InvestmentLots allLots={transactionLots} filters={lotFilters} lots={filteredLots} />
      </main>
    );
  }

  const displayCurrency = normalizeDisplayCurrency(params.currency);
  const [{ cashBalance, lots }, trackerPositions] = await Promise.all([
    loadPortfolioStateFromTransactions(),
    loadTrackerPositions(),
  ]);
  const homeTrackerPositions = trackerHomePositions(combineStakingEthPositions(trackerPositions));
  const trackerTickerSet = new Set(
    homeTrackerPositions.flatMap((position) => [
      position.ticker,
      position.marketTicker,
    ]).filter(Boolean),
  );
  const portfolioLotsForHome = lots.filter((lot) => !trackerTickerSet.has(lot.ticker));
  const tickers = Array.from(
    new Set([
      ...portfolioLotsForHome.map((lot) => lot.ticker),
      ...homeTrackerPositions.map((position) => position.marketTicker).filter(Boolean),
    ]),
  );
  const firstPurchaseDate = lots
    .map((lot) => parsePurchaseDate(lot.purchaseDate))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const [quotes, history, currencyRates, metalPrices] = await Promise.all([
    fetchQuotes(tickers),
    fetchPriceHistory(tickers, timeframe, firstPurchaseDate),
    fetchCurrencyRates(displayCurrency),
    fetchDubaiMetalPrices(),
  ]);
  const usdDisplayRate = currencyRates.get("USD") ?? 1;
  const aedDisplayRate = currencyRates.get("AED") ?? 1;
  const portfolioHoldings = convertHoldings(
    aggregateLots(portfolioLotsForHome, quotes, cashBalance).filter((holding) => holding.ticker !== "CASH"),
    usdDisplayRate,
  );
  const trackerHoldings = convertTrackedPositions(
    buildTrackedPositions(homeTrackerPositions, quotes, metalPrices),
    displayCurrency,
    currencyRates,
  ).map(trackedPositionToHolding);
  const holdings = withAllocation(combineHoldingsByTicker([
    ...savingsHoldings(aedDisplayRate),
    ...portfolioHoldings,
    ...trackerHoldings,
  ]));
  const displayLots = convertLots(portfolioLotsForHome, usdDisplayRate);
  const performance = convertPerformance(buildPerformance(history, lots), usdDisplayRate);

  const investmentHoldings = holdings.filter((holding) => !isSavingsHolding(holding));
  const savingsBalance = holdings
    .filter(isSavingsHolding)
    .reduce((total, holding) => total + holding.currentValue, 0);
  const totalInvested = investmentHoldings.reduce((total, holding) => total + holding.invested, 0);
  const totalValue = investmentHoldings.reduce((total, holding) => total + holding.currentValue, 0);
  const previousValue = investmentHoldings.reduce((total, holding) => total + holding.previousValue, 0);
  const totalProfit = investmentHoldings.reduce((total, holding) => total + holding.profit, 0);
  const totalReturn = totalInvested ? (totalProfit / totalInvested) * 100 : 0;
  const dailyChange = totalValue - previousValue;
  const dailyChangePercent = previousValue ? (dailyChange / previousValue) * 100 : 0;

  return (
    <main>
      <TopBar activeTab={activeTab} />
      <header className="pageHeader">
        <div>
          <h1>Personal Investment Assistant</h1>
          <p>A focused dashboard for your portfolio, research, and learning.</p>
          <MarketStatus />
        </div>
        <span className="statusPill">Live market data</span>
      </header>

      <CurrencyControl activeCurrency={displayCurrency} range={timeframe} tab="home" />

      <section className="metricsGrid">
        <MetricCard
          label="Total invested"
          value={formatCurrency(totalInvested, displayCurrency)}
          help="The total cost of open stocks, crypto, and metals. Savings accounts are shown separately."
        />
        <MetricCard
          label="Investment value"
          value={formatCurrency(totalValue, displayCurrency)}
          delta={`${signed(dailyChange, (value) => formatCurrency(value, displayCurrency))} today`}
          deltaValue={dailyChange}
          help="The current value of stocks, crypto, and metals. Savings accounts are excluded."
        />
        <MetricCard
          label="Savings balance"
          value={formatCurrency(savingsBalance, displayCurrency)}
          help="The combined balance of your savings accounts, converted into the selected display currency."
        />
        <MetricCard
          label="Profit / loss"
          value={formatCurrency(totalProfit, displayCurrency)}
          valueTone={tone(totalProfit)}
          delta={`${signed(dailyChange, (value) => formatCurrency(value, displayCurrency))} today`}
          deltaValue={dailyChange}
          help="Unrealized profit or loss on open investments. It excludes cash and is not locked in until you sell."
        />
        <MetricCard
          label="Total return"
          value={formatPercent(totalReturn)}
          valueTone={tone(totalReturn)}
          delta={`${signed(dailyChangePercent, formatDailyPercent)} today`}
          deltaValue={dailyChangePercent}
          help="Unrealized profit or loss divided by total invested capital."
        />
      </section>

      <DailyPortfolioSummary
        currency={displayCurrency}
        holdings={investmentHoldings.map(({ ticker, company, currentValue, dailyChange, dailyChangePercent }) => ({
          ticker,
          company,
          currentValue,
          dailyChange,
          dailyChangePercent,
        }))}
      />

      <PerformanceChart currency={displayCurrency} points={performance} timeframe={timeframe} />

      <section>
        <h2>Live value ticker</h2>
        <div className="tickerGrid">
          {holdings.map((holding) => (
            <LiveTicker
              displayCurrency={displayCurrency}
              key={holding.ticker}
              holding={holding}
              lots={displayLots}
            />
          ))}
        </div>
      </section>

      <div className="dashboardGrid">
        <HoldingValueChart displayCurrency={displayCurrency} holdings={holdings} />
        <AllocationTable holdings={holdings} />
        <CategoryAllocationTable displayCurrency={displayCurrency} holdings={holdings} />
      </div>
    </main>
  );
}
