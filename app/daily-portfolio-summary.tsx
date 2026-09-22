"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type DailySummaryHolding = {
  ticker: string;
  company: string;
  currentValue: number;
  dailyChange: number;
  dailyChangePercent: number;
};

type SummaryResponse = {
  generatedAt: string;
  summary: string;
  sources: Array<{ publisher: string; title: string; url: string }>;
};

export function DailyPortfolioSummary({
  currency,
  holdings,
}: {
  currency: string;
  holdings: DailySummaryHolding[];
}) {
  const [briefing, setBriefing] = useState<SummaryResponse | null>(null);
  const [status, setStatus] = useState("Analyzing today’s portfolio...");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/daily-summary", {
      body: JSON.stringify({ currency, holdings }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Daily analysis is unavailable.");
        if (!cancelled) setBriefing(data);
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Daily analysis is unavailable.");
      });
    return () => { cancelled = true; };
  }, [currency, holdings]);

  return (
    <section className="dailyBriefing" aria-live="polite">
      <header>
        <div>
          <span>AI daily briefing</span>
          <h2>What moved your portfolio today</h2>
        </div>
        {briefing ? <time dateTime={briefing.generatedAt}>Updated {new Date(briefing.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}
      </header>
      {briefing ? (
        <>
          <div className="assistantMarkdown dailyBriefingText">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{briefing.summary}</ReactMarkdown>
          </div>
          {briefing.sources.length ? (
            <div className="dailyBriefingSources">
              {briefing.sources.slice(0, 4).map((source) => (
                <a href={source.url} key={source.url} rel="noopener noreferrer" target="_blank">
                  <span>{source.publisher}</span>{source.title}
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : <p className="dailyBriefingLoading">{status}</p>}
    </section>
  );
}
