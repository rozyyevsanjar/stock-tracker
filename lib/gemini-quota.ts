import { getDashboardDb } from "./mongodb";

// Limits from this project's AI Studio free-tier dashboard.
export const GEMINI_LIMITS = [
  { model: "gemini-3.1-flash-lite", rpm: 15, tpm: 250000, rpd: 500 },
  { model: "gemini-3.5-flash", rpm: 5, tpm: 250000, rpd: 20 },
  { model: "gemini-3.6-flash", rpm: 5, tpm: 250000, rpd: 20 },
  { model: "gemini-2.5-flash", rpm: 5, tpm: 250000, rpd: 20 },
  { model: "gemini-2.5-flash-lite", rpm: 10, tpm: 250000, rpd: 20 },
];

export function pacificDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
}

export function pacificDayStart() {
  const day = pacificDay();
  let start = new Date(`${day}T00:00:00Z`);
  while (pacificDay(start) !== day) start = new Date(start.getTime() + 3600000);
  return start;
}

type QuotaBucket = {
  _id: string;
  requests: number;
  attempts: Array<{ at: Date; tokens: number }>;
  blockedUntil?: Date;
};

export async function reserveGeminiRequest(model: string, inputTokens: number) {
  const limit = GEMINI_LIMITS.find((item) => item.model === model)!;
  const db = await getDashboardDb();
  const buckets = db.collection<QuotaBucket>("assistant_quota");
  const id = `${pacificDay()}:${model}`;
  const legacyCount = await db.collection("assistant_usage").countDocuments({
    model, createdAt: { $gte: pacificDayStart() },
  });
  await buckets.updateOne({ _id: id }, {
    $setOnInsert: { requests: legacyCount, attempts: [] },
  }, { upsert: true });
  const recent = { $filter: { input: "$attempts", as: "attempt", cond: {
    $gt: ["$$attempt.at", new Date(Date.now() - 60000)],
  } } };
  // A single conditional update reserves capacity across simultaneous browsers.
  return Boolean(await buckets.findOneAndUpdate({
    _id: id,
    requests: { $lt: limit.rpd },
    $or: [{ blockedUntil: { $exists: false } }, { blockedUntil: { $lte: new Date() } }],
    $expr: { $and: [
      { $lt: [{ $size: recent }, limit.rpm] },
      { $lte: [{ $add: [{ $sum: { $map: { input: recent, as: "r", in: "$$r.tokens" } } }, inputTokens] }, limit.tpm] },
    ] },
  }, { $inc: { requests: 1 }, $push: { attempts: { at: new Date(), tokens: inputTokens } } }));
}

export async function rememberGeminiLimit(model: string, data: Record<string, unknown>) {
  const error = data.error as { details?: Array<{ violations?: Array<{ quotaId?: string }>; retryDelay?: string }> } | undefined;
  const daily = error?.details?.some((detail) => detail.violations?.some((v) => /PerDay/i.test(v.quotaId ?? "")));
  const delay = error?.details?.find((d) => d.retryDelay)?.retryDelay;
  const seconds = Number.parseFloat(delay ?? "60");
  const blockedUntil = daily
    ? new Date(pacificDayStart().getTime() + 26 * 3600000)
    : new Date(Date.now() + (Number.isFinite(seconds) ? Math.max(seconds, 60) : 60) * 1000);
  const db = await getDashboardDb();
  await db.collection<QuotaBucket>("assistant_quota").updateOne(
    { _id: `${pacificDay()}:${model}` }, { $set: { blockedUntil } },
  );
}

export async function geminiQuotaSummary() {
  const db = await getDashboardDb();
  const buckets = await db.collection<QuotaBucket>("assistant_quota")
    .find({ _id: { $in: GEMINI_LIMITS.map((l) => `${pacificDay()}:${l.model}`) } }).toArray();
  return Promise.all(GEMINI_LIMITS.map(async (limit) => {
    const bucket = buckets.find((b) => b._id === `${pacificDay()}:${limit.model}`);
    const recent = bucket?.attempts.filter((a) => a.at.getTime() > Date.now() - 60000) ?? [];
    const requests = bucket?.requests ?? await db.collection("assistant_usage").countDocuments({ model: limit.model, createdAt: { $gte: pacificDayStart() } });
    return { ...limit, requests, minuteRequests: recent.length,
      minuteTokens: recent.reduce((sum, a) => sum + a.tokens, 0),
      blocked: Boolean(bucket?.blockedUntil && bucket.blockedUntil > new Date()) };
  }));
}
