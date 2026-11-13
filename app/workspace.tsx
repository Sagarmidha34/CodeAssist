"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Code2, Copy, FileCode2, GitBranch, Menu, MessageSquarePlus, MoreHorizontal, PanelLeftClose, Plus, Search, ShieldCheck, Sparkles, TerminalSquare, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Conversation = { id: string; title: string; updated_at: string };
type Message = { id: string; role: "user" | "assistant"; content: string; created_at: string };
type AgentActivity = { agent: string; status: "running" | "complete" | "failed"; detail: string };

export function ChatWorkspace({ email }: { email: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"chat" | "agents">("chat");
  const [agentEvents, setAgentEvents] = useState<AgentActivity[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRevision = useRef(0);
  const skipInitialLoadIds = useRef(new Set<string>());

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations", { cache: "no-store" });
    if (response.status === 401) { router.replace("/login"); return; }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load conversations.");
    setConversations(body.conversations);
  }, [router]);

  useEffect(() => { void Promise.resolve().then(loadConversations).catch(err => setNotice(err.message)); }, [loadConversations]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    if (!activeId) return;
    if (skipInitialLoadIds.current.has(activeId)) {
      setLoadedId(activeId);
      return;
    }
    let cancelled = false;
    const revisionAtRequest = messagesRevision.current;
    fetch(`/api/conversations/${activeId}/messages`, { cache: "no-store" })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not open conversation."); return body.messages as Message[]; })
      .then(rows => { if (!cancelled && revisionAtRequest === messagesRevision.current) { setMessages(rows); setLoadedId(activeId); setAgentEvents([]); } })
      .catch(err => { if (!cancelled && revisionAtRequest === messagesRevision.current) { setMessages([]); setLoadedId(activeId); setNotice(err.message); } });
    return () => { cancelled = true; };
  }, [activeId]);

  async function newConversation() {
    setNotice("");
    try {
      const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not start a conversation.");
      messagesRevision.current += 1;
      setConversations(items => [body.conversation, ...items]); setActiveId(body.conversation.id); setLoadedId(body.conversation.id); setMessages([]); setDraft("");
      inputRef.current?.focus();
    } catch (err) { setNotice(err instanceof Error ? err.message : "Could not start a conversation."); }
  }

  async function deleteConversation(event: React.MouseEvent, conversation: Conversation) {
    event.stopPropagation(); setMenuId(null);
    if (!window.confirm(`Delete “${conversation.title}”? This removes its saved conversation and messages.`)) return;
    const response = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setNotice(body.error || "Could not delete the conversation."); return; }
    setConversations(items => items.filter(item => item.id !== conversation.id));
    if (activeId === conversation.id) { messagesRevision.current += 1; skipInitialLoadIds.current.delete(conversation.id); setActiveId(null); setLoadedId(null); setMessages([]); }
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy) return;
    let conversationId = activeId;
    if (!conversationId) {
      const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json();
      if (!response.ok) { setNotice(body.error || "Could not start a conversation."); return; }
      const createdId: string = body.conversation.id;
      conversationId = createdId; messagesRevision.current += 1; skipInitialLoadIds.current.add(createdId); setActiveId(createdId); setLoadedId(createdId); setConversations(items => [body.conversation, ...items]);
    }
    setLoadedId(conversationId);
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: prompt, created_at: new Date().toISOString() };
    const assistantId = crypto.randomUUID();
    messagesRevision.current += 1;
    setMessages(items => [...items, userMessage, { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString() }]);
    setDraft(""); setBusy(true); setNotice(""); setAgentEvents([]);
    try {
      const response = await fetch(mode === "agents" ? "/api/agent-run" : "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, message: prompt }) });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})); throw new Error(body.error || "The assistant could not respond.");
      }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n"); buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const eventName = chunk.match(/^event: (.+)$/m)?.[1];
          const dataLine = chunk.match(/^data: (.+)$/m)?.[1];
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (eventName === "delta") setMessages(items => items.map(item => item.id === assistantId ? { ...item, content: item.content + data.text } : item));
          if (eventName === "agent") setAgentEvents(items => [...items.filter(item => item.agent !== data.agent), data as AgentActivity]);
          if (eventName === "error") throw new Error(data.message || "The assistant could not finish.");
          if (eventName === "done") completed = true;
        }
      }
      if (!completed) throw new Error("The connection ended before the answer was saved. Please try again.");
      await loadConversations();
    } catch (err) {
      setMessages(items => items.filter(item => item.id !== assistantId || item.content));
      setNotice(err instanceof Error ? err.message : "The assistant could not respond.");
    } finally { setBusy(false); inputRef.current?.focus(); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(); }
  }

  async function signOut() {
    const supabase = createClient(); await supabase.auth.signOut(); router.replace("/login"); router.refresh();
  }

  const filtered = conversations.filter(c => c.title.toLowerCase().includes(filter.toLowerCase()));
  const activeConversation = conversations.find(item => item.id === activeId);
  const loading = Boolean(activeId && loadedId !== activeId);

  return <main className={`workspace ${sidebarOpen ? "with-sidebar" : "sidebar-closed"}`}>
    {sidebarOpen && <aside className="sidebar">
      <div className="side-head"><Link className="wordmark" href="/"><span className="brand-mark"><Code2 size={19} /></span>CodeAssist</Link><button className="icon-button side-toggle" title="Hide sidebar" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      <div className="side-actions"><button className="new-chat" onClick={newConversation}><MessageSquarePlus size={16} /> <span>New conversation</span><kbd>⌘ K</kbd></button><label className="search-box"><Search size={15} /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search conversations" /></label></div>
      <div className="history-label">RECENT</div>
      <nav className="conversation-list" aria-label="Conversation history">
        {filtered.length === 0 ? <div className="empty-history">{filter ? "No matching conversations" : "Your conversations will appear here"}</div> : filtered.map(item => <div className={`conversation-row ${item.id === activeId ? "selected" : ""}`} key={item.id}>
          <button className="conversation-select" onClick={() => { setNotice(""); if (item.id !== activeId) { messagesRevision.current += 1; skipInitialLoadIds.current.delete(item.id); setMessages([]); setLoadedId(null); setAgentEvents([]); setActiveId(item.id); } setMenuId(null); if (window.innerWidth <= 560) setSidebarOpen(false); }}><span className="conversation-title">{item.title}</span></button>
          <button className="icon-button row-menu" aria-label="Conversation options" onClick={() => setMenuId(menuId === item.id ? null : item.id)}><MoreHorizontal size={16} /></button>
          {menuId === item.id && <button className="delete-menu" onClick={e => void deleteConversation(e, item)}><Trash2 size={14} /> Delete</button>}
        </div>)}
      </nav>
      <div className="side-bottom"><div className="account-row"><span className="avatar">{email.charAt(0).toUpperCase()}</span><span className="account-email" title={email}>{email}</span><button className="icon-button" title="Sign out" onClick={signOut}><MoreHorizontal size={17} /></button></div><div className="private-note"><ShieldCheck size={13} /> Your chats are private to your account</div></div>
    </aside>}
    <section className="chat-shell">
      <header className="chat-topbar">{!sidebarOpen && <button className="icon-button show-sidebar" title="Show sidebar" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>}<div className="top-title"><strong>{activeConversation?.title || "CodeAssist"}</strong><span><Sparkles size={12} /> AI coding assistant</span></div><div className="top-right"><div className="mode-switch" role="tablist" aria-label="Assistant mode"><button role="tab" aria-selected={mode === "chat"} className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>Chat</button><button role="tab" aria-selected={mode === "agents"} className={mode === "agents" ? "active" : ""} onClick={() => setMode("agents")}><GitBranch size={12} /> Agents</button></div><span className="model-pill"><span /> Gemini + fallback</span><div className="account-mobile">{email.split("@")[0]}</div></div></header>
      <div className="message-scroll" ref={scrollRef}>
        {notice && <div className="notice-banner" role="alert"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button></div>}
        {loading ? <div className="loading-state"><span className="loading-orb" />Opening conversation…</div> : messages.length === 0 ? <Welcome onPrompt={text => { setDraft(text); inputRef.current?.focus(); }} /> : <div className="messages">
          {messages.map((message, index) => <article key={message.id} className={`message message-${message.role}`}>
            {message.role === "assistant" && <div className="assistant-icon"><Code2 size={15} /></div>}
            <div className="message-main">{message.role === "user" ? <div className="user-bubble">{message.content}</div> : <div className="assistant-content">{busy && mode === "agents" && index === messages.length - 1 && agentEvents.length > 0 && <div className="agent-progress">{agentEvents.map(event => <div className={`agent-progress-row ${event.status}`} key={event.agent}><span className="progress-mark">{event.status === "complete" ? <Check size={11} /> : event.status === "failed" ? <X size={11} /> : <i />}</span><strong>{event.agent}</strong><small>{event.detail}</small></div>)}</div>}{message.content ? <><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{message.content}</ReactMarkdown>{busy && index === messages.length - 1 && <span className="stream-cursor" />}</> : busy && index === messages.length - 1 ? <span className="typing-dots"><i /><i /><i /></span> : null}</div>}
            </div>
          </article>)}
        </div>}
      </div>
      <div className="composer-wrap">
        {messages.length === 0 && <div className="composer-label"><Sparkles size={13} /> What are you working on?</div>}
        <form className="composer" onSubmit={submitMessage}>
          <textarea ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder={mode === "agents" ? "Describe a Python task to analyze, build, test, and review…" : "Ask CodeAssist to explain, write, or debug code…"} rows={1} maxLength={8000} aria-label="Message CodeAssist" />
          <div className="composer-bottom"><div className="composer-hints">{mode === "agents" ? <><span><GitBranch size={13} /> Four role workflow</span><span><ShieldCheck size={13} /> One repair · restricted Python</span></> : <><span><FileCode2 size={13} /> Code-focused responses</span><span><ShieldCheck size={13} /> Private workspace</span></>}</div><div className="composer-tools"><span className="char-count">{draft.length ? `${draft.length}/8000` : "↵ send · ⇧↵ new line"}</span><button className="send-button" aria-label={mode === "agents" ? "Run agent workflow" : "Send message"} disabled={!draft.trim() || busy}><ArrowUp size={17} /></button></div></div>
        </form>
        <p className="disclaimer">CodeAssist can make mistakes. Review generated code before using it.</p>
      </div>
    </section>
  </main>;
}

function Welcome({ onPrompt }: { onPrompt: (text: string) => void }) {
  const ideas = [
    { icon: <FileCode2 size={16} />, title: "Build something", text: "Write a Python function to merge overlapping intervals." },
    { icon: <TerminalSquare size={16} />, title: "Debug an issue", text: "Help me understand why this React component keeps re-rendering." },
    { icon: <ShieldCheck size={16} />, title: "Review my code", text: "What edge cases should I test for a password strength checker?" },
  ];
  return <div className="welcome"><div className="welcome-mark"><Code2 size={23} /></div><p className="welcome-kicker">YOUR CODING PARTNER</p><h1>Think clearly.<br /><span>Code confidently.</span></h1><p className="welcome-copy">Talk through a bug, explore an idea, or get unstuck. We’ll work it out together.</p><div className="idea-grid">{ideas.map(idea => <button className="idea-card" key={idea.title} onClick={() => onPrompt(idea.text)}><span className="idea-icon">{idea.icon}</span><strong>{idea.title}</strong><span className="idea-text">{idea.text}</span><Plus size={14} className="idea-plus" /></button>)}</div><div className="workflow-strip"><span><span className="tiny-step">01</span> Understand</span><i /> <span><span className="tiny-step">02</span> Generate</span><i /> <span><span className="tiny-step">03</span> Verify</span><i /> <span><span className="tiny-step">04</span> Review</span></div></div>;
}

function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const text = markdownText(children).replace(/\n$/, "");
  async function copy() { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
  return <div className="code-frame"><div className="code-top"><span><span className="code-dot" /> CODE</span><button onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button></div><pre {...props}>{children}</pre></div>;
}

function markdownText(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(markdownText).join("");
  if (value && typeof value === "object" && "props" in value) return markdownText((value as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  return "";
}
