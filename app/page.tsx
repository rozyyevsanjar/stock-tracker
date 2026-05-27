import { aggregateLots, loadLots, parsePurchaseDate } from "@/lib/portfolio";
import {
  TIMEFRAMES,
  type Timeframe,
  buildPerformance,
  fetchPriceHistory,
  fetchQuotes,
  fetchResearchOverview,
} from "@/lib/market";
import { formatMoney, formatPercent, formatShares, signed } from "@/lib/format";
import { buildTransactionLots, loadTransactions } from "@/lib/transactions";
import { assetLogoFallback, assetLogoUrl } from "@/lib/logos";
import type {
  Holding,
  Lot,
  PricePoint,
  Quote,
  ResearchNewsItem,
  ResearchProfile,
  TransactionLot,
} from "@/lib/types";
import { MarketStatus } from "./market-status";
import { PerformanceChart } from "./performance-chart";
import { ResearchView } from "./research-tools";
import { ThemeToggle } from "./theme-toggle";
import { CloseLotForm } from "./close-lot-form";
import type { ReactNode } from "react";

export const revalidate = 900;

type Tab = "home" | "transactions" | "research";
type LotStatusFilter = "all" | "open" | "closed";
type LotResultFilter = "all" | "profitable" | "loss" | "flat";
type LotSort = "newest" | "oldest" | "profit" | "loss" | "value";

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

function LiveTicker({ holding, lots }: { holding: Holding; lots: Lot[] }) {
  const holdingLots = lots.filter((lot) => lot.ticker === holding.ticker);

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
          <span>{formatMoney(holding.currentPrice)}</span>
          <span className={`tickerDelta ${tone(holding.dailyChange)}`}>
            {signed(holding.dailyChange, (value) => formatMoney(value))} (
            {formatPercent(Math.abs(holding.dailyChangePercent))})
          </span>
        </span>
      </summary>

      <div className="tickerDetails">
        <div className="detailGrid">
          <span>Shares</span>
          <strong>{formatShares(holding.shares)}</strong>
          <span>Avg buy</span>
          <strong>{formatMoney(holding.buyPrice)}</strong>
          <span>Value</span>
          <strong>{formatMoney(holding.currentValue)}</strong>
          <span>P/L</span>
          <strong className={tone(holding.profit)}>
            {formatMoney(holding.profit)} ({formatPercent(holding.profitPercent)})
          </strong>
        </div>

        {holding.ticker === "CASH" ? (
          <p className="muted">Cash is tracked as uninvested account value.</p>
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
                    <td>{formatMoney(lot.buyPrice)}</td>
                    <td>{formatMoney(cost)}</td>
                    <td className={tone(profit)}>{formatMoney(profit)}</td>
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
        Allocation <span className="help" title="How your current account value is split across holdings. Cash is included.">?</span>
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

function HoldingValueChart({ holdings }: { holdings: Holding[] }) {
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
            <strong>{formatMoney(holding.currentValue)}</strong>
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

function TopBar({ activeTab }: { activeTab: Tab }) {
  return (
    <div className="topBar">
      <TabBar activeTab={activeTab} />
      <ThemeToggle />
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
  if (ticker === "CASH") {
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
                      </div>
                      <div>
                        <h3>{closed ? "Sell" : "Current"}</h3>
                        {closed ? (
                          lot.sellTransactions.map((transaction) => (
                            <p key={`${transaction.date}-${transaction.total}`}>
                              {transaction.date || "Unknown"} at {formatMoney(transaction.price)}:
                              {" "}{formatShares(transaction.quantity)} for {formatMoney(transaction.total)}
                            </p>
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
  return raw === "transactions" ? "transactions" : "home";
}

function oneParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
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

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const activeTab = normalizeTab(params.tab);
  const timeframe = normalizeTimeframe(params.range);

  if (activeTab === "research") {
    const symbol = normalizeResearchSymbol(params.symbol);
    const [quotes, history, research]: [
      Record<string, Quote>,
      PricePoint[],
      { profile: ResearchProfile | null; news: ResearchNewsItem[] },
    ] = symbol
      ? await Promise.all([
          fetchQuotes([symbol]),
          fetchPriceHistory([symbol], timeframe),
          fetchResearchOverview(symbol),
        ])
      : [{}, [] as PricePoint[], { profile: null, news: [] }];

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
        <InvestmentLots allLots={transactionLots} filters={lotFilters} lots={filteredLots} />
      </main>
    );
  }

  const lots = await loadLots();
  const tickers = Array.from(new Set(lots.map((lot) => lot.ticker)));
  const firstPurchaseDate = lots
    .map((lot) => parsePurchaseDate(lot.purchaseDate))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const [quotes, history] = await Promise.all([
    fetchQuotes(tickers),
    fetchPriceHistory(tickers, timeframe, firstPurchaseDate),
  ]);
  const holdings = aggregateLots(lots, quotes);
  const performance = buildPerformance(history, lots);

  const totalInvested = holdings.reduce((total, holding) => total + holding.invested, 0);
  const totalValue = holdings.reduce((total, holding) => total + holding.currentValue, 0);
  const previousValue = holdings.reduce((total, holding) => total + holding.previousValue, 0);
  const totalProfit = holdings.reduce((total, holding) => total + holding.profit, 0);
  const totalReturn = totalInvested ? (totalProfit / totalInvested) * 100 : 0;
  const dailyChange = totalValue - previousValue;
  const dailyChangePercent = previousValue ? (dailyChange / previousValue) * 100 : 0;

  return (
    <main>
      <TopBar activeTab={activeTab} />
      <header className="pageHeader">
        <div>
          <h1>Personal Stock Tracker</h1>
          <p>A focused dashboard for your current portfolio.</p>
          <MarketStatus />
        </div>
        <span className="statusPill">Live market data</span>
      </header>

      <section className="metricsGrid">
        <MetricCard
          label="Total invested"
          value={formatMoney(totalInvested)}
          help="The total amount you put into open stock and crypto positions. Cash is excluded."
        />
        <MetricCard
          label="Portfolio value"
          value={formatMoney(totalValue)}
          delta={`${signed(dailyChange, formatMoney)} today`}
          deltaValue={dailyChange}
          help="The current value of all holdings, including uninvested cash."
        />
        <MetricCard
          label="Profit / loss"
          value={formatMoney(totalProfit)}
          valueTone={tone(totalProfit)}
          delta={`${signed(dailyChange, formatMoney)} today`}
          deltaValue={dailyChange}
          help="Unrealized profit or loss on open investments. It excludes cash and is not locked in until you sell."
        />
        <MetricCard
          label="Total return"
          value={formatPercent(totalReturn)}
          valueTone={tone(totalReturn)}
          delta={`${signed(dailyChangePercent, (value) => formatPercent(value))} today`}
          deltaValue={dailyChangePercent}
          help="Unrealized profit or loss divided by total invested capital."
        />
      </section>

      <PerformanceChart points={performance} timeframe={timeframe} />

      <section>
        <h2>Live price ticker</h2>
        <div className="tickerGrid">
          {holdings.map((holding) => (
            <LiveTicker key={holding.ticker} holding={holding} lots={lots} />
          ))}
        </div>
      </section>

      <div className="dashboardGrid">
        <HoldingValueChart holdings={holdings} />
        <AllocationTable holdings={holdings} />
      </div>
    </main>
  );
}
