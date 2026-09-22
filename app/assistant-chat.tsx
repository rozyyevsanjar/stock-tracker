"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  scenario?: ScenarioSummary;
};

type ScenarioSummary = {
  allocation: Array<{ category: string; currentPercent: number; currentValue: number; proposedPercent: number; proposedValue: number }>;
  currency: string;
  metrics: Array<{ after: number; before: number; format: "currency" | "percent"; label: string }>;
  note: string;
};

type SavedChat = {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
  title: string;
  updatedAt: string;
};

type UsageSummary = {
  quotas: Array<{ model: string; rpm: number; tpm: number; rpd: number; requests: number; minuteRequests: number; minuteTokens: number; blocked: boolean }>;
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

const STARTER_PROMPTS = [
  "Summarize my current portfolio allocation.",
  "What is my biggest concentration risk?",
  "Explain my gold and silver exposure.",
  "Which open positions have the weakest P/L?",
];

const CLIENT_ID_KEY = "assistant-client-id";
const EMPTY_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    text: "Ask me about your portfolio, positions, allocation, transaction lots, savings, or metals.",
  },
];

function getClientId() {
  let existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;

  existing = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, existing);
  return existing;
}

function percentage(value: number, limit: number) {
  if (!limit) return 0;
  return Math.min((value / limit) * 100, 100);
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function scenarioValue(value: number, format: "currency" | "percent", currency: string) {
  if (format === "percent") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("en-US", { currency, maximumFractionDigits: 0, style: "currency" }).format(value);
}

function ScenarioResult({ scenario }: { scenario: ScenarioSummary }) {
  return (
    <div className="scenarioSummary">
      <strong className="scenarioLabel">Before vs after scenario</strong>
      <div className="scenarioMetrics">
        {scenario.metrics.map((metric) => {
          const changed = Math.abs(metric.after - metric.before) >= (metric.format === "percent" ? 0.1 : 1);
          return <div className={changed ? "changed" : ""} key={metric.label}><span>{metric.label}</span><strong>{scenarioValue(metric.before, metric.format, scenario.currency)} <i>→</i> {scenarioValue(metric.after, metric.format, scenario.currency)}</strong></div>;
        })}
      </div>
      <div className="assistantTableScroll">
        <table>
          <thead><tr><th>Asset class</th><th>Current value</th><th>Current %</th><th>Proposed value</th><th>Proposed %</th></tr></thead>
          <tbody>{scenario.allocation.map((row) => <tr key={row.category}><td>{row.category}</td><td>{scenarioValue(row.currentValue, "currency", scenario.currency)}</td><td>{scenarioValue(row.currentPercent, "percent", scenario.currency)}</td><td>{scenarioValue(row.proposedValue, "currency", scenario.currency)}</td><td>{scenarioValue(row.proposedPercent, "percent", scenario.currency)}</td></tr>)}</tbody>
        </table>
      </div>
      <p>{scenario.note}</p>
    </div>
  );
}

const LINKABLE_TICKERS = new Set(["AAPL", "AAL", "AMZN", "BMW.DE", "BTC-USD", "ETH-USD", "GOOG", "GOOGL", "META", "MSFT", "NVDA", "SOL-USD", "TSLA"]);

function researchSymbols(text: string) {
  return Array.from(new Set((text.match(/\b[A-Z]{2,5}(?:\.[A-Z]{1,3}|-USD)?\b/g) ?? []).filter((item) => LINKABLE_TICKERS.has(item)))).slice(0, 4);
}

export function AssistantChat({ currency, initialPrompt = "" }: { currency: string; initialPrompt?: string }) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [clientId, setClientId] = useState("");
  const [input, setInput] = useState(initialPrompt);
  const [messages, setMessages] = useState<ChatMessage[]>(EMPTY_MESSAGES);
  const [historyStatus, setHistoryStatus] = useState("Loading saved chats...");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageStatus, setUsageStatus] = useState("Loading usage...");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const combinedUsage = usage ? percentage(
    usage.quotas.reduce((sum, quota) => sum + quota.requests, 0),
    usage.quotas.reduce((sum, quota) => sum + quota.rpd, 0),
  ) : null;

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);
  const historyHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-assistant-client-id": clientId,
    }),
    [clientId],
  );

  useEffect(() => {
    setClientId(getClientId());
  }, []);

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt]);

  async function refreshUsage() {
    try {
      const response = await fetch("/api/assistant-usage");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Gemini usage is unavailable.");
      }

      setUsage(data.usage ?? null);
      setUsageStatus("Dashboard usage · daily reset at midnight Pacific");
    } catch (err) {
      setUsageStatus(err instanceof Error ? err.message : "Gemini usage is unavailable.");
    }
  }

  useEffect(() => {
    void refreshUsage();
  }, []);

  useEffect(() => {
    if (!clientId) return;

    let cancelled = false;
    async function loadChats() {
      try {
        const response = await fetch("/api/assistant-chats", {
          headers: {
            "x-assistant-client-id": clientId,
          },
        });
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          throw new Error(data.error ?? "Saved chats are unavailable.");
        }

        setChats(data.chats ?? []);
        setHistoryStatus(data.chats?.length ? "Saved chats loaded." : "No saved chats yet.");
      } catch (err) {
        setHistoryStatus(err instanceof Error ? err.message : "Saved chats are unavailable.");
      }
    }

    void loadChats();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function saveChat(nextMessages: ChatMessage[]) {
    if (!clientId) return;

    const endpoint = activeChatId ? `/api/assistant-chats/${activeChatId}` : "/api/assistant-chats";
    const response = await fetch(endpoint, {
      body: JSON.stringify({ messages: nextMessages }),
      headers: historyHeaders,
      method: activeChatId ? "PATCH" : "POST",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Chat was answered, but could not be saved.");
    }

    if (!activeChatId && data.chat) {
      setActiveChatId(data.chat.id);
      setChats((current) => [data.chat, ...current]);
      setHistoryStatus("Saved.");
      return;
    }

    setChats((current) =>
      current.map((chat) =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: nextMessages,
              updatedAt: new Date().toISOString(),
            }
          : chat,
      ),
    );
    setHistoryStatus("Saved.");
  }

  async function sendMessage(nextInput = input) {
    const question = nextInput.trim();
    if (!question || isSending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", text: question }];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setIsSending(true);

    try {
      const response = await fetch("/api/assistant", {
        body: JSON.stringify({
          currency,
          messages: nextMessages.slice(-8),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "The assistant could not answer right now.");
      }

      const answeredMessages = [...nextMessages, { role: "assistant" as const, scenario: data.scenario ?? undefined, text: data.answer }];
      setMessages(answeredMessages);
      void refreshUsage();
      try {
        await saveChat(answeredMessages);
      } catch (saveError) {
        setHistoryStatus(
          saveError instanceof Error ? saveError.message : "Chat was answered, but could not be saved.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer right now.");
      setMessages(nextMessages);
      setInput(question);
    } finally {
      setIsSending(false);
    }
  }

  function startNewChat() {
    setActiveChatId(null);
    setMessages(EMPTY_MESSAGES);
    setInput("");
    setError("");
  }

  function openChat(chat: SavedChat) {
    setActiveChatId(chat.id);
    setMessages(chat.messages.length ? chat.messages : EMPTY_MESSAGES);
    setEditingChatId(null);
    setInput("");
    setError("");
  }

  function beginRename(chat: SavedChat) {
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  }

  async function renameChat(id: string) {
    const title = editingTitle.trim();
    if (!title) return;
    try {
      const response = await fetch(`/api/assistant-chats/${id}`, {
        body: JSON.stringify({ title }),
        headers: historyHeaders,
        method: "PATCH",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not rename chat.");

      setChats((current) =>
        current.map((chat) =>
          chat.id === id ? { ...chat, title, updatedAt: new Date().toISOString() } : chat,
        ),
      );
      setEditingChatId(null);
      setHistoryStatus("Renamed.");
    } catch (err) {
      setHistoryStatus(err instanceof Error ? err.message : "Could not rename chat.");
    }
  }

  async function deleteChat(idToDelete: string) {
    setChats((current) => current.filter((chat) => chat.id !== idToDelete));
    if (activeChatId === idToDelete) {
      setActiveChatId(null);
      setMessages(EMPTY_MESSAGES);
      setInput("");
      setError("");
    }

    try {
      await fetch(`/api/assistant-chats/${idToDelete}`, {
        headers: historyHeaders,
        method: "DELETE",
      });
      setHistoryStatus("Deleted.");
    } catch {
      setHistoryStatus("Deleted locally. Database delete may need a retry.");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  return (
    <section className="assistantPanel">
      <div className="assistantIntro">
        <div>
          <h2>Portfolio Assistant</h2>
          <p className="sectionNote">
            The assistant receives a structured snapshot of your portfolio and relevant research data when you ask a question. It cannot place trades or modify portfolio records.
          </p>
          <details className="assistantPrivacy">
            <summary>What data is shared?</summary>
            <p>Portfolio holdings, current values, allocation, relevant research context, and recent saved conversation context when applicable. Login details and API keys are not included.</p>
          </details>
        </div>
        <div className="assistantContextBadges"><span className="statusPill">Analysis currency: {currency}</span><span className="statusPill">Powered by Gemini</span></div>
      </div>

      <div className="assistantUsageCompact" title={combinedUsage === null ? usageStatus : "Combined daily request allowance used by this dashboard. Resets at midnight Pacific. Individual model limits still apply."}>
        <span>Gemini usage today</span>
        <progress aria-label="Combined daily Gemini request usage" max={100} value={combinedUsage ?? 0} />
        <strong aria-live="polite">{combinedUsage === null ? (usageStatus === "Loading usage..." ? "Loading…" : "Unavailable") : formatPercent(combinedUsage)}</strong>
      </div>

      <div className="assistantWorkspace">
        <button className="assistantSidebarToggle" onClick={() => setSidebarOpen((open) => !open)} type="button">{sidebarOpen ? "Hide saved chats" : "Show saved chats"}</button>
        <aside className={`assistantSidebar ${sidebarOpen ? "open" : ""}`} aria-label="Saved chats">
          <div className="assistantSidebarHeader">
            <div>
              <strong>Saved chats</strong>
              <span>{historyStatus}</span>
            </div>
            <button onClick={startNewChat} type="button">New</button>
          </div>

          {chats.length ? (
            <div className="assistantSavedChats">
              {chats.map((chat) => (
                <article className={chat.id === activeChatId ? "active" : ""} key={chat.id}>
                  {editingChatId === chat.id ? (
                    <form
                      className="assistantRenameForm"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameChat(chat.id);
                      }}
                    >
                      <input
                        aria-label="Chat title"
                        autoFocus
                        onChange={(event) => setEditingTitle(event.target.value)}
                        value={editingTitle}
                      />
                      <div>
                        <button type="submit">Save</button>
                        <button onClick={() => setEditingChatId(null)} type="button">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button className="assistantChatOpen" onClick={() => openChat(chat)} type="button">
                        <span>{chat.title}</span>
                        <em>{new Date(chat.updatedAt).toLocaleDateString()}</em>
                      </button>
                      <div className="assistantChatActions">
                        <button onClick={() => openChat(chat)} type="button">Continue</button>
                        <button onClick={() => beginRename(chat)} type="button">Rename</button>
                        <button onClick={() => void deleteChat(chat.id)} type="button">Delete</button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="assistantEmptyChats">No saved chats yet.</p>
          )}
        </aside>

        <div className="assistantConversation">
          <div className="assistantStarters" aria-label="Suggested prompts">
            {STARTER_PROMPTS.map((prompt) => (
              <button disabled={isSending} key={prompt} onClick={() => void sendMessage(prompt)} type="button">
                {prompt}
              </button>
            ))}
          </div>

          <div className="assistantMessages" aria-live="polite">
            {messages.map((message, index) => (
              <div className={`assistantMessage ${message.role} ${message.role === "assistant" && /\b(simulate|scenario|what if|investing)\b/i.test(messages[index - 1]?.text ?? "") ? "scenarioResult" : ""}`} key={`${message.role}-${index}`}>
                <span>{message.role === "user" ? "You" : "Assistant"}</span>
                {message.role === "assistant" ? (
                  <>{message.scenario ? <ScenarioResult scenario={message.scenario} /> : null}<div className="assistantMarkdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
                      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                      table: ({ children }) => <div className="assistantTableScroll"><table>{children}</table></div>,
                    }}>{message.text}</ReactMarkdown>
                  </div>
                  {researchSymbols(message.text).length ? <div className="assistantResearchLinks">{researchSymbols(message.text).map((ticker) => <a href={`/?tab=research&symbol=${encodeURIComponent(ticker)}&currency=${encodeURIComponent(currency)}`} key={ticker}>Open {ticker} in Research</a>)}</div> : null}</>
                ) : <p>{message.text}</p>}
              </div>
            ))}
            {isSending ? (
              <div className="assistantMessage assistant">
                <span>Assistant</span>
                <p>Thinking...</p>
              </div>
            ) : null}
          </div>

          <form className="assistantComposer" onSubmit={handleSubmit}>
            <textarea
              aria-label="Ask the assistant"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about allocation, risk, open lots, metals, savings..."
              rows={3}
              value={input}
            />
            <button disabled={!canSend} type="submit">
              {isSending ? "Sending" : "Send"}
            </button>
          </form>

          {error ? <p className="assistantError">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
