"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";
import type { Transaction } from "@/lib/types";

function toInputDate(value: string) {
  const [day, month, year] = value.split(/[/-]/);
  if (!day || !month || !year) return "";
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function TransactionEditForm({ transaction }: { transaction: Transaction }) {
  const router = useRouter();
  const [date, setDate] = useState(toInputDate(transaction.date));
  const [type, setType] = useState(transaction.type);
  const [ticker, setTicker] = useState(transaction.ticker);
  const [company, setCompany] = useState(transaction.company);
  const [quantity, setQuantity] = useState(String(transaction.quantity));
  const [price, setPrice] = useState(String(transaction.price));
  const [fees, setFees] = useState(String(transaction.fees));
  const [manualTotal, setManualTotal] = useState(String(transaction.total));
  const [account, setAccount] = useState(transaction.account || "Main");
  const [notes, setNotes] = useState(transaction.notes);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const estimatedTotal = useMemo(() => {
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(price);
    const parsedFees = Number(fees);
    if (!Number.isFinite(parsedQuantity) || !Number.isFinite(parsedPrice)) return null;
    const feeValue = Number.isFinite(parsedFees) ? parsedFees : 0;
    return type === "SELL"
      ? parsedQuantity * parsedPrice - feeValue
      : parsedQuantity * parsedPrice + feeValue;
  }, [fees, price, quantity, type]);
  const totalIsAutomatic = type === "BUY" || type === "SELL";

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const response = await fetch("/api/transactions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account,
        company,
        currency: transaction.currency || "$",
        date,
        fees,
        linkedLotId: transaction.linkedLotId,
        lotId: transaction.lotId,
        notes,
        price,
        quantity,
        rowIndex: transaction.rowIndex,
        ticker,
        total: totalIsAutomatic ? undefined : manualTotal,
        type,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(result.error ?? "Could not update this transaction.");
      return;
    }

    setMessage("Transaction updated. Refreshing...");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <details className="transactionEdit">
      <summary>Edit transaction</summary>
      <form onSubmit={submitEdit}>
        <label>
          Date
          <input onChange={(event) => setDate(event.target.value)} required type="date" value={date} />
        </label>
        <label>
          Type
          <select onChange={(event) => setType(event.target.value)} required value={type}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
            <option value="DIVIDEND">DIVIDEND</option>
            <option value="DEPOSIT">DEPOSIT</option>
            <option value="WITHDRAWAL">WITHDRAWAL</option>
            <option value="FEE">FEE</option>
            <option value="SPLIT">SPLIT</option>
          </select>
        </label>
        <label>
          Ticker
          <input onChange={(event) => setTicker(event.target.value.toUpperCase())} required value={ticker} />
        </label>
        <label>
          Company
          <input onChange={(event) => setCompany(event.target.value)} value={company} />
        </label>
        <label>
          Quantity
          <input min="0" onChange={(event) => setQuantity(event.target.value)} required step="any" type="number" value={quantity} />
        </label>
        <label>
          Price
          <input min="0" onChange={(event) => setPrice(event.target.value)} required step="any" type="number" value={price} />
        </label>
        <label>
          Fees
          <input min="0" onChange={(event) => setFees(event.target.value)} step="any" type="number" value={fees} />
        </label>
        <label>
          Total
          <input
            min="0"
            onChange={(event) => setManualTotal(event.target.value)}
            readOnly={totalIsAutomatic}
            step="any"
            type="number"
            value={totalIsAutomatic && estimatedTotal !== null ? estimatedTotal.toFixed(2) : manualTotal}
          />
        </label>
        <label>
          Account
          <input onChange={(event) => setAccount(event.target.value)} value={account} />
        </label>
        <label className="transactionEditNotes">
          Notes
          <textarea onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
        </label>
        <div className="transactionEditActions">
          <span>
            {totalIsAutomatic ? "Auto total" : "Estimate"}{" "}
            <strong>{estimatedTotal === null ? "-" : formatMoney(estimatedTotal)}</strong>
          </span>
          <button disabled={isPending} type="submit">
            {isPending ? "Saving..." : "Save changes"}
          </button>
        </div>
        {message ? <p className="formMessage">{message}</p> : null}
      </form>
    </details>
  );
}
