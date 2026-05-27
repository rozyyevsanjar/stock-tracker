# Personal Stock Tracker

A Next.js dashboard for tracking a small personal portfolio. It reads local CSV data, fetches live market prices, and shows portfolio value, allocation, performance, transactions, and lot-level profit/loss.

## Features

- Live stock and crypto quotes from market APIs.
- Portfolio summary with invested value, current value, daily movement, and unrealized return.
- Holdings and allocation views.
- Performance chart with selectable time ranges.
- Transaction ledger support for buys, sells, dividends, deposits, withdrawals, fees, and linked lots.
- Lot closing workflow through the local API.
- Light/dark theme toggle and research tools.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful tabs can be opened with query params, for example:

```text
http://localhost:3000/?tab=transactions
```

## Data Files

The app expects local CSV files in the `data` directory.

Required for holdings:

```text
data/portfolio.csv
```

Required for the transactions tab:

```text
data/transactions.csv
```

Example files are included:

```text
data/portfolio.example.csv
data/transactions.example.csv
```

If you do not have the real CSV files yet, copy the example files and edit them:

```bash
cp data/portfolio.example.csv data/portfolio.csv
cp data/transactions.example.csv data/transactions.csv
```

Dates are written as `DD/MM/YYYY`. Crypto tickers use Yahoo-style symbols such as `ETH-USD`.

## Scripts

```bash
npm run dev
```

Runs the local development server.

```bash
npm run build
```

Builds the production app.

```bash
npm run start
```

Serves the production build.

```bash
npm run lint
```

Runs TypeScript validation with `tsc --noEmit`.

## Project Structure

```text
app/                  Next.js app routes, UI components, and API routes
data/                 Local portfolio and transaction CSV files
docs/                 Notes and migration guides
lib/                  Data loading, formatting, market, portfolio, and transaction logic
```

## MongoDB Migration

The app currently uses CSV files as the source of truth. See `docs/mongodb-migration.md` for a staged plan to migrate transactions into MongoDB later.

## Notes

- Market data depends on external APIs, so prices may be unavailable if a provider is down or rate-limited.
- Do not commit personal portfolio data or `.env.local` if you add environment variables later.
