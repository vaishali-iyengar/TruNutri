"use client";

import { useEffect, useRef, useState } from "react";

interface Claim {
  text: string;
  source: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  claims?: Claim[];
  declined?: boolean;
  isError?: boolean;
  isNetworkError?: boolean;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

const SUGGESTED_QUESTIONS = [
  { tag: "Food", tone: "primary" as const, question: "What's the difference between baking soda and baking powder?" },
  { tag: "Nutrition", tone: "secondary" as const, question: "What foods are high in vitamin C?" },
  { tag: "Food Safety", tone: "tertiary" as const, question: "Is it safe to eat eggs past the sell-by date?" },
];

function LeafIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M5 13c0-5 4-9 9-9h5v5c0 5-4 9-9 9H5v-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M5 19c4-4.5 7.5-8 14-14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 9v4m0 3.5h.01M10.3 3.86 2.7 17.14A1.5 1.5 0 0 0 4 19.5h16a1.5 1.5 0 0 0 1.3-2.36L13.7 3.86a1.5 1.5 0 0 0-2.6 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v5m0 3h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ClipboardIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="6" y="4.5" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4.5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 10h6M9 13.5h6M9 17h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ArrowUpIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const TAG_STYLES = {
  primary: "bg-primary-fixed text-on-primary-fixed-variant",
  secondary: "bg-secondary-fixed text-on-secondary-fixed-variant",
  tertiary: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
};

function Avatar({ role, tone }: { role: "user" | "assistant"; tone?: "declined" | "error" }) {
  if (role === "user") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary shadow-sm">
        You
      </div>
    );
  }
  const style =
    tone === "declined"
      ? "bg-tertiary-fixed text-tertiary"
      : tone === "error"
        ? "bg-error-container text-error"
        : "bg-primary-fixed text-primary";
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${style}`}>
      <LeafIcon className="h-4 w-4" />
    </div>
  );
}

// The system prompt is allowed to answer with short bullet points
// ("- like this"); render those as an actual list instead of one run-on
// paragraph with literal "-" characters.
function AnswerText({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const isBullet = (l: string) => /^[-•*]\s+/.test(l);

  if (lines.length <= 1 || !lines.some(isBullet)) {
    return <p className="leading-relaxed">{text}</p>;
  }

  const blocks: { type: "p" | "ul"; items: string[] }[] = [];
  for (const line of lines) {
    const type = isBullet(line) ? "ul" : "p";
    const content = isBullet(line) ? line.replace(/^[-•*]\s+/, "") : line;
    const last = blocks[blocks.length - 1];
    if (last?.type === type) {
      last.items.push(content);
    } else {
      blocks.push({ type, items: [content] });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="leading-relaxed">
            {b.items.join(" ")}
          </p>
        ),
      )}
    </div>
  );
}

function ClaimsList({ claims }: { claims: Claim[] }) {
  if (claims.length === 0) return null;
  return (
    <div className="mt-4 border-t border-outline-variant/50 pt-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-secondary">Claims</p>
      <ul className="flex flex-col gap-2">
        {claims.map((c, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded-xl bg-surface-container-low px-3 py-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-container text-[10px] font-bold text-on-primary">
              {i + 1}
            </span>
            <div className="flex-1 text-sm text-on-surface">
              <p>{c.text}</p>
              <span className="mt-1.5 inline-block rounded-full bg-surface-container-lowest px-2 py-0.5 text-[11px] font-medium text-on-surface-variant ring-1 ring-inset ring-outline-variant/60">
                Source: not yet available
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversationId(localStorage.getItem("conversationId"));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function postChat(convId: string | null, text: string) {
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: convId, message: text }),
    });
    const data = await res.json();
    return { res, data };
  }

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim();
    if (!text || pending) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setPending(true);

    try {
      let { res, data } = await postChat(conversationId, text);

      // A stored conversationId can go stale (e.g. the backend database was
      // reset) — retry once as a fresh conversation instead of failing forever.
      if (res.status === 404 && conversationId) {
        localStorage.removeItem("conversationId");
        setConversationId(null);
        ({ res, data } = await postChat(null, text));
      }

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "Something went wrong, try again.", isError: true },
        ]);
        return;
      }

      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
        localStorage.setItem("conversationId", data.conversationId);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          claims: data.claims,
          declined: data.declined ?? false,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Couldn't reach the server. Try again.", isError: true, isNetworkError: true },
      ]);
    } finally {
      setPending(false);
    }
  }

  function newConversation() {
    localStorage.removeItem("conversationId");
    setConversationId(null);
    setMessages([]);
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      {/* Ambient botanical backdrop, decorative only */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-primary-fixed-dim/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-24 h-72 w-72 rounded-full bg-secondary-fixed/25 blur-3xl" />

      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-outline-variant/40 bg-surface/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary shadow-sm">
            <LeafIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold leading-tight tracking-tight text-primary">
              TruNutri
            </h1>
            <p className="truncate text-[11px] font-semibold uppercase leading-tight tracking-wider text-on-surface-variant">
              Ask. Learn. Eat smarter.
            </p>
          </div>
        </div>
        <button
          onClick={newConversation}
          aria-label="New conversation"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-outline-variant/60 bg-surface-container-lowest text-primary shadow-sm transition hover:bg-surface-container-low sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-1.5"
        >
          <PlusIcon className="h-4 w-4 sm:hidden" />
          <span className="hidden text-sm font-semibold sm:inline">New conversation</span>
        </button>
      </header>

      <div className="relative z-10 flex flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            {messages.length === 0 && (
              <div className="mx-auto max-w-2xl pt-6 text-center">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-surface-container-low px-3.5 py-1.5 shadow-sm">
                  <span className="h-2 w-2 rounded-full bg-surface-tint" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-primary-container">
                    General Nutrition Guidance
                  </span>
                </div>

                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-container text-on-primary shadow-md">
                  <LeafIcon className="h-7 w-7" />
                </div>

                <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight text-primary sm:text-4xl">
                  Ask anything about food, nutrition &amp; safety.
                </h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-on-surface-variant">
                  Curious about an ingredient, a storage question, or what&apos;s actually in your food? Ask away —
                  or try one of these to see how it works.
                </p>

                <div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
                  {SUGGESTED_QUESTIONS.map((s) => (
                    <button
                      key={s.question}
                      onClick={() => sendMessage(s.question)}
                      disabled={pending}
                      className="flex flex-col justify-between gap-4 rounded-2xl bg-surface-container-lowest p-5 text-left shadow-[0_4px_20px_-4px_rgba(28,75,61,0.08)] transition hover:bg-surface-container-low hover:shadow-[0_8px_26px_-4px_rgba(28,75,61,0.12)] disabled:pointer-events-none disabled:opacity-40"
                    >
                      <div>
                        <div className="mb-3 flex items-center justify-between">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TAG_STYLES[s.tone]}`}>
                            {s.tag}
                          </span>
                          <span className="text-outline">↗</span>
                        </div>
                        <p className="font-display text-base font-semibold leading-snug text-primary">
                          {s.question}
                        </p>
                      </div>
                      <span className="text-[11px] font-medium text-on-surface-variant">Example {s.tag.toLowerCase()} question</span>
                    </button>
                  ))}
                </div>

                <p className="mt-8 text-[11px] font-medium text-on-surface-variant/70">
                  No ads · No affiliate links · General knowledge, not medical advice
                </p>
              </div>
            )}

            <div className="mx-auto flex max-w-2xl flex-col gap-6">
              {messages.map((m, i) => {
                const tone = m.isError ? "error" : m.declined ? "declined" : undefined;
                return (
                  <div key={i} className={`flex items-start gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    <Avatar role={m.role} tone={tone} />
                    {m.role === "user" ? (
                      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-5 py-3 text-sm leading-relaxed text-on-primary shadow-sm">
                        {m.content}
                      </div>
                    ) : m.declined ? (
                      <div className="max-w-[80%] rounded-2xl border-l-4 border-tertiary bg-tertiary-fixed/40 px-5 py-4 text-sm text-on-tertiary-fixed-variant shadow-sm">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tertiary">
                          <WarningIcon className="h-3.5 w-3.5" />
                          Out of scope
                        </div>
                        <p className="leading-relaxed">{m.content}</p>
                      </div>
                    ) : m.isError ? (
                      <div className="max-w-[80%] rounded-2xl border-l-4 border-error bg-error-container px-5 py-4 text-sm text-on-error-container shadow-sm">
                        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-error">
                          <AlertIcon className="h-3.5 w-3.5" />
                          {m.isNetworkError ? "Connection error" : "Error"}
                        </div>
                        <p className="leading-relaxed">{m.content}</p>
                      </div>
                    ) : (
                      <div className="relative max-w-[80%] overflow-hidden rounded-3xl bg-surface-container-lowest p-5 text-sm text-on-surface shadow-md">
                        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-surface-tint to-secondary-container" />
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-fixed text-primary">
                            <LeafIcon className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-sm font-semibold text-primary">TruNutri</span>
                        </div>
                        <AnswerText text={m.content} />
                        {m.claims && <ClaimsList claims={m.claims} />}
                      </div>
                    )}
                  </div>
                );
              })}

              {pending && (
                <div className="flex items-start gap-2.5">
                  <Avatar role="assistant" />
                  <div className="flex items-center gap-1 rounded-3xl bg-surface-container-lowest px-5 py-4 shadow-sm">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-fixed-dim [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-fixed-dim [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-fixed-dim" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="shrink-0 border-t border-outline-variant/40 bg-surface/90 p-3 backdrop-blur sm:p-4">
            <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-full bg-surface-container-lowest py-1.5 pl-4 pr-1.5 shadow-sm ring-1 ring-outline-variant/50 transition focus-within:ring-2 focus-within:ring-primary-container/40 sm:pl-5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask a question…"
                disabled={pending}
                className="flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-outline"
              />
              <button
                onClick={() => sendMessage()}
                disabled={pending || !input.trim()}
                aria-label="Send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary shadow-sm transition hover:bg-primary disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowUpIcon />
              </button>
            </div>
          </div>
        </main>

        <aside className="hidden w-80 shrink-0 flex-col border-l border-outline-variant/40 bg-surface-container-low/60 p-5 xl:flex">
          <div className="mb-1 flex items-center gap-2">
            <ClipboardIcon className="h-4 w-4 text-on-surface-variant" />
            <h2 className="font-display text-base font-semibold text-primary">Cited Evidence</h2>
          </div>
          <p className="mb-4 text-xs text-on-surface-variant">Sources for this conversation</p>
          <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest px-4 py-6 text-center">
            <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-surface-container text-outline">
              <ClipboardIcon className="h-4 w-4" />
            </div>
            <p className="text-sm font-semibold text-on-surface">Sources coming soon</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Linked citations for each claim will appear here in an upcoming update. For now, claims are shown
              without a source.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
