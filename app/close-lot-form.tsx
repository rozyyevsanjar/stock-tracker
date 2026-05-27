"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, formatShares } from "@/lib/format";
import type { TransactionLot } from "@/lib/types";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function CloseLotForm({ lot }: { lot: TransactionLot }) {
  const router = useRouter();
  const [date, setDate] = useState(todayInputValue);
  const [quantity, setQuantity] = useState(String(lot.remainingQuantity));
  const [price, setPrice] = useState(lot.currentPrice ? String(lot.currentPrice) : "");
  const [fees, setFees] = useState("0");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const estimatedTotal = useMemo(() => {
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(price);
    const parsedFees = Number(fees);
    if (!Number.isFinite(parsedQuantity) || !Number.isFinite(parsedPrice)) return null;
    return parsedQuantity * parsedPrice - (Number.isFinite(parsedFees) ? parsedFees : 0);
  }, [fees, price, quantity]);

  async function submitClose(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const response = await fetch("/api/close-lot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "Main",
        company: lot.company,
        currency: "$",
        date,
        fees,
        linkedLotId: lot.id,
        notes,
        price,
        quantity,
        ticker: lot.ticker,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.error ?? "Could not record this close.");
      return;
    }

    setMessage("Close recorded. Refreshing lot status...");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <form className="closeLotForm" onSubmit={submitClose}>
      <div>
        <h3>Close this lot</h3>
        <p>
          Remaining {formatShares(lot.remainingQuantity)}
          {lot.currentPrice ? ` · live price ${formatMoney(lot.currentPrice)}` : ""}
        </p>
      </div>

      <label>
        Close date
        <input
          name="date"
          onChange={(event) => setDate(event.target.value)}
          required
          type="date"
          value={date}
        />
      </label>

      <label>
        Quantity sold
        <input
          min="0"
          name="quantity"
          onChange={(event) => setQuantity(event.target.value)}
          required
          step="any"
          type="number"
          value={quantity}
        />
      </label>

      <label>
        Sell price
        <input
          min="0"
          name="price"
          onChange={(event) => setPrice(event.target.value)}
          required
          step="any"
          type="number"
          value={price}
        />
      </label>

      <label>
        Fees
        <input
          min="0"
          name="fees"
          onChange={(event) => setFees(event.target.value)}
          step="any"
          type="number"
          value={fees}
        />
      </label>

      <label className="closeLotNotes">
        Notes
        <textarea
          name="notes"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional note from eToro"
          rows={2}
          value={notes}
        />
      </label>

      <div className="closeLotActions">
        <span>
          Estimated proceeds{" "}
          <strong>{estimatedTotal === null ? "-" : formatMoney(estimatedTotal)}</strong>
        </span>
        <button disabled={isPending} type="submit">
          {isPending ? "Recording..." : "Record close"}
        </button>
      </div>

      {message ? <p className="formMessage">{message}</p> : null}
    </form>
  );
}
