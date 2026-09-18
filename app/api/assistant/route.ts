import { NextResponse } from "next/server";
import { buildTransactionLots, loadTransactions } from "@/lib/transactions";
import { loadTrackerPositions } from "@/lib/tracker";

export const runtime = "nodejs";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

const SAVINGS_BALANCE_AED = 60163;
const SAVINGS_INTEREST_RATE = 3.5;

function validMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const role = record.role === "assistant" ? "assistant" : "user";
      const text = String(record.text ?? "").trim();
      return text ? { role, text } : null;
    })
    .filter((item): item is ChatMessage => Boolean(item))
    .slice(-8);
}

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

async function portfolioContext() {
  const [transactions, trackerPositions] = await Promise.all([
    loadTransactions(),
    loadTrackerPositions(),
  ]);
  const lots = buildTransactionLots(transactions);
  const openLots = lots.filter((lot) => lot.status === "open");
  const closedLots = lots.filter((lot) => lot.status === "closed");
  const openValue = openLots.reduce((total, lot) => total + lot.currentValue, 0);
  const totalLotProfit = lots.reduce((total, lot) => total + lot.profit, 0);

  const tracked = trackerPositions.map((position) => {
    const currency = position.priceCurrency || position.valueCurrency || "USD";
    const currentValue =
      position.snapshotValue ?? position.quantity * (position.snapshotPrice ?? position.avgPrice);
    const costBasis = position.quantity * position.avgPrice;
    const profit = position.snapshotPl ?? currentValue - costBasis;

    return [
      position.asset,
      `ticker ${position.ticker}`,
      `${position.quantity} ${position.unit}`,
      `avg ${formatMoney(position.avgPrice, currency)}`,
      `snapshot value ${formatMoney(currentValue, position.valueCurrency || currency)}`,
      `snapshot P/L ${formatMoney(profit, position.plCurrency || currency)}`,
      position.notes ? `notes: ${position.notes}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  });

  const lotLines = openLots.slice(0, 20).map((lot) =>
    [
      lot.company,
      `ticker ${lot.ticker}`,
      `remaining ${lot.remainingQuantity}`,
      `buy ${formatMoney(lot.buyPrice)}`,
      `current value ${formatMoney(lot.currentValue)}`,
      `P/L ${formatMoney(lot.profit)}`,
      `status ${lot.status}`,
    ].join("; "),
  );

  return [
    "Dashboard context:",
    "The visible Home dashboard excludes the uninvested cash bucket.",
    `Savings: ${formatMoney(SAVINGS_BALANCE_AED, "AED")} at ${SAVINGS_INTEREST_RATE}% yearly interest. Estimated yearly interest: ${formatMoney(SAVINGS_BALANCE_AED * (SAVINGS_INTEREST_RATE / 100), "AED")}.`,
    `Open transaction lots: ${openLots.length}. Closed lots: ${closedLots.length}.`,
    `Open lot value from transaction history: ${formatMoney(openValue)}.`,
    `Total lot P/L from transaction history: ${formatMoney(totalLotProfit)}.`,
    "Tracked positions, including tracker-only assets, metals, and savings-related context:",
    ...tracked,
    "Open lots from transaction history:",
    ...lotLines,
  ].join("\n");
}

function geminiContents(messages: ChatMessage[], context: string) {
  const systemText = [
    "You are the user's private portfolio assistant inside their personal dashboard.",
    "Use the provided dashboard context first. Be concise, practical, and clear.",
    "Do not claim you can place trades. Do not invent live prices beyond the context.",
    "This is personal finance information, not professional financial advice.",
    context,
  ].join("\n\n");

  return [
    {
      role: "user",
      parts: [{ text: systemText }],
    },
    {
      role: "model",
      parts: [{ text: "Understood. I will answer using the dashboard context and keep it practical." }],
    },
    ...messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.text }],
    })),
  ];
}

function geminiText(data: Record<string, unknown>) {
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
  const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  return parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim() ?? "";
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini is not configured yet. Add GEMINI_API_KEY to the environment." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const messages = validMessages((body as Record<string, unknown> | null)?.messages);
  if (!messages.length) {
    return NextResponse.json({ error: "Send a message first." }, { status: 400 });
  }

  const context = await portfolioContext();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      body: JSON.stringify({
        contents: geminiContents(messages, context),
        generationConfig: {
          maxOutputTokens: 900,
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      (data as { error?: { message?: string } }).error?.message ??
      "Gemini could not answer right now.";
    return NextResponse.json({ error: message }, { status: response.status });
  }

  const answer = geminiText(data as Record<string, unknown>);
  if (!answer) {
    return NextResponse.json({ error: "Gemini returned an empty response." }, { status: 502 });
  }

  return NextResponse.json({ answer });
}
