"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function OpenLotForm() {
  const router = useRouter();
  const [date, setDate] = useState(todayInputValue);
  const [ticker, setTicker] = useState("");
  const [company, setCompany] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("0");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const estimatedCost = useMemo(() => {
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(price);
    const parsedFees = Number(fees);
    if (!Number.isFinite(parsedQuantity) || !Number.isFinite(parsedPrice)) return null;
    return parsedQuantity * parsedPrice + (Number.isFinite(parsedFees) ? parsedFees : 0);
  }, [fees, price, quantity]);

  async function submitOpen(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const response = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "Main",
        company,
        currency: "$",
        date,
        fees,
        notes,
        price,
        quantity,
        ticker,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.error ?? "Could not open this lot.");
      return;
    }

    setMessage(`Opened ${result.lotId}. Refreshing...`);
    setTicker("");
    setCompany("");
    setQuantity("");
    setPrice("");
    setFees("0");
    setNotes("");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <section>
      <div className="sectionHeader">
        <div>
          <h2>Open new lot</h2>
          <p className="sectionNote">
            Add a BUY transaction. Cash decreases by quantity times price plus fees.
          </p>
        </div>
      </div>

      <form className="openLotForm" onSubmit={submitOpen}>
        <label>
          Buy date
          <input onChange={(event) => setDate(event.target.value)} required type="date" value={date} />
        </label>
        <label>
          Ticker
          <input
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="AAPL, TSLA, ETH-USD"
            required
            value={ticker}
          />
        </label>
        <label>
          Company
          <input onChange={(event) => setCompany(event.target.value)} placeholder="Optional" value={company} />
        </label>
        <label>
          Quantity
          <input min="0" onChange={(event) => setQuantity(event.target.value)} required step="any" type="number" value={quantity} />
        </label>
        <label>
          Buy price
          <input min="0" onChange={(event) => setPrice(event.target.value)} required step="any" type="number" value={price} />
        </label>
        <label>
          Fees
          <input min="0" onChange={(event) => setFees(event.target.value)} step="any" type="number" value={fees} />
        </label>
        <label className="openLotNotes">
          Notes
          <textarea onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
        </label>
        <div className="openLotActions">
          <span>
            Estimated cost <strong>{estimatedCost === null ? "-" : formatMoney(estimatedCost)}</strong>
          </span>
          <button disabled={isPending} type="submit">
            {isPending ? "Opening..." : "Open lot"}
          </button>
        </div>
        {message ? <p className="formMessage">{message}</p> : null}
      </form>
    </section>
  );
}
