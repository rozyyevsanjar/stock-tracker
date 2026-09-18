"use client";

import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

type SavedChat = {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
  title: string;
  updatedAt: string;
};

type UsageSummary = {
  limits: {
    dailyRequests: number;
    dailyTokens: number;
  };
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percentage(value: number, limit: number) {
  if (!limit) return 0;
  return Math.min((value / limit) * 100, 100);
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatUsageDate(value: string | null) {
  if (!value) return "No requests yet";
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AssistantChat() {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [clientId, setClientId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(EMPTY_MESSAGES);
  const [historyStatus, setHistoryStatus] = useState("Loading saved chats...");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageStatus, setUsageStatus] = useState("Loading usage...");

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);
  const requestPercent = percentage(
    usage?.today.requests ?? 0,
    usage?.limits.dailyRequests ?? 0,
  );
  const tokenPercent = percentage(
    usage?.today.tokens ?? 0,
    usage?.limits.dailyTokens ?? 0,
  );
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

  async function refreshUsage() {
    try {
      const response = await fetch("/api/assistant-usage");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Gemini usage is unavailable.");
      }

      setUsage(data.usage ?? null);
      setUsageStatus("Usage tracked from this dashboard.");
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
              title: nextMessages.find((message) => message.role === "user")?.text.slice(0, 54) || chat.title,
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

      const answeredMessages = [...nextMessages, { role: "assistant" as const, text: data.answer }];
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
    setInput("");
    setError("");
  }

  async function deleteActiveChat() {
    if (!activeChatId || !clientId) return;

    const idToDelete = activeChatId;
    setActiveChatId(null);
    setMessages(EMPTY_MESSAGES);
    setChats((current) => current.filter((chat) => chat.id !== idToDelete));

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
          <h2>Gemini Assistant</h2>
          <p className="sectionNote">
            Private helper for questions about your dashboard data. It can read the portfolio snapshot
            sent by the server, but it cannot trade or edit files.
          </p>
        </div>
        <span className="statusPill">Gemini</span>
      </div>

      <div className="assistantHistoryBar">
        <div>
          <strong>Saved chats</strong>
          <span>{historyStatus}</span>
        </div>
        <div className="assistantHistoryActions">
          <button onClick={startNewChat} type="button">New chat</button>
          <button disabled={!activeChatId} onClick={() => void deleteActiveChat()} type="button">
            Delete
          </button>
        </div>
      </div>

      <div className="assistantUsageCard">
        <div className="assistantUsageHeader">
          <div>
            <strong>Gemini usage</strong>
            <span>{usageStatus}</span>
          </div>
          <a href="https://aistudio.google.com/rate-limit" rel="noreferrer" target="_blank">
            AI Studio limits
          </a>
        </div>
        <div className="assistantUsageGrid">
          <div>
            <span>Today</span>
            <strong>{formatNumber(usage?.today.requests ?? 0)} requests</strong>
          </div>
          <div>
            <span>Request use</span>
            <strong>{formatPercent(requestPercent)}</strong>
            <em>{formatNumber(usage?.limits.dailyRequests ?? 0)} daily cap</em>
            <i style={{ "--usage-percent": `${requestPercent}%` } as CSSProperties} />
          </div>
          <div>
            <span>Tokens today</span>
            <strong>{formatNumber(usage?.today.tokens ?? 0)}</strong>
          </div>
          <div>
            <span>Token use</span>
            <strong>{formatPercent(tokenPercent)}</strong>
            <em>{formatNumber(usage?.limits.dailyTokens ?? 0)} daily cap</em>
            <i style={{ "--usage-percent": `${tokenPercent}%` } as CSSProperties} />
          </div>
          <div>
            <span>7 days</span>
            <strong>{formatNumber(usage?.lastSevenDays.requests ?? 0)} requests</strong>
          </div>
          <div>
            <span>Last request</span>
            <strong>{formatUsageDate(usage?.lastRequestAt ?? null)}</strong>
          </div>
        </div>
        {usage?.models.length ? (
          <div className="assistantUsageModels">
            {usage.models.map((model) => (
              <span key={model.model}>
                {model.model}: {formatNumber(model.requests)} / {formatNumber(model.tokens)} tokens
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {chats.length ? (
        <div className="assistantSavedChats" aria-label="Saved chats">
          {chats.map((chat) => (
            <button
              className={chat.id === activeChatId ? "active" : ""}
              key={chat.id}
              onClick={() => openChat(chat)}
              type="button"
            >
              <span>{chat.title}</span>
              <em>{new Date(chat.updatedAt).toLocaleDateString()}</em>
            </button>
          ))}
        </div>
      ) : null}

      <div className="assistantStarters" aria-label="Suggested prompts">
        {STARTER_PROMPTS.map((prompt) => (
          <button disabled={isSending} key={prompt} onClick={() => void sendMessage(prompt)} type="button">
            {prompt}
          </button>
        ))}
      </div>

      <div className="assistantMessages" aria-live="polite">
        {messages.map((message, index) => (
          <div className={`assistantMessage ${message.role}`} key={`${message.role}-${index}`}>
            <span>{message.role === "user" ? "You" : "Assistant"}</span>
            <p>{message.text}</p>
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
    </section>
  );
}
