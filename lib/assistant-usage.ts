import { getDashboardDb } from "./mongodb";
import { geminiQuotaSummary, pacificDayStart } from "./gemini-quota";

export type GeminiUsageRecord = {
  createdAt: Date;
  inputTokens: number;
  model: string;
  outputTokens: number;
  status: "success";
  totalTokens: number;
};

export type GeminiUsageSummary = {
  quotas: Awaited<ReturnType<typeof geminiQuotaSummary>>;
  lastRequestAt: string | null;
  lastSevenDays: {
    requests: number;
    tokens: number;
  };
  models: Array<{
    model: string;
    requests: number;
    tokens: number;
  }>;
  today: {
    inputTokens: number;
    outputTokens: number;
    requests: number;
    tokens: number;
  };
};

export async function recordGeminiUsage(record: Omit<GeminiUsageRecord, "createdAt" | "status">) {
  try {
    const db = await getDashboardDb();
    await db.collection<GeminiUsageRecord>("assistant_usage").insertOne({
      ...record,
      createdAt: new Date(),
      status: "success",
    });
  } catch {
    // Usage tracking should never block an assistant response.
  }
}

export async function getGeminiUsageSummary(): Promise<GeminiUsageSummary> {
  const db = await getDashboardDb();
  const collection = db.collection<GeminiUsageRecord>("assistant_usage");
  const todayStart = pacificDayStart();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [todayRows, sevenDayRows, modelRows, lastRow] = await Promise.all([
    collection
      .aggregate<GeminiUsageSummary["today"]>([
        { $match: { createdAt: { $gte: todayStart }, status: "success" } },
        {
          $group: {
            _id: null,
            inputTokens: { $sum: "$inputTokens" },
            outputTokens: { $sum: "$outputTokens" },
            requests: { $sum: 1 },
            tokens: { $sum: "$totalTokens" },
          },
        },
        { $project: { _id: 0, inputTokens: 1, outputTokens: 1, requests: 1, tokens: 1 } },
      ])
      .toArray(),
    collection
      .aggregate<GeminiUsageSummary["lastSevenDays"]>([
        { $match: { createdAt: { $gte: sevenDaysAgo }, status: "success" } },
        {
          $group: {
            _id: null,
            requests: { $sum: 1 },
            tokens: { $sum: "$totalTokens" },
          },
        },
        { $project: { _id: 0, requests: 1, tokens: 1 } },
      ])
      .toArray(),
    collection
      .aggregate<GeminiUsageSummary["models"][number]>([
        { $match: { createdAt: { $gte: sevenDaysAgo }, status: "success" } },
        {
          $group: {
            _id: "$model",
            requests: { $sum: 1 },
            tokens: { $sum: "$totalTokens" },
          },
        },
        { $sort: { requests: -1 } },
        { $limit: 4 },
        { $project: { _id: 0, model: "$_id", requests: 1, tokens: 1 } },
      ])
      .toArray(),
    collection.find({ status: "success" }).sort({ createdAt: -1 }).limit(1).toArray(),
  ]);

  return {
    quotas: await geminiQuotaSummary(),
    lastRequestAt: lastRow[0]?.createdAt?.toISOString() ?? null,
    lastSevenDays: sevenDayRows[0] ?? { requests: 0, tokens: 0 },
    models: modelRows,
    today: todayRows[0] ?? { inputTokens: 0, outputTokens: 0, requests: 0, tokens: 0 },
  };
}
