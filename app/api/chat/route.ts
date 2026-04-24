import { buildCondensedContext, getRelevantSections } from "@/lib/chat-context";
import { loadReportData } from "@/lib/report-data";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequest = {
  runId?: string;
  message?: string;
  history?: ChatMessage[];
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_TEMPLATE = `You are an expert competitive-intelligence analyst assistant. The user is viewing an interactive report and wants to explore the findings through conversation.

Use the report context below to answer accurately. Cite specific companies, parameters, rankings, claims, and source IDs when the context provides them. When the report does not cover a question, say so directly.

Formatting rules:
- Use markdown for structure.
- Keep answers focused and concise unless the user asks for depth.
- When comparing companies, use a markdown table when helpful.

---

Condensed report context:
{condensed_context}

---

Targeted deep context:
{extra_context}`;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function safeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item): item is ChatMessage => {
      return (
        item &&
        typeof item === "object" &&
        (item as ChatMessage).role !== undefined &&
        ["user", "assistant"].includes((item as ChatMessage).role) &&
        typeof (item as ChatMessage).content === "string"
      );
    })
    .slice(-8);
}

async function streamOpenRouter(messages: Array<{ role: string; content: string }>) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://vercel.app",
      "X-Title": "Innovera Market Report",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "x-ai/grok-4.1-fast",
      messages,
      stream: true,
      temperature: 0.4,
      max_tokens: 4096,
    }),
  });

  if (!response.ok || !response.body) {
    const body = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
  }

  return response.body;
}

export async function POST(request: Request) {
  let body: ChatRequest;

  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const runId = body.runId ?? process.env.NEXT_PUBLIC_DEFAULT_RUN_ID ?? "v2_run_20260424_104054";
  const message = body.message?.trim();
  const history = safeHistory(body.history);

  if (!message) {
    return jsonError("Message is required.", 400);
  }

  try {
    const report = await loadReportData(runId);
    const condensed = buildCondensedContext(report);
    const extra = getRelevantSections(report, message, history);
    const systemContent = SYSTEM_TEMPLATE.replace("{condensed_context}", condensed).replace("{extra_context}", extra);
    const messages = [
      { role: "system", content: systemContent },
      ...history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: message },
    ];

    const openRouterStream = await streamOpenRouter(messages);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const stream = new ReadableStream({
      async start(controller) {
        const reader = openRouterStream.getReader();

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) {
                continue;
              }

              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") {
                continue;
              }

              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const token = parsed.choices?.[0]?.delta?.content;

              if (token) {
                controller.enqueue(encoder.encode(token));
              }
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unexpected chat error.";
    return jsonError(messageText, 500);
  }
}
