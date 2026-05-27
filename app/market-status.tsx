"use client";

import { useEffect, useState } from "react";

const MARKET_TIME_ZONE = "America/New_York";
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;
const MARKET_EARLY_CLOSE_MINUTES = 13 * 60;

const MARKET_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

const EARLY_CLOSES = new Set([
  "2026-07-02",
  "2026-11-27",
  "2026-12-24",
  "2027-11-26",
]);

function getMarketParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
    seconds: Number(value("second")),
  };
}

function getNewYorkDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day"))));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isWeekend(weekday: string) {
  return weekday === "Sat" || weekday === "Sun";
}

function isTradingDateKey(key: string) {
  const day = new Date(`${key}T12:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6 && !MARKET_HOLIDAYS.has(key);
}

function isTradingDay(date: Date) {
  const parts = getMarketParts(date);
  return !isWeekend(parts.weekday) && isTradingDateKey(parts.dateKey);
}

function nextTradingDate(now: Date) {
  const marketToday = getNewYorkDate(now);

  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(marketToday);
    candidate.setUTCDate(candidate.getUTCDate() + offset);

    const candidateKey = dateKey(candidate);
    if (!isTradingDateKey(candidateKey)) continue;

    const today = getMarketParts(now);
    const closeMinutes = EARLY_CLOSES.has(today.dateKey)
      ? MARKET_EARLY_CLOSE_MINUTES
      : MARKET_CLOSE_MINUTES;

    if (offset === 0 && today.minutes >= closeMinutes) continue;
    return candidateKey;
  }

  return dateKey(marketToday);
}

function marketDateTimeToLocal(date: string, minutes: number) {
  const noonUtc = new Date(`${date}T12:00:00.000Z`);
  const parts = getMarketParts(noonUtc);
  const marketMinutesAtNoonUtc = parts.minutes;
  const offsetMinutes = marketMinutesAtNoonUtc - 12 * 60;
  return new Date(noonUtc.getTime() + (minutes - 12 * 60 - offsetMinutes) * 60 * 1000);
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getMarketStatus(now: Date) {
  const parts = getMarketParts(now);
  const closeMinutes = EARLY_CLOSES.has(parts.dateKey)
    ? MARKET_EARLY_CLOSE_MINUTES
    : MARKET_CLOSE_MINUTES;
  const tradingDay = isTradingDay(now);
  const open =
    tradingDay &&
    parts.minutes >= MARKET_OPEN_MINUTES &&
    parts.minutes < closeMinutes;

  if (open) {
    return {
      isOpen: true,
      label: "Market is open",
      detail: `Closes at ${EARLY_CLOSES.has(parts.dateKey) ? "1:00" : "4:00"} PM ET`,
    };
  }

  const nextDate = nextTradingDate(now);
  const nextOpen = marketDateTimeToLocal(nextDate, MARKET_OPEN_MINUTES);

  return {
    isOpen: false,
    label: "Market opens in",
    detail: formatDuration(nextOpen.getTime() - now.getTime()),
  };
}

export function MarketStatus() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const status = getMarketStatus(now);

  return (
    <div className={`marketStatus ${status.isOpen ? "open" : "closed"}`} suppressHydrationWarning>
      <span className="marketDot" />
      <span>{status.label}</span>
      <strong>{status.detail}</strong>
    </div>
  );
}
