'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { v4 as uuid } from 'uuid';
import { cn } from '@/lib/cn';
import { ChartRenderer } from './chart-renderer';
import { ChartModal } from './chart-modal';
import { ChartSpec } from '@/lib/types';
import { loadPinned, savePinned } from '@/lib/pinned';
import ReactMarkdown from 'react-markdown';
import {
  ChatConversation,
  loadConversations,
  saveConversation,
  deleteConversation,
  generateTitle,
  groupByDate,
} from '@/lib/chat-history';

type Props = {
  open: boolean;
  onClose: () => void;
};

const SUGGESTED_PROMPTS = [
  'How much did I spend this month?',
  'What are my top merchants?',
  'Am I on track with my budgets?',
  'Show my income vs spending trend',
];

const chatTransport = new DefaultChatTransport({ api: '/api/agent/chat' });

export function ChatAnalyst({ open, onClose }: Props) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedChart, setExpandedChart] = useState<ChartSpec | null>(null);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, setMessages, sendMessage, status } = useChat({
    transport: chatTransport,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const loaded = loadConversations();
    setConversations(loaded);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const title = generateTitle(messages);
    const conv: ChatConversation = {
      id: activeId,
      title,
      messages,
      createdAt:
        conversations.find((c) => c.id === activeId)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveConversation(conv);
    setConversations(loadConversations());
  }, [messages, activeId]);

  const pinnedCallIds = useRef<Set<string>>(new Set());

  const pinChart = useCallback((spec: ChartSpec) => {
    const existing = loadPinned();
    const entry = {
      id: uuid(),
      title: spec.title,
      chartSpec: spec,
      createdAt: new Date().toISOString(),
    };
    savePinned([entry, ...existing].slice(0, 20));
  }, []);

  useEffect(() => {
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts) {
        const toolName = getToolName(part);
        if (toolName !== 'pinChart') continue;
        const { state } = part as { state: string };
        if (state !== 'output-available') continue;
        const callId = (part as { toolCallId: string }).toolCallId;
        if (pinnedCallIds.current.has(callId)) continue;
        const output = (part as { output: unknown }).output;
        if (output && typeof output === 'object' && 'chart' in output) {
          pinnedCallIds.current.add(callId);
          pinChart((output as { chart: ChartSpec }).chart);
        }
      }
    }
  }, [messages, pinChart]);

  const getTextFromMessage = (message: UIMessage): string => {
    return message.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('');
  };

  const getToolName = (part: (typeof messages)[number]['parts'][number]): string | null => {
    if (part.type === 'dynamic-tool') return (part as { toolName: string }).toolName;
    if (typeof part.type === 'string' && part.type.startsWith('tool-')) return part.type.slice(5);
    return null;
  };

  const getChartsFromMessage = (message: UIMessage): ChartSpec[] => {
    const charts: ChartSpec[] = [];
    for (const part of message.parts) {
      const toolName = getToolName(part);
      if (!toolName) continue;
      const state = (part as { state: string }).state;
      const output = state === 'output-available' ? (part as { output: unknown }).output : null;
      if (toolName === 'generateChart' && output) {
        charts.push(output as ChartSpec);
      }
      if (
        toolName === 'pinChart' &&
        output &&
        typeof output === 'object' &&
        output !== null &&
        'chartSpec' in output
      ) {
        charts.push((output as { chartSpec: ChartSpec }).chartSpec);
      }
    }
    return charts;
  };

  const hasToolActivity = (message: UIMessage): boolean => {
    return message.parts.some((part) => {
      if (!getToolName(part)) return false;
      const state = (part as { state: string }).state;
      return state !== 'output-available' && state !== 'output-error';
    });
  };

  const startNewChat = () => {
    const newId = uuid();
    setActiveId(newId);
    setMessages([]);
    setInputValue('');
  };

  const switchConversation = (conv: ChatConversation) => {
    setActiveId(conv.id);
    setMessages(conv.messages);
    setInputValue('');
  };

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteConversation(id);
    setConversations(loadConversations());
    if (activeId === id) {
      startNewChat();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    if (!activeId) {
      const newId = uuid();
      setActiveId(newId);
    }
    sendMessage({ text: inputValue });
    setInputValue('');
  };

  const handleSuggestedPrompt = (prompt: string) => {
    if (!activeId) {
      const newId = uuid();
      setActiveId(newId);
    }
    sendMessage({ text: prompt });
  };

  const activeTitle = conversations.find((c) => c.id === activeId)?.title || 'New chat';
  const groupedConversations = groupByDate(conversations);

  return (
    <>
      <div
        aria-hidden={!open}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: 580 }}
      >
        <div
          className={cn(
            'h-full bg-[var(--bg-base)] border-r border-[var(--border)] flex flex-col overflow-hidden transition-all duration-200',
            sidebarOpen ? 'w-[180px] min-w-[180px]' : 'w-0 min-w-0 border-r-0'
          )}
        >
          <div className="flex items-center justify-between px-3.5 py-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Chats
            </span>
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition"
              title="New chat"
              onClick={startNewChat}
            >
              <svg
                fill="none"
                height="12"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
                width="12"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {groupedConversations.map((group) => (
              <div key={group.label}>
                <div className="px-2 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {group.label}
                </div>
                {group.conversations.map((conv) => (
                  <button
                    key={conv.id}
                    className={cn(
                      'group mb-px flex w-full items-center rounded-lg px-2.5 py-2 text-left transition-colors',
                      conv.id === activeId
                        ? 'bg-[var(--bg-elevated)]'
                        : 'hover:bg-[var(--bg-elevated)]'
                    )}
                    onClick={() => switchConversation(conv)}
                  >
                    <span
                      className={cn(
                        'flex-1 truncate text-[12px]',
                        conv.id === activeId
                          ? 'font-medium text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)]'
                      )}
                    >
                      {conv.title}
                    </span>
                    <span
                      className="ml-1 hidden shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--red)] group-hover:block"
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                    >
                      <svg
                        fill="none"
                        height="12"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="12"
                      >
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col bg-[var(--bg-card)] border-l border-[var(--border)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                className="flex items-center justify-center rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition"
                title="Toggle sidebar"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <svg
                  fill="none"
                  height="16"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="16"
                >
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
              <h2 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                {activeTitle}
              </h2>
            </div>
            <button
              className="flex items-center justify-center rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition"
              title="Close"
              onClick={onClose}
            >
              <svg
                fill="none"
                height="16"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="16"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center px-4">
                <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-lg text-[var(--accent)]">
                  &#9790;
                </div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                  Finance Analyst
                </h3>
                <p className="text-xs text-[var(--text-muted)] mb-5 leading-relaxed">
                  Ask anything about your spending, budgets, trends, or accounts.
                </p>
                <div className="flex w-full max-w-[280px] flex-col gap-1.5">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-left text-[12px] text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
                      onClick={() => handleSuggestedPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-[18px]">
                {messages.map((message) => {
                  const charts = getChartsFromMessage(message);
                  const toolsInProgress = hasToolActivity(message);
                  const textContent = getTextFromMessage(message);

                  return (
                    <div key={message.id}>
                      {message.role === 'user' && (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] pr-0.5">
                            You
                          </span>
                          <div className="max-w-[85%] rounded-xl bg-[var(--bg-elevated)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-primary)]">
                            {textContent}
                          </div>
                        </div>
                      )}

                      {message.role === 'assistant' && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                            Analyst
                          </span>
                          <div className="space-y-2">
                            {textContent && (
                              <div className="chat-markdown text-[13px] leading-[1.65] text-[var(--text-secondary)]">
                                <ReactMarkdown>{textContent}</ReactMarkdown>
                              </div>
                            )}

                            {toolsInProgress && (
                              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Analyzing your data...
                              </div>
                            )}

                            {charts.map((chart, idx) => (
                              <button
                                key={idx}
                                className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 transition hover:border-[var(--border-hover)]"
                                onClick={() => setExpandedChart(chart)}
                              >
                                <div className="mb-1 text-[10px] font-medium text-[var(--text-muted)]">
                                  {chart.title}
                                </div>
                                <div className="h-36">
                                  <ChartRenderer spec={{ ...chart, title: '' }} />
                                </div>
                                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                                  Click to expand
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--border)] px-4 pb-3.5 pt-2.5">
            <form
              className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] pl-3.5 pr-1 py-1 focus-within:border-[var(--border-hover)] transition"
              onSubmit={handleSubmit}
            >
              <input
                className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                disabled={isLoading}
                placeholder="Ask about your finances..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <button
                className="ml-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white transition hover:opacity-85 disabled:opacity-30"
                disabled={isLoading || !inputValue.trim()}
                type="submit"
              >
                <svg
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </form>
            <div className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
              &#8984;K to toggle
            </div>
          </div>
        </div>
      </div>

      <ChartModal spec={expandedChart} onClose={() => setExpandedChart(null)} onPin={pinChart} />
    </>
  );
}
