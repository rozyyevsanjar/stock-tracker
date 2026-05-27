import { appendFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildTransactionLots, loadTransactions } from "@/lib/transactions";

function parseNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatCsvDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid close-lot request." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const date = formatCsvDate(record.date);
  const ticker = String(record.ticker ?? "").toUpperCase().trim();
  const company = String(record.company ?? "").trim();
  const linkedLotId = String(record.linkedLotId ?? "").trim();
  const quantity = parseNumber(record.quantity);
  const price = parseNumber(record.price);
  const fees = parseNumber(record.fees) ?? 0;

  if (!date || !ticker || !linkedLotId || !quantity || !price) {
    return NextResponse.json(
      { error: "Date, ticker, lot, quantity, and sell price are required." },
      { status: 400 },
    );
  }

  if (quantity <= 0 || price <= 0 || fees < 0) {
    return NextResponse.json(
      { error: "Quantity and sell price must be positive. Fees cannot be negative." },
      { status: 400 },
    );
  }

  const transactions = await loadTransactions();
  const lot = buildTransactionLots(transactions).find((item) => item.id === linkedLotId);

  if (!lot) {
    return NextResponse.json({ error: "The selected lot no longer exists." }, { status: 404 });
  }

  if (lot.status === "closed" || lot.remainingQuantity <= 0) {
    return NextResponse.json({ error: "This lot is already closed." }, { status: 409 });
  }

  if (lot.ticker !== ticker) {
    return NextResponse.json({ error: "Ticker does not match the selected lot." }, { status: 400 });
  }

  if (quantity - lot.remainingQuantity > 0.00000001) {
    return NextResponse.json(
      { error: `Quantity is higher than the remaining ${lot.remainingQuantity}.` },
      { status: 400 },
    );
  }

  const total = quantity * price - fees;
  const row = [
    date,
    "SELL",
    lot.ticker,
    company || lot.company,
    quantity,
    price,
    fees,
    total.toFixed(2),
    String(record.currency ?? "$").trim() || "$",
    String(record.account ?? "Main").trim() || "Main",
    String(record.notes ?? "").trim(),
    "",
    linkedLotId,
  ]
    .map(csvEscape)
    .join(",");

  const filePath = path.join(process.cwd(), "data", "transactions.csv");
  await appendFile(filePath, `\n${row}`, "utf8");

  return NextResponse.json({ ok: true, linkedLotId, total });
}
