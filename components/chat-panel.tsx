"use client";

import { FormEvent, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatPanelProps = {
  runId: string;
};

const EXAMPLE_PROMPTS = [
  "What are the top strategic risks in this report?",
  "Compare Rogo, Hebbia, and AlphaSense.",
  "What should Innovera do first?",
];

export function ChatPanel({ runId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function submitMessage(nextInput?: string) {
    const message = (nextInput ?? input).trim();

    if (!message || isLoading) {
      return;
    }

    setInput("");
    setError("");
    setIsLoading(true);

    const nextMessages: Message[] = [...messages, { role: "user", content: message }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId,
          message,
          history: messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Chat request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) => {
          const updated = [...current];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: last.content + chunk };
          }
          return updated;
        });
      }
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") {
        const messageText = caught instanceof Error ? caught.message : "Unexpected chat error.";
        setError(messageText);
        setMessages(nextMessages);
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage();
  }

  function resetChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput("");
    setError("");
    setIsLoading(false);
  }

  const canReset = messages.length > 0 || error !== "" || isLoading;

  return (
    <aside className="chat-panel" aria-label="Report chat">
      <div className="chat-header">
        <div className="chat-header-row">
          <h2>Ask About The Report</h2>
          <button
            type="button"
            className="chat-reset"
            onClick={resetChat}
            disabled={!canReset}
            title="Clear the conversation and start over"
          >
            New chat
          </button>
        </div>
        <p>
          Chat with the Supabase-backed JSON data using OpenRouter. Answers are grounded in
          the competitive intelligence run shown on the left.
        </p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <strong>Try a question:</strong>
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void submitMessage(prompt)}
                disabled={isLoading}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message, index) => (
            <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
              {message.role === "assistant" ? (
                message.content ? (
                  <div className="chat-markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  "Thinking..."
                )
              ) : (
                message.content
              )}
            </div>
          ))
        )}
        {error ? <div className="chat-message error">{error}</div> : null}
      </div>

      <form className="chat-form" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about companies, trends, white space, rankings, or next steps..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? "Answering..." : "Send"}
        </button>
      </form>
    </aside>
  );
}
