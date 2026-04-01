import type { UIMessage } from 'ai';

export interface ChatConversation {
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'financeos-chat-history';
const MAX_CONVERSATIONS = 50;

export function loadConversations(): ChatConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: ChatConversation[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export function saveConversation(conversation: ChatConversation): void {
  const conversations = loadConversations();
  const idx = conversations.findIndex((c) => c.id === conversation.id);
  if (idx >= 0) {
    conversations[idx] = conversation;
  } else {
    conversations.unshift(conversation);
  }
  saveConversations(conversations);
}

export function deleteConversation(id: string): void {
  const conversations = loadConversations();
  saveConversations(conversations.filter((c) => c.id !== id));
}

export function generateTitle(messages: UIMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return 'New chat';
  const text = firstUserMsg.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join(' ')
    .trim();
  if (!text) return 'New chat';
  return text.length > 40 ? text.slice(0, 40) + '…' : text;
}

export function groupByDate(
  conversations: ChatConversation[]
): { label: string; conversations: ChatConversation[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const groups: Record<string, ChatConversation[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    Earlier: [],
  };

  for (const conv of conversations) {
    const d = new Date(conv.updatedAt);
    if (d >= today) groups['Today'].push(conv);
    else if (d >= yesterday) groups['Yesterday'].push(conv);
    else if (d >= weekAgo) groups['This week'].push(conv);
    else groups['Earlier'].push(conv);
  }

  return Object.entries(groups)
    .filter(([, convs]) => convs.length > 0)
    .map(([label, convs]) => ({ label, conversations: convs }));
}
