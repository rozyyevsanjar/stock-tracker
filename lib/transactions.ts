import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Quote, Transaction, TransactionInsight, TransactionLot } from "./types";

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

export async function loadTransactions(): Promise<Transaction[]> {
  const filePath = path.join(process.cwd(), "data", "transactions.csv");
  const content = await readFile(filePath, "utf8");
  const [headerLine, ...rows] = content.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine);

  return rows
    .filter((row) => row.trim())
    .map((row) => {
      const values = splitCsvLine(row);
      const record = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );
      const quantity = parseNumber(record.quantity);
      const price = parseNumber(record.price);
      const fees = parseNumber(record.fees);
      const enteredTotal = parseNumber(record.total);
      const type = String(record.type ?? "").toUpperCase().trim();
      const total =
        enteredTotal ||
        (type === "SELL" ? quantity * price - fees : quantity * price + fees);

      return {
        id: String(record.transaction_id ?? record.id ?? "").trim(),
        date: String(record.date ?? "").trim(),
        type,
        ticker: String(record.ticker ?? "").toUpperCase().trim(),
        company: String(record.company ?? "").trim(),
        quantity,
        price,
        fees,
        total,
        currency: String(record.currency ?? "USD").trim() || "USD",
        account: String(record.account ?? "").trim(),
        lotId: String(record.lot_id ?? "").trim(),
        linkedLotId: String(record.linked_lot_id ?? record.sold_lot_id ?? "").trim(),
        notes: String(record.notes ?? "").trim(),
      };
    })
    .filter(
      (transaction) =>
        transaction.date ||
        transaction.type ||
        transaction.ticker ||
        transaction.quantity ||
        transaction.price ||
        transaction.total,
    );
}

type OpenLot = {
  cost: number;
  id: string;
  quantity: number;
  ticker: string;
};

function cashImpact(transaction: Transaction) {
  if (transaction.type === "SELL" || transaction.type === "DIVIDEND" || transaction.type === "DEPOSIT") {
    return transaction.total;
  }
  if (transaction.type === "BUY" || transaction.type === "WITHDRAWAL" || transaction.type === "FEE") {
    return -transaction.total;
  }
  return 0;
}

function buildLotId(transaction: Transaction, index: number) {
  return transaction.lotId || transaction.id || `${transaction.ticker || "LOT"}-${index + 1}`;
}

export function buildTransactionInsights(transactions: Transaction[]): TransactionInsight[] {
  const openLots: OpenLot[] = [];

  return transactions.map((transaction, index) => {
    if (transaction.type === "BUY") {
      openLots.push({
        cost: transaction.total,
        id: buildLotId(transaction, index),
        quantity: transaction.quantity,
        ticker: transaction.ticker,
      });

      return {
        ...transaction,
        cashImpact: cashImpact(transaction),
        matchMethod: "n/a",
        realizedProfit: null,
        unmatchedQuantity: 0,
      };
    }

    if (transaction.type !== "SELL") {
      return {
        ...transaction,
        cashImpact: cashImpact(transaction),
        matchMethod: transaction.type === "DIVIDEND" || transaction.type === "DEPOSIT" || transaction.type === "WITHDRAWAL" || transaction.type === "FEE" ? "cash" : "n/a",
        realizedProfit: null,
        unmatchedQuantity: 0,
      };
    }

    let remainingToSell = transaction.quantity;
    let matchedCost = 0;
    const lotsToUse = transaction.linkedLotId
      ? openLots.filter((lot) => lot.id === transaction.linkedLotId && lot.ticker === transaction.ticker)
      : openLots.filter((lot) => lot.ticker === transaction.ticker);

    for (const lot of lotsToUse) {
      if (remainingToSell <= 0) break;
      if (lot.quantity <= 0) continue;

      const soldFromLot = Math.min(lot.quantity, remainingToSell);
      const costPerShare = lot.quantity ? lot.cost / lot.quantity : 0;
      matchedCost += soldFromLot * costPerShare;
      lot.quantity -= soldFromLot;
      lot.cost -= soldFromLot * costPerShare;
      remainingToSell -= soldFromLot;
    }

    const matchedQuantity = transaction.quantity - remainingToSell;
    const matchedProceeds = transaction.quantity
      ? transaction.total * (matchedQuantity / transaction.quantity)
      : 0;
    const realizedProfit = matchedQuantity ? matchedProceeds - matchedCost : null;

    return {
      ...transaction,
      cashImpact: cashImpact(transaction),
      matchMethod: transaction.linkedLotId ? "linked lot" : "FIFO",
      realizedProfit,
      unmatchedQuantity: remainingToSell,
    };
  });
}

type MutableTransactionLot = TransactionLot & {
  remainingCost: number;
};

export function buildTransactionLots(
  transactions: Transaction[],
  quotes: Record<string, Quote> = {},
): TransactionLot[] {
  const lots: MutableTransactionLot[] = [];
  const lotsById = new Map<string, MutableTransactionLot>();

  transactions.forEach((transaction, index) => {
    if (transaction.type !== "BUY") return;

    const id = buildLotId(transaction, index);
    const lot: MutableTransactionLot = {
      id,
      ticker: transaction.ticker,
      company: transaction.company,
      status: "open",
      buyDate: transaction.date,
      buyQuantity: transaction.quantity,
      remainingQuantity: transaction.quantity,
      soldQuantity: 0,
      buyPrice: transaction.price,
      buyFees: transaction.fees,
      buyTotal: transaction.total,
      sellTransactions: [],
      sellProceeds: 0,
      averageSellPrice: null,
      currentPrice: null,
      currentValue: 0,
      realizedProfit: 0,
      unrealizedProfit: 0,
      profit: 0,
      profitPercent: 0,
      priceSource: "Unavailable",
      remainingCost: transaction.total,
    };

    lots.push(lot);
    lotsById.set(id, lot);
  });

  for (const transaction of transactions) {
    if (transaction.type !== "SELL") continue;

    let remainingToMatch = transaction.quantity;
    const matchingLots = transaction.linkedLotId
      ? [lotsById.get(transaction.linkedLotId)].filter((lot): lot is MutableTransactionLot => Boolean(lot))
      : lots.filter((lot) => lot.ticker === transaction.ticker && lot.remainingQuantity > 0);

    for (const lot of matchingLots) {
      if (remainingToMatch <= 0 || lot.remainingQuantity <= 0) break;

      const matchedQuantity = Math.min(remainingToMatch, lot.remainingQuantity);
      const quantityRatio = transaction.quantity ? matchedQuantity / transaction.quantity : 0;
      const proceeds = transaction.total * quantityRatio;
      const costPerShare = lot.remainingQuantity ? lot.remainingCost / lot.remainingQuantity : 0;
      const matchedCost = matchedQuantity * costPerShare;

      lot.sellTransactions.push(transaction);
      lot.soldQuantity += matchedQuantity;
      lot.remainingQuantity -= matchedQuantity;
      lot.remainingCost -= matchedCost;
      lot.sellProceeds += proceeds;
      lot.realizedProfit += proceeds - matchedCost;
      remainingToMatch -= matchedQuantity;
    }
  }

  return lots.map((lot) => {
    const { remainingCost, ...publicLot } = lot;
    const quote = quotes[lot.ticker];
    const currentPrice = quote?.price ?? null;
    const currentValue = currentPrice ? lot.remainingQuantity * currentPrice : 0;
    const unrealizedProfit = currentPrice ? currentValue - lot.remainingCost : 0;
    const profit = lot.realizedProfit + unrealizedProfit;
    const closed = lot.remainingQuantity <= 0.00000001;
    const investedBasis = lot.buyTotal || 0;

    return {
      ...publicLot,
      status: closed ? "closed" : "open",
      remainingQuantity: closed ? 0 : lot.remainingQuantity,
      averageSellPrice: lot.soldQuantity ? lot.sellProceeds / lot.soldQuantity : null,
      currentPrice,
      currentValue,
      unrealizedProfit,
      profit,
      profitPercent: investedBasis ? (profit / investedBasis) * 100 : 0,
      priceSource: currentPrice ? quote?.source ?? "Live quote" : "Unavailable",
    };
  });
}
