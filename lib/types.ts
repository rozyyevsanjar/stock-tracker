export type Lot = {
  ticker: string;
  company: string;
  purchaseDate: string;
  shares: number;
  buyPrice: number;
  fees: number;
  notes: string;
};

export type Quote = {
  price: number | null;
  previousPrice: number | null;
  dailyChange: number | null;
  dailyChangePercent: number | null;
  source: string;
};

export type Holding = {
  ticker: string;
  company: string;
  shares: number;
  buyPrice: number;
  invested: number;
  fees: number;
  lots: number;
  currentPrice: number;
  previousPrice: number;
  dailyChange: number;
  dailyChangePercent: number;
  currentValue: number;
  previousValue: number;
  valueDailyChange: number;
  profit: number;
  profitPercent: number;
  allocationPercent: number;
  priceSource: string;
};

export type PricePoint = {
  date: string;
  price: number;
  ticker: string;
};

export type PerformancePoint = {
  date: string;
  marketValue: number;
  invested: number;
  profit: number;
  returnPercent: number;
};

export type ResearchProfile = {
  symbol: string;
  name: string;
  description: string;
  fundamentals?: ResearchFundamentals;
  logoUrl?: string;
  source: string;
  sourceUrl: string;
  sector?: string;
  industry?: string;
  website?: string;
};

export type ResearchFundamentals = {
  dividend?: {
    annualDividend?: string;
    exDividendDate?: string;
    latestAmount?: string;
    paymentDate?: string;
    source: string;
    sourceUrl: string;
    yield?: string;
  };
  earnings?: {
    consensusForecast?: string;
    eps?: string;
    fiscalQuarter?: string;
    lastReportDate?: string;
    nextReportDateEstimate?: string;
    source: string;
    sourceUrl: string;
    surprise?: string;
  };
};

export type ResearchNewsItem = {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  thumbnail?: string;
};

export type HoldingPerformance = {
  ticker: string;
  marketValue: number;
  invested: number;
  profit: number;
  returnPercent: number;
};

export type TransactionType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "SPLIT";

export type Transaction = {
  id: string;
  date: string;
  type: TransactionType | string;
  ticker: string;
  company: string;
  quantity: number;
  price: number;
  fees: number;
  total: number;
  currency: string;
  account: string;
  lotId: string;
  linkedLotId: string;
  notes: string;
};

export type TransactionInsight = Transaction & {
  cashImpact: number;
  matchMethod: "linked lot" | "FIFO" | "cash" | "n/a";
  realizedProfit: number | null;
  unmatchedQuantity: number;
};

export type TransactionLot = {
  id: string;
  ticker: string;
  company: string;
  status: "open" | "closed";
  buyDate: string;
  buyQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  buyPrice: number;
  buyFees: number;
  buyTotal: number;
  sellTransactions: Transaction[];
  sellProceeds: number;
  averageSellPrice: number | null;
  currentPrice: number | null;
  currentValue: number;
  realizedProfit: number;
  unrealizedProfit: number;
  profit: number;
  profitPercent: number;
  priceSource: string;
};
