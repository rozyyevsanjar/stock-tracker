# MongoDB Migration Guide

## Recommended Path

Keep `data/transactions.csv` as the manual source for now, then migrate in stages:

1. Add MongoDB connection settings.
2. Import the CSV into a `transactions` collection.
3. Read transaction history from MongoDB instead of the CSV.
4. Add app forms for creating and editing transactions.
5. Optionally cache derived portfolio snapshots later.

## Environment

Use MongoDB Atlas or a local MongoDB instance. Add this to `.env.local`:

```bash
MONGODB_URI="mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/portfolio?retryWrites=true&w=majority"
MONGODB_DB="portfolio"
```

Do not commit `.env.local`.

## Transaction Document Shape

Use transactions as the source of truth. Lots are derived from buy/sell rows.

```ts
type Transaction = {
  _id: ObjectId;
  date: Date;
  type: "BUY" | "SELL" | "DIVIDEND" | "DEPOSIT" | "WITHDRAWAL" | "FEE" | "SPLIT";
  ticker: string;
  company: string;
  quantity: number;
  price: number;
  fees: number;
  total: number;
  currency: string;
  account: string;
  notes: string;
  lotId?: string;        // set on BUY rows
  linkedLotId?: string;  // set on SELL rows
  createdAt: Date;
  updatedAt: Date;
};
```

## Indexes

Create these indexes:

```js
db.transactions.createIndex({ date: -1 });
db.transactions.createIndex({ ticker: 1, date: 1 });
db.transactions.createIndex({ lotId: 1 }, { sparse: true });
db.transactions.createIndex({ linkedLotId: 1 }, { sparse: true });
db.transactions.createIndex({ account: 1, date: -1 });
```

## Import Strategy

Start with an import script that reads `data/transactions.csv` and upserts by a stable key:

```ts
const stableKey = [
  row.date,
  row.type,
  row.ticker,
  row.quantity,
  row.price,
  row.total,
  row.lot_id,
  row.linked_lot_id,
].join("|");
```

Store that as `importKey` and create a unique index:

```js
db.transactions.createIndex({ importKey: 1 }, { unique: true });
```

That lets you run the import repeatedly while editing the CSV.

## When To Add A Lots Collection

Do not add one at first. Derive lots from transactions so there is one source of truth.

Add a separate `lots` or `portfolioSnapshots` collection only when:

- The transaction ledger gets large.
- Derived calculations become slow.
- You want historical daily snapshots.
- You add direct editing workflows and need cached summaries.
