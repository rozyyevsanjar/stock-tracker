export function formatMoney(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number, digits = 2) {
  return `${value.toFixed(digits)}%`;
}

export function formatShares(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 8,
  }).format(value);
}

export function signed(value: number, formatter: (value: number) => string) {
  if (value > 0) return `↑ ${formatter(Math.abs(value))}`;
  if (value < 0) return `↓ ${formatter(Math.abs(value))}`;
  return formatter(0);
}
