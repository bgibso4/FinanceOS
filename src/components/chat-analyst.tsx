'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { v4 as uuid } from 'uuid';
import { Drawer } from './ui/drawer';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ChartRenderer } from './chart-renderer';
import { ChartModal } from './chart-modal';
import { ChartSpec } from '@/lib/types';
import { loadPinned, savePinned } from '@/lib/pinned';
import ReactMarkdown from 'react-markdown';
import { ds } from '@/lib/design-system';

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
  const [expandedChart, setExpandedChart] = useState<ChartSpec | null>(null);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: chatTransport,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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

  // Auto-pin charts when the agent calls the pinChart tool
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts) {
        const toolName =
          part.type === 'dynamic-tool'
            ? (part as { toolName: string }).toolName
            : typeof part.type === 'string' && part.type.startsWith('tool-')
              ? part.type.slice(5)
              : null;
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

  // Extract text content from message parts
  const getTextFromMessage = (message: UIMessage): string => {
    return message.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('');
  };

  // Resolve tool name from a message part.
  // AI SDK v6 typed tools use type 'tool-<name>', dynamic tools use 'dynamic-tool' + toolName.
  const getToolName = (part: (typeof messages)[number]['parts'][number]): string | null => {
    if (part.type === 'dynamic-tool') return (part as { toolName: string }).toolName;
    if (typeof part.type === 'string' && part.type.startsWith('tool-')) return part.type.slice(5);
    return null;
  };

  // Extract chart specs from tool invocations in a message
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

  // Check if a message has tool calls still in progress
  const hasToolActivity = (message: UIMessage): boolean => {
    return message.parts.some((part) => {
      if (!getToolName(part)) return false;
      const state = (part as { state: string }).state;
      return state !== 'output-available' && state !== 'output-error';
    });
  };

  const handleSuggestedPrompt = (prompt: string) => {
    sendMessage({ text: prompt });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    sendMessage({ text: inputValue });
    setInputValue('');
  };

  return (
    <>
      <Drawer open={open} title="Finance Analyst" onClose={onClose}>
        <div className="flex h-full flex-col">
          {/* Messages area */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pb-4">
            {messages.length === 0 && (
              <div className="space-y-3 pt-4">
                <p className={`text-sm ${ds.text.muted}`}>
                  Ask me anything about your finances. Try:
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      className={`rounded-full border px-3 py-1.5 text-xs ${ds.border.default} ${ds.text.secondary} ${ds.bg.hover} transition`}
                      onClick={() => handleSuggestedPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => {
              const charts = getChartsFromMessage(message);
              const toolsInProgress = hasToolActivity(message);
              const textContent = getTextFromMessage(message);

              return (
                <div key={message.id}>
                  {message.role === 'user' && (
                    <div className="flex justify-end">
                      <div
                        className={`max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm ${ds.bg.tertiary} ${ds.text.primary}`}
                      >
                        {textContent}
                      </div>
                    </div>
                  )}

                  {message.role === 'assistant' && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] space-y-2">
                        {textContent && (
                          <div
                            className={`chat-markdown rounded-2xl rounded-bl-sm px-3 py-2 text-sm ${ds.bg.secondary} ${ds.text.primary}`}
                          >
                            <ReactMarkdown>{textContent}</ReactMarkdown>
                          </div>
                        )}

                        {toolsInProgress && (
                          <div className={`flex items-center gap-2 px-3 text-xs ${ds.text.muted}`}>
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Analyzing your data...
                          </div>
                        )}

                        {charts.map((chart, idx) => (
                          <button
                            key={idx}
                            className={`w-full cursor-pointer rounded-lg border p-2 transition ${ds.border.default} ${ds.bg.primary} ${ds.border.hover}`}
                            onClick={() => setExpandedChart(chart)}
                          >
                            <div className={`mb-1 text-xs font-medium ${ds.text.secondary}`}>
                              {chart.title}
                            </div>
                            <div className="h-40">
                              <ChartRenderer spec={{ ...chart, title: '' }} />
                            </div>
                            <div className={`mt-1 text-xs ${ds.text.muted}`}>Click to expand</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Input area */}
          <form
            className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-700"
            id="chat-form"
            onSubmit={handleSubmit}
          >
            <Input
              disabled={isLoading}
              placeholder="Ask about your finances..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <Button disabled={isLoading || !inputValue.trim()} type="submit">
              {isLoading ? '...' : 'Send'}
            </Button>
          </form>
        </div>
      </Drawer>

      <ChartModal spec={expandedChart} onClose={() => setExpandedChart(null)} onPin={pinChart} />
    </>
  );
}
