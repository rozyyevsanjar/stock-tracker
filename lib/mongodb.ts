import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

let cachedClient: MongoClient | null = null;
let cachedPromise: Promise<MongoClient> | null = null;

export async function getMongoClient() {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (cachedClient) return cachedClient;
  if (!cachedPromise) {
    cachedPromise = new MongoClient(uri, {
      serverSelectionTimeoutMS: 3000,
    }).connect();
  }

  cachedClient = await cachedPromise;
  return cachedClient;
}

export async function getDashboardDb() {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB || "stock_tracker");
}
