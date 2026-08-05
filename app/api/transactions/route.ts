import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { transactionTotal } from "@/lib/transactions";

function parseNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function lotDateKey(csvDate: string) {
  const [day, month, year] = csvDate.split(/[/-]/);
  return `${year}${month?.padStart(2, "0")}${day?.padStart(2, "0")}`;
}

function buildLotId({
  date,
  rows,
  ticker,
}: {
  date: string;
  rows: string[];
  ticker: string;
}) {
  const dateKey = lotDateKey(date);
  const prefix = `${ticker}-${dateKey}`;
  const count =
    rows.filter((row) => {
      const values = splitCsvLine(row);
      return values[1]?.toUpperCase() === "BUY" && values[2]?.toUpperCase() === ticker && values[11]?.startsWith(prefix);
    }).length + 1;
  return `${prefix}-${String(count).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid transaction create request." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const date = formatCsvDate(record.date);
  const ticker = String(record.ticker ?? "").toUpperCase().trim();
  const company = String(record.company ?? "").trim();
  const quantity = parseNumber(record.quantity);
  const price = parseNumber(record.price);
  const fees = parseNumber(record.fees) ?? 0;

  if (!date || !ticker || !quantity || !price) {
    return NextResponse.json(
      { error: "Date, ticker, quantity, and buy price are required." },
      { status: 400 },
    );
  }

  if (quantity <= 0 || price <= 0 || fees < 0) {
    return NextResponse.json(
      { error: "Quantity and buy price must be positive. Fees cannot be negative." },
      { status: 400 },
    );
  }

  const filePath = path.join(process.cwd(), "data", "transactions.csv");
  const content = await readFile(filePath, "utf8");
  const lines = content.trimEnd().split(/\r?\n/);
  const [headerLine, ...rows] = lines;
  const lotId = buildLotId({ date, rows, ticker });
  const total = transactionTotal({ fees, price, quantity, type: "BUY" });
  const row = [
    date,
    "BUY",
    ticker,
    company || ticker,
    quantity,
    price,
    fees,
    total.toFixed(2),
    String(record.currency ?? "$").trim() || "$",
    String(record.account ?? "Main").trim() || "Main",
    String(record.notes ?? "").trim(),
    lotId,
    "",
  ]
    .map(csvEscape)
    .join(",");

  await writeFile(filePath, `${[headerLine, ...rows, row].join("\n")}\n`, "utf8");

  return NextResponse.json({ ok: true, lotId, total });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid transaction update." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const rowIndex = parseNumber(record.rowIndex);
  const date = formatCsvDate(record.date);
  const type = String(record.type ?? "").toUpperCase().trim();
  const ticker = String(record.ticker ?? "").toUpperCase().trim();
  const quantity = parseNumber(record.quantity);
  const price = parseNumber(record.price);
  const fees = parseNumber(record.fees) ?? 0;
  const enteredTotal = parseNumber(record.total);

  if (rowIndex === null || rowIndex < 0 || !Number.isInteger(rowIndex)) {
    return NextResponse.json({ error: "A valid transaction row is required." }, { status: 400 });
  }

  if (!date || !type || !ticker || quantity === null || price === null) {
    return NextResponse.json(
      { error: "Date, type, ticker, quantity, and price are required." },
      { status: 400 },
    );
  }

  if (quantity < 0 || price < 0 || fees < 0) {
    return NextResponse.json(
      { error: "Quantity, price, and fees cannot be negative." },
      { status: 400 },
    );
  }

  const total = transactionTotal({
    fees,
    price,
    quantity,
    total: enteredTotal ?? undefined,
    type,
  });
  const filePath = path.join(process.cwd(), "data", "transactions.csv");
  const content = await readFile(filePath, "utf8");
  const lines = content.trimEnd().split(/\r?\n/);
  const [headerLine, ...rows] = lines;
  const headers = splitCsvLine(headerLine);

  if (!rows[rowIndex]) {
    return NextResponse.json({ error: "Transaction row was not found." }, { status: 404 });
  }

  const existingValues = splitCsvLine(rows[rowIndex]);
  const nextRecord = Object.fromEntries(
    headers.map((header, index) => [header, existingValues[index] ?? ""]),
  );

  Object.assign(nextRecord, {
    account: String(record.account ?? nextRecord.account ?? "Main").trim() || "Main",
    company: String(record.company ?? "").trim(),
    currency: String(record.currency ?? nextRecord.currency ?? "$").trim() || "$",
    date,
    fees: String(fees),
    linked_lot_id: String(record.linkedLotId ?? nextRecord.linked_lot_id ?? "").trim(),
    lot_id: String(record.lotId ?? nextRecord.lot_id ?? "").trim(),
    notes: String(record.notes ?? "").trim(),
    price: String(price),
    quantity: String(quantity),
    ticker,
    total: total.toFixed(2),
    type,
  });

  rows[rowIndex] = headers.map((header) => csvEscape(nextRecord[header])).join(",");
  await writeFile(filePath, `${[headerLine, ...rows].join("\n")}\n`, "utf8");

  return NextResponse.json({ ok: true, rowIndex });
}
