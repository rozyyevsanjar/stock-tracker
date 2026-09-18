"use client";

import { FormEvent, useMemo, useState } from "react";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

const STARTER_PROMPTS = [
  "Summarize my current portfolio allocation.",
  "What is my biggest concentration risk?",
  "Explain my gold and silver exposure.",
  "Which open positions have the weakest P/L?",
];

export function AssistantChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Ask me about your portfolio, positions, allocation, transaction lots, savings, or metals.",
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

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

      setMessages([...nextMessages, { role: "assistant", text: data.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer right now.");
      setMessages(messages);
      setInput(question);
    } finally {
      setIsSending(false);
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
