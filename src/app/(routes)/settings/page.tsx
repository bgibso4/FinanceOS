'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';
import { getCurrencyFlag } from '@/lib/currency';
import { SyncStatusBadge } from '@/components/plaid/SyncStatusBadge'; // Used for both Plaid and Teller
import { triggerSync } from '@/lib/cloud-sync';
import { ConnectedInstitutions } from '@/components/teller/ConnectedInstitutions';
import { TellerAccountLinkSelector } from '@/components/teller/TellerAccountLinkSelector';
import { PlaidAccountLinkSelector } from '@/components/plaid/PlaidAccountLinkSelector';
import { PlaidReconnectButton } from '@/components/plaid/PlaidReconnectButton';
import { SyncSettings } from '@/components/sync-settings';
import { RulesTab } from '@/components/rules/RulesTab';
import { getTagColors } from '@/components/tag-input';

type PlaidConnection = {
  id: string;
  status: string;
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastSyncError: string | null;
  plaidEnrollmentId: string;
  plaidEnrollment: {
    id: string;
    institutionName: string;
    status: string;
  } | null;
};
type TellerConnection = {
  id: string;
  status: string;
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastSyncError: string | null;
  tellerAccountName: string | null;
  tellerEnrollment: {
    institutionName: string;
  } | null;
};
type Account = {
  id: string;
  name: string;
  type: string;
  institution?: string | null;
  isActive?: boolean;
  currency?: string;
  trackingMode?: 'cash_flow' | 'balance_only';
  invertAmounts?: boolean;
  sortOrder?: number;
  plaidConnection?: PlaidConnection | null;
  tellerConnection?: TellerConnection | null;
};
type AccountBalance = { id: string; balance: number };
type Category = { id: string; name: string; type: string; parentId?: string | null };
type Rule = {
  id: string;
  conditions: string;
  priority: number;
  isEnabled: boolean;
  categoryId: string | null;
  renameTo: string | null;
  description: string | null;
};
type Snapshot = {
  id: string;
  month: string;
  incomeTotal: number;
  spendingTotal: number;
  savingsRatePct: number;
};
type Budget = {
  id: string;
  month: string;
  categoryId: string;
  limitAmount: number;
  category?: Category;
  isOverride?: boolean;
};
type ExchangeRate = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  updatedAt: string;
};
type UserSettings = { id: string; baseCurrency: string };

type SyncAllAccountStatus = 'idle' | 'previewing' | 'preview_done' | 'syncing' | 'synced' | 'error';

type SyncAllAccountResult = {
  accountId: string;
  accountName: string;
  connectionType: 'plaid' | 'teller';
  status: SyncAllAccountStatus;
  error?: string;
  preview?: {
    stats: { added: number; skippedDuplicates: number; skippedPending: number; merged: number };
    dateRange: { from: string; to: string };
    totalFetched: number;
  };
  syncResult?: {
    added: number;
    modified: number;
    removed: number;
    merged?: number;
    skippedOld?: number;
  };
};

// Strip emojis for sorting purposes
const stripEmojis = (str: string) =>
  str.replace(/[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '').trim();

const sortByName = (a: { name: string }, b: { name: string }) =>
  stripEmojis(a.name).localeCompare(stripEmojis(b.name));

// Format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Helper function to get account type icon and color
const getAccountStyle = (type: string) => {
  switch (type) {
    case 'checking':
      return {
        icon: '🏦',
        color: `${ds.status.info.bg} ${ds.status.info.border}`,
        textColor: ds.status.info.text,
      };
    case 'credit':
      return {
        icon: '💳',
        color: `${ds.status.error.bg} ${ds.status.error.border}`,
        textColor: ds.status.error.text,
      };
    case 'brokerage':
      return {
        icon: '📈',
        color: `${ds.status.success.bg} ${ds.status.success.border}`,
        textColor: ds.status.success.text,
      };
    case 'retirement':
      return {
        icon: '🏖️',
        color: `${ds.status.purple.bg} ${ds.status.purple.border}`,
        textColor: ds.status.purple.text,
      };
    case 'crypto':
      return {
        icon: '₿',
        color: 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800',
        textColor: 'text-orange-700 dark:text-orange-400',
      };
    case 'cash':
      return {
        icon: '💵',
        color: `${ds.status.success.bg} ${ds.status.success.border}`,
        textColor: ds.status.success.text,
      };
    case 'loan':
      return {
        icon: '🏠',
        color: `${ds.status.warning.bg} ${ds.status.warning.border}`,
        textColor: ds.status.warning.text,
      };
    default:
      return {
        icon: '🏛️',
        color: `${ds.bg.secondary} ${ds.border.default}`,
        textColor: ds.text.primary,
      };
  }
};

// Helper function to get bank logo/icon
const getBankLogo = (institution: string | null | undefined) => {
  if (!institution) return null;
  const bank = institution.toLowerCase();

  if (bank.includes('chase')) return '🔷';
  if (bank.includes('bank of america') || bank.includes('boa')) return '🔴';
  if (bank.includes('wells fargo')) return '🟡';
  if (bank.includes('citi')) return '🔵';
  if (bank.includes('capital one')) return '🟠';
  if (bank.includes('american express') || bank.includes('amex')) return '💙';
  if (bank.includes('discover')) return '🟤';
  if (bank.includes('goldman sachs')) return '⚫';
  if (bank.includes('morgan')) return '🔷';
  if (bank.includes('schwab')) return '🟦';
  if (bank.includes('fidelity')) return '🟢';
  if (bank.includes('vanguard')) return '🔶';

  return '🏛️';
};

// Helper function to get bank background image
const getBankBackground = (institution: string | null | undefined) => {
  if (!institution) return null;
  const bank = institution.toLowerCase();

  if (bank.includes('chase')) return '/images/banks/chase_card_bg.png';
  if (bank.includes('rbc') || bank.includes('royal bank')) return '/images/banks/rbc_card_bg.png';
  if (bank.includes('bilt')) return '/images/banks/bilt_card_bg.png';
  if (bank.includes('scotia')) return '/images/banks/scotiabank_card_bg.png';
  if (bank.includes('splitwise')) return '/images/banks/splitwise_card_bg.png';
  if (bank.includes('fidelity')) return '/images/banks/fidelity_card_bg.png';
  if (bank.includes('schwab')) return '/images/banks/schwab_card_bg.png';
  if (bank.includes('canada life')) return '/images/banks/canada_life_card_bg.png';
  if (bank.includes('nslsc')) return '/images/banks/nslsc_card_bg.png';
  if (bank.includes('questrade')) return '/images/banks/questrade_card_bg.png';
  if (bank.includes('trust') && bank.includes('crypto'))
    return '/images/banks/trust_crypto_card_bg.png';

  return null;
};

// Sortable Account Card Component
function SortableAccountCard({
  account,
  balance,
  onOpenModal,
}: {
  account: Account;
  balance: number;
  onOpenModal: (account: Account) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  const accountStyle = getAccountStyle(account.type);
  const bankBg = getBankBackground(account.institution);
  const isArchived = account.isActive === false;

  // Render card with bank background
  if (bankBg) {
    return (
      <div
        ref={setNodeRef}
        className={`relative rounded-xl overflow-hidden shadow-md hover:shadow-lg transition-all ${isArchived ? 'opacity-60' : ''} ${isDragging ? 'shadow-2xl' : ''}`}
        style={style}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 right-2 z-10 cursor-grab active:cursor-grabbing p-1 rounded bg-black/20 backdrop-blur-sm hover:bg-black/40 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M4 8h16M4 16h16"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        </div>

        <div
          className="cursor-pointer"
          style={{
            backgroundImage: `url(${bankBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            aspectRatio: '1.8 / 1',
          }}
          onClick={() => onOpenModal(account)}
        >
          {/* Lighter gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-transparent to-transparent" />

          <div className="relative h-full p-3 flex flex-col justify-between">
            {/* Top section - Account name and type */}
            <div>
              <h3 className="font-bold text-base text-white drop-shadow-lg">{account.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-white font-medium backdrop-blur-sm">
                  {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                </span>
                {account.trackingMode === 'balance_only' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/50 text-white font-medium backdrop-blur-sm">
                    Net Worth Only
                  </span>
                )}
                {isArchived && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/50 text-white font-medium backdrop-blur-sm">
                    Archived
                  </span>
                )}
              </div>
            </div>

            {/* Bottom section - Balance prominent, Institution smaller */}
            <div>
              <div
                className={`text-xl font-bold drop-shadow-lg ${balance >= 0 ? 'text-white' : 'text-red-300'}`}
              >
                {formatCurrency(balance)}
              </div>
              <div className="text-white/70 text-xs font-medium mt-0.5">{account.institution}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default card without background image
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 ${accountStyle.color} ${isArchived ? `opacity-60 ${ds.bg.secondary}` : ds.bg.primary} p-4 shadow-sm hover:shadow-md transition-shadow ${isDragging ? 'shadow-2xl' : ''}`}
      style={style}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className={`absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 rounded ${ds.bg.tertiary} hover:${ds.bg.secondary} transition-colors`}
        onClick={(e) => e.stopPropagation()}
      >
        <svg
          className={`w-4 h-4 ${ds.text.muted}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M4 8h16M4 16h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
      </div>

      <div className="cursor-pointer" onClick={() => onOpenModal(account)}>
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="text-xl">{accountStyle.icon}</div>
              <div>
                <h3 className={`font-semibold text-base ${ds.text.primary} leading-tight`}>
                  {account.name}
                  {isArchived && (
                    <span className={`text-xs ${ds.text.muted} ml-2`}>(Archived)</span>
                  )}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    className={`text-xs px-2 py-1 ${accountStyle.textColor} bg-transparent border-current`}
                  >
                    {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                  </Badge>
                  {account.trackingMode === 'balance_only' && (
                    <Badge
                      className={`text-xs px-2 py-1 ${ds.status.purple.text} bg-transparent border-current`}
                    >
                      Net Worth Only
                    </Badge>
                  )}
                  {isArchived && (
                    <Badge
                      className={`text-xs px-2 py-1 ${ds.text.muted} bg-transparent border-current`}
                    >
                      Archived
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className={`text-lg font-bold ${balance >= 0 ? ds.text.primary : 'text-red-600'}`}>
              {formatCurrency(balance)}
            </div>
          </div>
          {account.institution && (
            <div className={`flex items-center gap-2 text-sm ${ds.text.secondary} font-medium`}>
              <span className="text-base">{getBankLogo(account.institution)}</span>
              {account.institution}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsPageContent() {
  const _router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'general';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBalances, setAccountBalances] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [_snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [defaultBudgets, setDefaultBudgets] = useState<Budget[]>([]);
  const [budgetViewMonth, setBudgetViewMonth] = useState<string>(''); // empty = "All months" (defaults)
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [inflationRates, setInflationRates] = useState<
    { id: string; year: number; rate: number; updatedAt: string }[]
  >([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);

  // Tags state
  type TagWithCount = { id: string; name: string; color: string; transactionCount?: number };
  const [settingsTags, setSettingsTags] = useState<TagWithCount[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('blue');
  const [editingTag, setEditingTag] = useState<TagWithCount | null>(null);
  const [editTagModalOpen, setEditTagModalOpen] = useState(false);
  const [newExchangeRate, setNewExchangeRate] = useState({
    fromCurrency: 'CAD',
    toCurrency: 'USD',
    rate: '',
  });
  const [newInflationRate, setNewInflationRate] = useState({
    year: new Date().getFullYear().toString(),
    rate: '',
  });

  const [newAccount, setNewAccount] = useState({
    name: '',
    type: 'checking',
    institution: '',
    currency: 'USD',
  });
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [modalAccount, setModalAccount] = useState<Account | null>(null);
  const [accountTransactionCount, setAccountTransactionCount] = useState(0);
  const [modalAccountBalance, setModalAccountBalance] = useState(0);
  const [reconcileTarget, setReconcileTarget] = useState('');
  const [newCategory, setNewCategory] = useState({ name: '', type: 'expense', parentId: '' });
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newGroup, setNewGroup] = useState({ name: '', type: 'expense' });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCategory, setModalCategory] = useState<Category | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [categoryTransactions, setCategoryTransactions] = useState<any[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ categoryId: '', limitAmount: '' });
  const [showArchived, setShowArchived] = useState(false);
  const [importState, setImportState] = useState({
    accountId: '',
    csvText: '',
    columns: [] as string[],
    mapping: { date: '', amount: '', merchant: '', note: '' },
    invertAmounts: false,
    status: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    summary: null as any,
  });
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{
    added: number;
    modified: number;
    removed: number;
    merged?: number;
    skippedOld?: number;
  } | null>(null);
  const [daysToSync, setDaysToSync] = useState(30);

  // Dry-run preview state
  type TransactionPreview = {
    externalId: string;
    date: string;
    amount: number;
    merchant: string;
    category: string | null;
    categoryConfidence: number;
    wouldCreate: boolean;
    wouldMerge: boolean;
    existingTransactionId: string | null;
    skipReason: string | null;
  };
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    stats: { added: number; skippedDuplicates: number; skippedPending: number; merged: number };
    transactions: TransactionPreview[];
    dateRange: { from: string; to: string };
    totalFetched: number;
  } | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Sync All state
  const [showSyncAllModal, setShowSyncAllModal] = useState(false);
  const [syncAllDays, setSyncAllDays] = useState(30);
  const [syncAllPhase, setSyncAllPhase] = useState<
    'select' | 'previewing' | 'preview' | 'syncing' | 'done'
  >('select');
  const [syncAllResults, setSyncAllResults] = useState<Map<string, SyncAllAccountResult>>(
    new Map()
  );

  const syncableAccounts = accounts.filter((a) => {
    if (!a.isActive) return false;
    const tc = a.tellerConnection;
    const pc = a.plaidConnection;
    if (tc && tc.status !== 'disconnected') return true;
    if (pc && pc.status !== 'needs_reauth') return true;
    return false;
  });

  // Drag-and-drop sensors for account reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end for account reordering
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const filteredAccounts = accounts.filter((a) => showArchived || (a.isActive ?? true));
      const oldIndex = filteredAccounts.findIndex((a) => a.id === active.id);
      const newIndex = filteredAccounts.findIndex((a) => a.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        // Reorder the filtered accounts
        const reorderedFiltered = arrayMove(filteredAccounts, oldIndex, newIndex);

        // Build the full new order: reordered visible accounts + hidden accounts in their original order
        const hiddenAccounts = accounts.filter((a) => !(showArchived || (a.isActive ?? true)));
        const newOrder = [...reorderedFiltered, ...hiddenAccounts];

        // Update local state immediately for responsiveness
        setAccounts(newOrder);

        // Persist to backend
        try {
          await fetch('/api/accounts/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountIds: newOrder.map((a) => a.id) }),
          });
        } catch (error) {
          console.error('Failed to save account order:', error);
          // Revert on error by refreshing from server
          const res = await fetch('/api/accounts');
          const data = await res.json();
          setAccounts(data.accounts ?? []);
        }
      }
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch budgets based on view mode
  useEffect(() => {
    const fetchBudgets = async () => {
      // Always fetch defaults
      const defaultsRes = await fetch('/api/budgets/defaults');
      const defaultsData = await defaultsRes.json();
      setDefaultBudgets(defaultsData.budgets ?? []);

      if (budgetViewMonth) {
        // Viewing a specific month - fetch merged budgets
        const monthRes = await fetch(`/api/budgets/${budgetViewMonth}`);
        const monthData = await monthRes.json();
        setBudgets(monthData.budgets ?? []);
      } else {
        // Viewing "All months" - show defaults
        setBudgets(defaultsData.budgets ?? []);
      }
    };
    fetchBudgets();
  }, [budgetViewMonth]);

  const refresh = async () => {
    const [acc, cat, r, rep, bal, rates, settings, tagsData, inflationData] = await Promise.all([
      fetch('/api/accounts').then((r) => r.json()),
      fetch('/api/categories').then((r) => r.json()),
      fetch('/api/rules').then((r) => r.json()),
      fetch('/api/reports/monthly').then((r) => r.json()),
      fetch('/api/accounts/balances').then((r) => r.json()),
      fetch('/api/exchange-rates').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
      fetch('/api/tags?withCounts=true').then((r) => r.json()),
      fetch('/api/inflation-rates').then((r) => r.json()),
    ]);
    setAccounts(acc.accounts ?? []);
    setCategories(cat.categories ?? []);
    setRules(r.rules ?? []);
    setSnapshots(rep.snapshots ?? []);
    setExchangeRates(rates.rates ?? []);
    setInflationRates(inflationData.rates ?? []);
    setUserSettings(settings.settings ?? null);
    setSettingsTags(tagsData.tags ?? []);

    // Build balance map
    const balanceMap = new Map<string, number>();
    (bal.accounts ?? []).forEach((a: AccountBalance) => {
      balanceMap.set(a.id, a.balance);
    });
    setAccountBalances(balanceMap);

    // Refresh budgets based on current view
    const defaultsRes = await fetch('/api/budgets/defaults');
    const defaultsData = await defaultsRes.json();
    setDefaultBudgets(defaultsData.budgets ?? []);

    if (budgetViewMonth) {
      const monthRes = await fetch(`/api/budgets/${budgetViewMonth}`);
      const monthData = await monthRes.json();
      setBudgets(monthData.budgets ?? []);
    } else {
      setBudgets(defaultsData.budgets ?? []);
    }
  };

  // ── Targeted refresh helpers (avoid refetching all 9-11 endpoints) ──

  const refreshAccounts = async () => {
    const [acc, bal] = await Promise.all([
      fetch('/api/accounts').then((r) => r.json()),
      fetch('/api/accounts/balances').then((r) => r.json()),
    ]);
    setAccounts(acc.accounts ?? []);
    const balanceMap = new Map<string, number>();
    (bal.accounts ?? []).forEach((a: AccountBalance) => {
      balanceMap.set(a.id, a.balance);
    });
    setAccountBalances(balanceMap);
  };

  const refreshCategories = async () => {
    const catData = await fetch('/api/categories').then((r) => r.json());
    setCategories(catData.categories ?? []);
  };

  const refreshRules = async () => {
    const rData = await fetch('/api/rules').then((r) => r.json());
    setRules(rData.rules ?? []);
  };

  const refreshTags = async () => {
    const tagsData = await fetch('/api/tags?withCounts=true').then((r) => r.json());
    setSettingsTags(tagsData.tags ?? []);
  };

  const refreshBudgets = async () => {
    const defaultsRes = await fetch('/api/budgets/defaults');
    const defaultsData = await defaultsRes.json();
    setDefaultBudgets(defaultsData.budgets ?? []);

    if (budgetViewMonth) {
      const monthRes = await fetch(`/api/budgets/${budgetViewMonth}`);
      const monthData = await monthRes.json();
      setBudgets(monthData.budgets ?? []);
    } else {
      setBudgets(defaultsData.budgets ?? []);
    }
  };

  const refreshExchangeRates = async () => {
    const ratesData = await fetch('/api/exchange-rates').then((r) => r.json());
    setExchangeRates(ratesData.rates ?? []);
  };

  const refreshInflationRates = async () => {
    const inflationData = await fetch('/api/inflation-rates').then((r) => r.json());
    setInflationRates(inflationData.rates ?? []);
  };

  const createAccount = async () => {
    await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAccount),
    });
    setNewAccount({ name: '', type: 'checking', institution: '', currency: 'USD' });
    refreshAccounts();
    triggerSync();
  };

  const openAccountModal = async (account: Account) => {
    setModalAccount(account);
    setAccountModalOpen(true);
    setReconcileTarget('');

    // Get transaction count and balance for this account
    try {
      const response = await fetch(`/api/transactions?account=${account.id}`);
      const data = await response.json();
      setAccountTransactionCount(data.transactions?.length || 0);

      // Calculate balance from transactions
      const balance = (data.transactions || []).reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sum: number, tx: any) => sum + tx.amount,
        0
      );
      setModalAccountBalance(balance);
    } catch (_error) {
      setAccountTransactionCount(0);
      setModalAccountBalance(0);
    }
  };

  const closeAccountModal = () => {
    setAccountModalOpen(false);
    setModalAccount(null);
    setAccountTransactionCount(0);
    setModalAccountBalance(0);
    setReconcileTarget('');
    setSyncResult(null);
  };

  const _handlePlaidSuccess = async (
    publicToken: string,
    metadata: { accounts?: { id: string }[]; institution?: { name: string } }
  ) => {
    if (!modalAccount) return;

    const plaidAccountId = metadata.accounts?.[0]?.id;
    const institutionName = metadata.institution?.name;

    if (!plaidAccountId) {
      alert('No account selected from Plaid');
      return;
    }

    try {
      const res = await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicToken,
          accountId: modalAccount.id,
          plaidAccountId,
          institutionName,
        }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      // Refresh to get updated connection status
      await refreshAccounts();
      // Re-open modal with updated account
      const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
      const updatedAccount = updatedAccounts.accounts?.find(
        (a: Account) => a.id === modalAccount.id
      );
      if (updatedAccount) {
        setModalAccount(updatedAccount);
      }
    } catch (_error) {
      alert('Failed to connect bank account');
    }
  };

  const handlePlaidSync = async () => {
    if (!modalAccount) return;

    setSyncingAccountId(modalAccount.id);
    setSyncResult(null);

    try {
      const res = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: modalAccount.id, daysToSync }),
      });

      const data = await res.json();
      if (data.error) {
        if (data.code === 'NEEDS_REAUTH') {
          // Refresh to show reconnect button
          await refreshAccounts();
          const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
          const updatedAccount = updatedAccounts.accounts?.find(
            (a: Account) => a.id === modalAccount.id
          );
          if (updatedAccount) setModalAccount(updatedAccount);
        }
        alert(data.error);
        return;
      }

      setSyncResult({
        added: data.added,
        modified: data.modified,
        removed: data.removed,
        skippedOld: data.skippedOld,
      });
      await refreshAccounts();

      // Re-open modal with updated account
      const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
      const updatedAccount = updatedAccounts.accounts?.find(
        (a: Account) => a.id === modalAccount.id
      );
      if (updatedAccount) {
        setModalAccount(updatedAccount);
        // Update balance
        const txRes = await fetch(`/api/transactions?account=${modalAccount.id}`);
        const txData = await txRes.json();
        const balance = (txData.transactions || []).reduce(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sum: number, tx: any) => sum + tx.amount,
          0
        );
        setModalAccountBalance(balance);
        setAccountTransactionCount(txData.transactions?.length || 0);
      }
    } catch (_error) {
      alert('Failed to sync transactions');
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handlePlaidPreview = async () => {
    if (!modalAccount) return;

    setPreviewLoading(true);
    setPreviewResult(null);

    try {
      const res = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: modalAccount.id,
          daysToSync,
          dryRun: true,
        }),
      });

      const data = await res.json();
      if (data.error) {
        if (data.code === 'NEEDS_REAUTH') {
          // Refresh to show reconnect button
          await refreshAccounts();
          const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
          const updatedAccount = updatedAccounts.accounts?.find(
            (a: Account) => a.id === modalAccount.id
          );
          if (updatedAccount) setModalAccount(updatedAccount);
        }
        alert(data.error);
        return;
      }

      setPreviewResult({
        stats: data.stats,
        transactions: data.transactions,
        dateRange: data.dateRange,
        totalFetched: data.totalFetched,
      });
      setShowPreviewModal(true);
    } catch (_error) {
      alert('Failed to preview transactions');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePlaidDisconnect = async () => {
    if (!modalAccount) return;

    if (!confirm('Disconnect this bank account? Your existing transactions will be preserved.')) {
      return;
    }

    try {
      const res = await fetch('/api/plaid/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: modalAccount.id }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      await refreshAccounts();
      // Update modal account
      setModalAccount({ ...modalAccount, plaidConnection: null });
    } catch (_error) {
      alert('Failed to disconnect');
    }
  };

  const handlePlaidResetCursor = async () => {
    if (!modalAccount) return;

    if (
      !confirm(
        'Reset sync cursor? The next sync will re-fetch all transactions (duplicates will be skipped, but this lets you re-import with different date settings).'
      )
    ) {
      return;
    }

    try {
      const res = await fetch('/api/plaid/reset-cursor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: modalAccount.id }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      alert('Cursor reset! Next sync will start fresh.');
      await refreshAccounts();
      const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
      const updatedAccount = updatedAccounts.accounts?.find(
        (a: Account) => a.id === modalAccount.id
      );
      if (updatedAccount) setModalAccount(updatedAccount);
    } catch (_error) {
      alert('Failed to reset cursor');
    }
  };

  const _handleTellerSuccess = async (payload: {
    accessToken: string;
    enrollmentId: string;
    tellerAccountId: string;
    institutionName: string;
  }) => {
    console.log('[Settings] handleTellerSuccess called with payload:', {
      hasAccessToken: !!payload.accessToken,
      enrollmentId: payload.enrollmentId,
      tellerAccountId: payload.tellerAccountId,
      institutionName: payload.institutionName,
      modalAccountId: modalAccount?.id,
    });

    if (!modalAccount) {
      console.error('[Settings] No modal account set!');
      return;
    }

    try {
      console.log('[Settings] Sending POST to /api/teller/connect...');
      const res = await fetch('/api/teller/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: payload.accessToken,
          accountId: modalAccount.id,
          tellerAccountId: payload.tellerAccountId,
          enrollmentId: payload.enrollmentId,
          institutionName: payload.institutionName,
        }),
      });

      console.log('[Settings] Response status:', res.status);
      const data = await res.json();
      console.log('[Settings] Response data:', data);

      if (data.error) {
        console.error('[Settings] API returned error:', data.error);
        alert(data.error);
        return;
      }

      console.log('[Settings] Connection successful! Refreshing data...');
      // Refresh to get updated connection status
      await refreshAccounts();
      // Re-open modal with updated account
      const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
      const updatedAccount = updatedAccounts.accounts?.find(
        (a: Account) => a.id === modalAccount.id
      );
      if (updatedAccount) {
        setModalAccount(updatedAccount);
      }
      console.log('[Settings] Refresh complete');
    } catch (error) {
      console.error('[Settings] Exception during connection:', error);
      alert('Failed to connect bank account');
    }
  };

  const handleTellerSync = async () => {
    if (!modalAccount) return;

    setSyncingAccountId(modalAccount.id);
    setSyncResult(null);

    try {
      const res = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: modalAccount.id, daysToSync }),
      });

      const data = await res.json();
      if (data.error) {
        if (data.code === 'AUTH_EXPIRED') {
          // Refresh to show reconnect button
          await refreshAccounts();
          const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
          const updatedAccount = updatedAccounts.accounts?.find(
            (a: Account) => a.id === modalAccount.id
          );
          if (updatedAccount) setModalAccount(updatedAccount);
        }
        alert(data.error);
        return;
      }

      setSyncResult({
        added: data.added,
        modified: data.modified,
        removed: data.removed,
        merged: data.merged,
        skippedOld: data.skippedPending,
      });
      await refreshAccounts();

      // Re-open modal with updated account
      const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
      const updatedAccount = updatedAccounts.accounts?.find(
        (a: Account) => a.id === modalAccount.id
      );
      if (updatedAccount) {
        setModalAccount(updatedAccount);
        // Update balance
        const txRes = await fetch(`/api/transactions?account=${modalAccount.id}`);
        const txData = await txRes.json();
        const balance = (txData.transactions || []).reduce(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sum: number, tx: any) => sum + tx.amount,
          0
        );
        setModalAccountBalance(balance);
        setAccountTransactionCount(txData.transactions?.length || 0);
      }
    } catch (_error) {
      alert('Failed to sync transactions');
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handleTellerPreview = async () => {
    if (!modalAccount) return;

    setPreviewLoading(true);
    setPreviewResult(null);

    try {
      const res = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: modalAccount.id,
          daysToSync,
          dryRun: true,
        }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      setPreviewResult({
        stats: data.stats,
        transactions: data.transactions,
        dateRange: data.dateRange,
        totalFetched: data.totalFetched,
      });
      setShowPreviewModal(true);
    } catch (_error) {
      alert('Failed to preview transactions');
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Sync All handlers ──

  const handleSyncAllPreview = async () => {
    setSyncAllPhase('previewing');

    const initialResults = new Map<string, SyncAllAccountResult>();
    for (const account of syncableAccounts) {
      const connectionType = account.tellerConnection ? 'teller' : 'plaid';
      initialResults.set(account.id, {
        accountId: account.id,
        accountName: account.name,
        connectionType,
        status: 'previewing',
      });
    }
    setSyncAllResults(new Map(initialResults));

    const promises = syncableAccounts.map(async (account) => {
      const connectionType = account.tellerConnection ? 'teller' : 'plaid';
      const endpoint = connectionType === 'teller' ? '/api/teller/sync' : '/api/plaid/sync';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: account.id,
            daysToSync: syncAllDays,
            dryRun: true,
          }),
        });

        const data = await res.json();

        if (data.error) {
          setSyncAllResults((prev) => {
            const next = new Map(prev);
            const existing = next.get(account.id);
            if (existing) next.set(account.id, { ...existing, status: 'error', error: data.error });
            return next;
          });
          return;
        }

        setSyncAllResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(account.id);
          if (existing) {
            next.set(account.id, {
              ...existing,
              status: 'preview_done',
              preview: {
                stats: data.stats,
                dateRange: data.dateRange,
                totalFetched: data.totalFetched,
              },
            });
          }
          return next;
        });
      } catch (_error) {
        setSyncAllResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(account.id);
          if (existing)
            next.set(account.id, { ...existing, status: 'error', error: 'Network error' });
          return next;
        });
      }
    });

    await Promise.allSettled(promises);
    setSyncAllPhase('preview');
  };

  const handleSyncAllConfirm = async () => {
    setSyncAllPhase('syncing');

    const accountsToSync = Array.from(syncAllResults.values()).filter(
      (r) =>
        r.status === 'preview_done' &&
        r.preview &&
        (r.preview.stats.added > 0 || r.preview.stats.merged > 0)
    );

    setSyncAllResults((prev) => {
      const next = new Map(prev);
      for (const a of accountsToSync) {
        const existing = next.get(a.accountId);
        if (existing) next.set(a.accountId, { ...existing, status: 'syncing' });
      }
      return next;
    });

    const promises = accountsToSync.map(async (accountResult) => {
      const endpoint =
        accountResult.connectionType === 'teller' ? '/api/teller/sync' : '/api/plaid/sync';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: accountResult.accountId,
            daysToSync: syncAllDays,
          }),
        });

        const data = await res.json();

        if (data.error) {
          setSyncAllResults((prev) => {
            const next = new Map(prev);
            const existing = next.get(accountResult.accountId);
            if (existing)
              next.set(accountResult.accountId, {
                ...existing,
                status: 'error',
                error: data.error,
              });
            return next;
          });
          return;
        }

        setSyncAllResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(accountResult.accountId);
          if (existing) {
            next.set(accountResult.accountId, {
              ...existing,
              status: 'synced',
              syncResult: {
                added: data.added,
                modified: data.modified,
                removed: data.removed,
                merged: data.merged,
                skippedOld: data.skippedOld ?? data.skippedPending,
              },
            });
          }
          return next;
        });
      } catch (_error) {
        setSyncAllResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(accountResult.accountId);
          if (existing)
            next.set(accountResult.accountId, {
              ...existing,
              status: 'error',
              error: 'Network error',
            });
          return next;
        });
      }
    });

    await Promise.allSettled(promises);

    // Run recurring transaction detection after sync completes
    try {
      await fetch('/api/recurring/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (_err) {
      // Non-critical — don't block sync completion
      console.warn('Recurring detection after sync failed');
    }

    setSyncAllPhase('done');
    await refreshAccounts();
  };

  const handleSyncAllClose = () => {
    setShowSyncAllModal(false);
    setSyncAllPhase('select');
    setSyncAllResults(new Map());
    setSyncAllDays(30);
  };

  const handleTellerDisconnect = async () => {
    if (!modalAccount) return;

    if (!confirm('Disconnect this bank account? Your existing transactions will be preserved.')) {
      return;
    }

    try {
      const res = await fetch('/api/teller/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: modalAccount.id }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      await refreshAccounts();
      // Update modal account
      setModalAccount({ ...modalAccount, tellerConnection: null });
    } catch (_error) {
      alert('Failed to disconnect');
    }
  };

  const updateModalAccount = async () => {
    if (!modalAccount) return;
    await fetch(`/api/accounts/${modalAccount.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: modalAccount.name,
        type: modalAccount.type,
        institution: modalAccount.institution,
        currency: modalAccount.currency,
        trackingMode: modalAccount.trackingMode,
        invertAmounts: modalAccount.invertAmounts,
      }),
    });
    closeAccountModal();
    refreshAccounts();
  };

  const deleteAccount = async () => {
    if (!modalAccount) return;

    try {
      const response = await fetch(`/api/accounts/${modalAccount.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to delete account');
        return;
      }

      closeAccountModal();
      refreshAccounts();
      triggerSync();
    } catch (_error) {
      alert('Failed to delete account');
    }
  };

  const archiveAccount = async () => {
    if (!modalAccount) return;
    try {
      const response = await fetch(`/api/accounts/${modalAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });

      if (!response.ok) {
        alert('Failed to archive account');
        return;
      }

      closeAccountModal();
      refreshAccounts();
    } catch (_error) {
      alert('Failed to archive account');
    }
  };

  const restoreAccount = async () => {
    if (!modalAccount) return;
    try {
      const response = await fetch(`/api/accounts/${modalAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });

      if (!response.ok) {
        alert('Failed to restore account');
        return;
      }

      closeAccountModal();
      refreshAccounts();
    } catch (_error) {
      alert('Failed to restore account');
    }
  };

  const reconcileBalance = async () => {
    if (!modalAccount || !reconcileTarget) return;

    const targetBalance = parseFloat(reconcileTarget);
    if (isNaN(targetBalance)) {
      alert('Please enter a valid number');
      return;
    }

    const difference = targetBalance - modalAccountBalance;
    if (Math.abs(difference) < 0.01) {
      alert('Balance is already correct!');
      return;
    }

    try {
      const response = await fetch('/api/transactions/adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: modalAccount.id,
          amount: difference,
          note: `Balance adjustment: ${formatCurrency(modalAccountBalance)} → ${formatCurrency(targetBalance)}`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to create adjustment');
        return;
      }

      // Update the modal balance and clear input
      setModalAccountBalance(targetBalance);
      setReconcileTarget('');
      setAccountTransactionCount(accountTransactionCount + 1);
      refreshAccounts();
    } catch (_error) {
      alert('Failed to create adjustment');
    }
  };

  const createGroup = async () => {
    // Auto-determine type based on group name
    const inferGroupType = (name: string) => {
      const lowerName = name.toLowerCase();
      if (
        lowerName.includes('income') ||
        lowerName.includes('salary') ||
        lowerName.includes('earnings')
      ) {
        return 'income';
      }
      if (lowerName.includes('transfer') || lowerName.includes('account')) {
        return 'transfer';
      }
      // Default to expense for most groups (Bills, Travel, Food, etc.)
      return 'expense';
    };

    const groupType = inferGroupType(newGroup.name);

    await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newGroup.name,
        type: groupType,
        parentId: null,
      }),
    });
    setNewGroup({ name: '', type: 'expense' });
    refreshCategories();
  };

  const createCategory = async () => {
    if (!newCategory.parentId) {
      alert('Please select a group for this category');
      return;
    }

    // Find the parent group and inherit its type
    const parentGroup = categories.find((c) => c.id === newCategory.parentId);
    if (!parentGroup) {
      alert('Selected group not found');
      return;
    }

    await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newCategory.name,
        parentId: newCategory.parentId,
        type: parentGroup.type, // Inherit type from parent group
      }),
    });
    setNewCategory({ name: '', type: 'expense', parentId: '' });
    refreshCategories();
    triggerSync();
  };

  const updateCategory = async () => {
    if (!editingCategory) return;
    await fetch(`/api/categories/${editingCategory.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editingCategory.name,
        type: editingCategory.type,
      }),
    });
    setEditingCategory(null);
    refreshCategories();
    triggerSync();
  };

  const openCategoryModal = async (category: Category) => {
    setModalCategory(category);
    setModalOpen(true);
    setIsLoadingTransactions(true);

    try {
      // Fetch transactions for this category
      const response = await fetch(`/api/transactions?category=${category.id}`);
      const data = await response.json();
      setCategoryTransactions(data.transactions || []);
    } catch (error) {
      console.error('Failed to load transactions:', error);
      setCategoryTransactions([]);
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalCategory(null);
    setCategoryTransactions([]);
  };

  const unclassifyTransactions = async () => {
    if (!modalCategory) return;

    try {
      // Update all transactions in this category to have no category
      await fetch('/api/transactions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          transactionIds: categoryTransactions.map((tx) => tx.id),
          data: { categoryId: null },
        }),
      });

      // Refresh the transaction list
      const response = await fetch(`/api/transactions?category=${modalCategory.id}`);
      const data = await response.json();
      setCategoryTransactions(data.transactions || []);

      refreshCategories(); // Refresh the main data
      triggerSync();
    } catch (_error) {
      alert('Failed to unclassify transactions');
    }
  };

  const deleteCategory = async () => {
    if (!modalCategory) return;

    try {
      const response = await fetch(`/api/categories/${modalCategory.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to delete category');
        return;
      }

      closeModal();
      refreshCategories();
      triggerSync();
    } catch (_error) {
      alert('Failed to delete category');
    }
  };

  const updateModalCategory = async () => {
    if (!modalCategory) return;

    try {
      await fetch(`/api/categories/${modalCategory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: modalCategory.name,
          type: modalCategory.type,
        }),
      });

      closeModal();
      refreshCategories();
    } catch (_error) {
      alert('Failed to update category');
    }
  };

  const _closeMonth = async () => {
    await fetch('/api/reports/close-month', { method: 'POST' });
    refresh();
  };

  const saveBudget = async () => {
    if (!budgetForm.categoryId || !budgetForm.limitAmount) return;

    if (budgetViewMonth) {
      // Save as month-specific override
      await fetch(`/api/budgets/${budgetViewMonth}/${budgetForm.categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limitAmount: Number(budgetForm.limitAmount) }),
      });
    } else {
      // Save as default
      await fetch('/api/budgets/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: budgetForm.categoryId,
          limitAmount: Number(budgetForm.limitAmount),
        }),
      });
    }
    setBudgetForm({ categoryId: '', limitAmount: '' });
    refreshBudgets();
  };

  const deleteBudget = async (categoryId: string) => {
    if (budgetViewMonth) {
      // Delete month-specific override
      await fetch(`/api/budgets/${budgetViewMonth}/${categoryId}`, {
        method: 'DELETE',
      });
    } else {
      // Delete default
      await fetch(`/api/budgets/defaults?categoryId=${categoryId}`, {
        method: 'DELETE',
      });
    }
    refreshBudgets();
  };

  const removeOverride = async (categoryId: string) => {
    // Remove just the override, keeping the default
    await fetch(`/api/budgets/${budgetViewMonth}/${categoryId}`, {
      method: 'DELETE',
    });
    refreshBudgets();
  };

  const onFileSelect = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const [headerLine] = text.split(/\r?\n/);
    const columns = (headerLine ?? '').split(',').map((c) => c.trim());
    setImportState((s) => ({
      ...s,
      csvText: text,
      columns,
      mapping: {
        date: columns.find((c) => /date/i.test(c)) ?? '',
        amount: columns.find((c) => /amount|amt/i.test(c)) ?? '',
        merchant: columns.find((c) => /merchant|description|payee|vendor/i.test(c)) ?? '',
        note: columns.find((c) => /memo|note|details/i.test(c)) ?? '',
      },
    }));
  };

  const importCsv = async () => {
    if (!importState.accountId || !importState.csvText) {
      setImportState((s) => ({ ...s, status: 'Select an account and CSV file first.' }));
      return;
    }
    const body = {
      csv: importState.csvText,
      mapping: {
        date: importState.mapping.date,
        amount: importState.mapping.amount,
        merchant: importState.mapping.merchant,
        note: importState.mapping.note || undefined,
      },
      accountId: importState.accountId,
      invertAmounts: importState.invertAmounts,
    };
    setImportState((s) => ({ ...s, status: 'Uploading...' }));
    try {
      const res = await fetch('/api/import/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const summary = [
        `✅ Imported ${data.created ?? 0} new transactions`,
        data.skipped > 0 ? `⏭️ Skipped ${data.skipped} duplicates` : null,
        data.autoCategorized > 0 ? `🏷️ Auto-categorized ${data.autoCategorized}` : null,
        data.uncategorized > 0 ? `❓ ${data.uncategorized} need categorization` : null,
        data.transfersDetected > 0 ? `🔄 Detected ${data.transfersDetected} transfers` : null,
      ]
        .filter(Boolean)
        .join(' • ');

      setImportState((s) => ({ ...s, status: summary, summary: data }));
      refreshAccounts();
      triggerSync();
    } catch (err: any) {
      setImportState((s) => ({
        ...s,
        status: `Import failed: ${err?.message ?? 'unknown error'}`,
      }));
    }
  };

  const updateBaseCurrency = async (currency: string) => {
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseCurrency: currency }),
      });
      refresh();
    } catch (_error) {
      alert('Failed to update base currency');
    }
  };

  const addExchangeRate = async () => {
    if (!newExchangeRate.rate || parseFloat(newExchangeRate.rate) <= 0) {
      alert('Please enter a valid exchange rate');
      return;
    }

    try {
      const response = await fetch('/api/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromCurrency: newExchangeRate.fromCurrency,
          toCurrency: newExchangeRate.toCurrency,
          rate: parseFloat(newExchangeRate.rate),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to add exchange rate: ${error.error || 'Unknown error'}`);
        return;
      }

      setNewExchangeRate({ fromCurrency: 'CAD', toCurrency: 'USD', rate: '' });
      refreshExchangeRates();
    } catch (error) {
      console.error('Failed to add exchange rate:', error);
      alert('Failed to add exchange rate');
    }
  };

  const deleteExchangeRate = async (id: string) => {
    try {
      await fetch(`/api/exchange-rates/${id}`, {
        method: 'DELETE',
      });
      refreshExchangeRates();
    } catch (_error) {
      alert('Failed to delete exchange rate');
    }
  };

  const addInflationRate = async () => {
    const yearNum = parseInt(newInflationRate.year);
    const rateNum = parseFloat(newInflationRate.rate);

    if (!newInflationRate.year || isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
      alert('Please enter a valid year (1900-2100)');
      return;
    }
    if (!newInflationRate.rate || isNaN(rateNum) || rateNum < -50 || rateNum > 100) {
      alert('Please enter a valid rate (-50 to 100%)');
      return;
    }

    try {
      const response = await fetch('/api/inflation-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: yearNum, rate: rateNum }),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to add inflation rate: ${error.error || 'Unknown error'}`);
        return;
      }

      setNewInflationRate({ year: new Date().getFullYear().toString(), rate: '' });
      refreshInflationRates();
    } catch (error) {
      console.error('Failed to add inflation rate:', error);
      alert('Failed to add inflation rate');
    }
  };

  const deleteInflationRate = async (id: string) => {
    try {
      await fetch(`/api/inflation-rates/${id}`, {
        method: 'DELETE',
      });
      refreshInflationRates();
    } catch (_error) {
      alert('Failed to delete inflation rate');
    }
  };

  return (
    <div className="space-y-4">
      {tab === 'general' && (
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.primary}`}>General Settings</div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Currency Settings */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>💱 Currency</h4>

              {/* Base Currency */}
              <div className="space-y-3 mb-6">
                <label className={`block text-sm font-medium ${ds.text.primary}`}>
                  Base Currency
                </label>
                <Select
                  className="max-w-xs"
                  value={userSettings?.baseCurrency || 'USD'}
                  onChange={(e) => updateBaseCurrency(e.target.value)}
                >
                  <option value="USD">🇺🇸 USD - US Dollar</option>
                  <option value="CAD">🇨🇦 CAD - Canadian Dollar</option>
                  <option value="EUR">🇪🇺 EUR - Euro</option>
                  <option value="GBP">🇬🇧 GBP - British Pound</option>
                </Select>
                <div className={`text-xs ${ds.text.muted}`}>
                  All analytics and reports will be displayed in this currency
                </div>
              </div>

              {/* Exchange Rates */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className={`block text-sm font-medium ${ds.text.primary}`}>
                    Exchange Rates
                  </label>
                  <a
                    className={`text-xs ${ds.text.muted} hover:${ds.text.secondary} underline`}
                    href="https://www.google.com/search?q=currency+converter"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Check current rates →
                  </a>
                </div>

                {/* Exchange Rates Table */}
                <div
                  className={`${ds.bg.primary} rounded-lg border ${ds.border.default} overflow-hidden`}
                >
                  {exchangeRates.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className={`${ds.bg.tertiary}`}>
                        <tr>
                          <th className={`px-4 py-3 text-left ${ds.text.secondary} font-semibold`}>
                            From
                          </th>
                          <th className={`px-4 py-3 text-center ${ds.text.secondary}`}>→</th>
                          <th className={`px-4 py-3 text-left ${ds.text.secondary} font-semibold`}>
                            To
                          </th>
                          <th className={`px-4 py-3 text-right ${ds.text.secondary} font-semibold`}>
                            Exchange Rate
                          </th>
                          <th className={`px-4 py-3 text-right ${ds.text.secondary} font-semibold`}>
                            Last Updated
                          </th>
                          <th className="w-20" />
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${ds.border.default}`}>
                        {exchangeRates.map((rate) => (
                          <tr
                            key={rate.id}
                            className={`hover:${ds.bg.secondary} transition-colors`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">
                                  {getCurrencyFlag(rate.fromCurrency)}
                                </span>
                                <span className={`font-semibold ${ds.text.primary}`}>
                                  {rate.fromCurrency}
                                </span>
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-center ${ds.text.muted}`}>
                              <svg
                                className="w-4 h-4 mx-auto"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                />
                              </svg>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{getCurrencyFlag(rate.toCurrency)}</span>
                                <span className={`font-semibold ${ds.text.primary}`}>
                                  {rate.toCurrency}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div
                                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${ds.bg.tertiary}`}
                              >
                                <span
                                  className={`font-mono font-bold text-base ${ds.text.primary}`}
                                >
                                  {rate.rate.toFixed(4)}
                                </span>
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-right text-xs ${ds.text.muted}`}>
                              {new Date(rate.updatedAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${ds.status.error.text} hover:${ds.status.error.bg}`}
                                title="Delete this exchange rate"
                                onClick={() => deleteExchangeRate(rate.id)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className={`p-8 text-center ${ds.bg.secondary}`}>
                      <div className="text-4xl mb-3">💱</div>
                      <div className={`font-medium ${ds.text.primary} mb-1`}>
                        No exchange rates configured
                      </div>
                      <div className={`text-sm ${ds.text.muted}`}>
                        Add your first exchange rate below to enable multi-currency support
                      </div>
                    </div>
                  )}
                </div>

                {/* Add Exchange Rate Form */}
                <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
                  <div className={`text-sm font-semibold ${ds.text.primary} mb-3`}>
                    Add New Exchange Rate
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <Select
                      value={newExchangeRate.fromCurrency}
                      onChange={(e) =>
                        setNewExchangeRate({ ...newExchangeRate, fromCurrency: e.target.value })
                      }
                    >
                      <option value="CAD">🇨🇦 CAD</option>
                      <option value="EUR">🇪🇺 EUR</option>
                      <option value="GBP">🇬🇧 GBP</option>
                      <option value="JPY">🇯🇵 JPY</option>
                    </Select>
                    <Select
                      value={newExchangeRate.toCurrency}
                      onChange={(e) =>
                        setNewExchangeRate({ ...newExchangeRate, toCurrency: e.target.value })
                      }
                    >
                      <option value="USD">🇺🇸 USD</option>
                      <option value="CAD">🇨🇦 CAD</option>
                      <option value="EUR">🇪🇺 EUR</option>
                      <option value="GBP">🇬🇧 GBP</option>
                    </Select>
                    <Input
                      placeholder="0.7200"
                      step="0.0001"
                      type="number"
                      value={newExchangeRate.rate}
                      onChange={(e) =>
                        setNewExchangeRate({ ...newExchangeRate, rate: e.target.value })
                      }
                    />
                    <Button
                      className="py-2 bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={addExchangeRate}
                    >
                      Add Rate
                    </Button>
                  </div>
                  <div className={`text-xs ${ds.text.muted} mt-2`}>
                    💡 Example: If 1 CAD = 0.72 USD, enter <span className="font-mono">0.72</span>{' '}
                    for CAD → USD
                  </div>
                </div>
              </div>
            </div>

            {/* Inflation Rates */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className={`block text-sm font-medium ${ds.text.primary}`}>
                    Inflation Rates
                  </label>
                  <span className={`text-xs ${ds.text.muted}`}>
                    Used for inflation-adjusted net worth reports
                  </span>
                </div>

                {/* Inflation Rates Table */}
                <div
                  className={`${ds.bg.primary} rounded-lg border ${ds.border.default} overflow-hidden`}
                >
                  {inflationRates.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className={`${ds.bg.tertiary}`}>
                        <tr>
                          <th className={`px-4 py-3 text-left ${ds.text.secondary} font-semibold`}>
                            Year
                          </th>
                          <th className={`px-4 py-3 text-right ${ds.text.secondary} font-semibold`}>
                            Rate (%)
                          </th>
                          <th className={`px-4 py-3 text-right ${ds.text.secondary} font-semibold`}>
                            Last Updated
                          </th>
                          <th className="w-20" />
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${ds.border.default}`}>
                        {inflationRates.map((rate) => (
                          <tr
                            key={rate.id}
                            className={`hover:${ds.bg.secondary} transition-colors`}
                          >
                            <td className="px-4 py-3">
                              <span className={`font-semibold ${ds.text.primary}`}>
                                {rate.year}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div
                                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${ds.bg.tertiary}`}
                              >
                                <span
                                  className={`font-mono font-bold text-base ${ds.text.primary}`}
                                >
                                  {rate.rate.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-right text-xs ${ds.text.muted}`}>
                              {new Date(rate.updatedAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${ds.status.error.text} hover:${ds.status.error.bg}`}
                                title="Delete this inflation rate"
                                onClick={() => deleteInflationRate(rate.id)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className={`p-8 text-center ${ds.bg.secondary}`}>
                      <div className="text-4xl mb-3">📈</div>
                      <div className={`font-medium ${ds.text.primary} mb-1`}>
                        No inflation rates configured
                      </div>
                      <div className={`text-sm ${ds.text.muted}`}>
                        Add annual inflation rates to see inflation-adjusted net worth in reports
                      </div>
                    </div>
                  )}
                </div>

                {/* Add Inflation Rate Form */}
                <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
                  <div className={`text-sm font-semibold ${ds.text.primary} mb-3`}>
                    Add Inflation Rate
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Input
                      placeholder={new Date().getFullYear().toString()}
                      type="number"
                      value={newInflationRate.year}
                      onChange={(e) =>
                        setNewInflationRate({ ...newInflationRate, year: e.target.value })
                      }
                    />
                    <Input
                      placeholder="3.4"
                      step="0.1"
                      type="number"
                      value={newInflationRate.rate}
                      onChange={(e) =>
                        setNewInflationRate({ ...newInflationRate, rate: e.target.value })
                      }
                    />
                    <Button
                      className="py-2 bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={addInflationRate}
                    >
                      Add Rate
                    </Button>
                  </div>
                  <div className={`text-xs ${ds.text.muted} mt-2`}>
                    Enter the annual CPI inflation rate as a percentage. Example:{' '}
                    <span className="font-mono">3.4</span> for 3.4% inflation in a given year.
                  </div>
                </div>
              </div>
            </div>

            {/* Appearance Settings */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Appearance</h4>
              <div className="space-y-3">
                <label className={`block text-sm font-medium ${ds.text.primary} mb-2`}>Theme</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    className={`p-4 border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors ${ds.bg.primary}`}
                    onClick={() => {
                      const { setTheme } = require('@/lib/theme');
                      setTheme('light');
                    }}
                  >
                    <div className="text-2xl mb-2">☀️</div>
                    <div className={`text-sm font-medium ${ds.text.primary}`}>Light</div>
                  </button>
                  <button
                    className={`p-4 border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors ${ds.bg.primary}`}
                    onClick={() => {
                      const { setTheme } = require('@/lib/theme');
                      setTheme('dark');
                    }}
                  >
                    <div className="text-2xl mb-2">🌙</div>
                    <div className={`text-sm font-medium ${ds.text.primary}`}>Dark</div>
                  </button>
                  <button
                    className={`p-4 border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors ${ds.bg.primary}`}
                    onClick={() => {
                      const { setTheme } = require('@/lib/theme');
                      setTheme('system');
                    }}
                  >
                    <div className="text-2xl mb-2">💻</div>
                    <div className={`text-sm font-medium ${ds.text.primary}`}>System</div>
                  </button>
                </div>
                <div className={`text-xs ${ds.text.muted} mt-2`}>
                  Choose your preferred theme or use system settings
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'accounts' && (
        <>
          {/* Connected Institutions Section */}
          <div className="mb-6">
            <ConnectedInstitutions onRefresh={refreshAccounts} />
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <div className={`text-sm font-semibold ${ds.text.primary}`}>Accounts</div>
              <div className="flex items-center gap-4">
                {syncableAccounts.length > 0 && (
                  <Button
                    className="text-sm"
                    variant="outline"
                    onClick={() => setShowSyncAllModal(true)}
                  >
                    <svg
                      className="mr-1 inline h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                      />
                    </svg>
                    Sync All ({syncableAccounts.length})
                  </Button>
                )}
                <label className={`flex items-center gap-2 text-sm ${ds.text.secondary}`}>
                  <input
                    checked={showArchived}
                    className="rounded"
                    type="checkbox"
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Show archived
                </label>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <Input
                  placeholder="Name"
                  value={newAccount.name}
                  onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                />
                <Select
                  value={newAccount.type}
                  onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
                >
                  <option value="cash">Cash</option>
                  <option value="checking">Checking</option>
                  <option value="credit">Credit</option>
                  <option value="brokerage">Brokerage</option>
                  <option value="retirement">Retirement</option>
                  <option value="crypto">Crypto</option>
                  <option value="loan">Loan</option>
                  <option value="other">Other</option>
                </Select>
                <Select
                  value={newAccount.currency}
                  onChange={(e) => setNewAccount({ ...newAccount, currency: e.target.value })}
                >
                  <option value="USD">USD 🇺🇸</option>
                  <option value="CAD">CAD 🇨🇦</option>
                  <option value="EUR">EUR 🇪🇺</option>
                  <option value="GBP">GBP 🇬🇧</option>
                </Select>
                <Button className="py-3" onClick={createAccount}>
                  Add account
                </Button>
              </div>
              <DndContext
                collisionDetection={closestCenter}
                sensors={sensors}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={accounts
                    .filter((a) => showArchived || (a.isActive ?? true))
                    .map((a) => a.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {accounts
                      .filter((a) => showArchived || (a.isActive ?? true))
                      .map((a) => (
                        <SortableAccountCard
                          key={a.id}
                          account={a}
                          balance={accountBalances.get(a.id) ?? 0}
                          onOpenModal={openAccountModal}
                        />
                      ))}
                  </div>
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'categories' && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>
              Category Groups & Categories
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add New Group */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Add New Group</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  placeholder="Group name (e.g., Income, Expenses, Bills, Travel)"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                />
                <Button className="py-3" onClick={createGroup}>
                  Add Group
                </Button>
              </div>
              <div className={`text-xs ${ds.text.muted} mt-2`}>
                <strong>Examples:</strong> Income, Monthly Bills, Groceries & Dining, Travel,
                Entertainment, Utilities
              </div>
            </div>

            {/* Add New Category */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Add New Category</h4>
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  placeholder="Category name (e.g., Groceries, Rent)"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                />
                <Select
                  value={newCategory.parentId}
                  onChange={(e) => setNewCategory({ ...newCategory, parentId: e.target.value })}
                >
                  <option value="">Select group...</option>
                  {categories
                    .filter((c) => !c.parentId)
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} ({group.type})
                      </option>
                    ))}
                </Select>
                <Button className="py-3" onClick={createCategory}>
                  Add Category
                </Button>
              </div>
              <div className={`text-xs ${ds.status.info.text} mt-2`}>
                Categories automatically inherit the type from their parent group
              </div>
            </div>

            {/* Display Groups and Categories */}
            <div className="space-y-8">
              {categories
                .filter((c) => !c.parentId) // Only show top-level groups
                .sort(sortByName)
                .map((group) => {
                  const groupCategories = categories
                    .filter((c) => c.parentId === group.id)
                    .sort(sortByName);

                  // Helper function to get group styling
                  const getGroupStyle = (type: string) => {
                    switch (type) {
                      case 'expense':
                        return {
                          icon: '💸',
                          textColor: ds.status.error.text,
                          bgColor: ds.status.error.bg,
                          borderColor: ds.status.error.border,
                        };
                      case 'income':
                        return {
                          icon: '💰',
                          textColor: ds.status.success.text,
                          bgColor: ds.status.success.bg,
                          borderColor: ds.status.success.border,
                        };
                      case 'transfer':
                        return {
                          icon: '🔄',
                          textColor: ds.status.info.text,
                          bgColor: ds.status.info.bg,
                          borderColor: ds.status.info.border,
                        };
                      default:
                        return {
                          icon: '📁',
                          textColor: ds.text.primary,
                          bgColor: ds.bg.secondary,
                          borderColor: ds.border.default,
                        };
                    }
                  };

                  const groupStyle = getGroupStyle(group.type);

                  return (
                    <div key={group.id} className="space-y-3">
                      {/* Group Header - Clean and Simple */}
                      <div
                        className={`flex items-center gap-3 pb-3 border-b-2 ${ds.border.default} cursor-pointer ${ds.bg.hover} -mx-2 px-2 rounded-t-lg transition-colors`}
                        onClick={() => openCategoryModal(group)}
                      >
                        <span className="text-2xl">{groupStyle.icon}</span>
                        <div>
                          <h3 className={`text-xl font-bold ${ds.text.primary}`}>{group.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`text-xs px-2 py-1 rounded-full ${groupStyle.bgColor} ${groupStyle.textColor} font-medium`}
                            >
                              {group.type.charAt(0).toUpperCase() + group.type.slice(1)}
                            </span>
                            <span className={`text-sm ${ds.text.muted}`}>
                              {groupCategories.length}{' '}
                              {groupCategories.length === 1 ? 'category' : 'categories'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Categories - Small Cards */}
                      {groupCategories.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                          {groupCategories.map((category) => (
                            <div key={category.id} className="group">
                              {editingCategory?.id === category.id ? (
                                <div
                                  className={`${ds.bg.primary} rounded-lg border-2 border-blue-300 dark:border-blue-600 p-3 shadow-sm`}
                                >
                                  <Input
                                    className="text-sm mb-2"
                                    placeholder="Category name"
                                    value={editingCategory.name}
                                    onChange={(e) =>
                                      setEditingCategory({
                                        ...editingCategory,
                                        name: e.target.value,
                                      })
                                    }
                                  />
                                  <div className="flex gap-1">
                                    <Button
                                      className="flex-1 text-xs py-1"
                                      onClick={updateCategory}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      className="flex-1 text-xs py-1"
                                      onClick={() => setEditingCategory(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className={`${ds.bg.primary} rounded-lg border ${ds.border.default} p-3 shadow-sm hover:shadow-md ${ds.border.hover} transition-all cursor-pointer`}
                                  onClick={() => openCategoryModal(category)}
                                >
                                  <span
                                    className={`font-medium ${ds.text.primary} text-sm truncate`}
                                  >
                                    {category.name}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          className={`text-center py-6 ${ds.text.muted} ${ds.bg.secondary} rounded-lg border-2 border-dashed ${ds.border.default}`}
                        >
                          <div className="text-sm">No categories in this group yet</div>
                          <div className="text-xs mt-1">Add categories using the form above</div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {categories.filter((c) => !c.parentId).length === 0 && (
              <div className={`text-center py-8 ${ds.text.muted}`}>
                <div className="text-4xl mb-2">📁</div>
                <div className="text-lg font-medium">No category groups yet</div>
                <div className="text-sm">Create your first group above to get started!</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Account Management Modal */}
      <Modal
        isOpen={accountModalOpen}
        title={modalAccount ? `Manage ${modalAccount.name}` : 'Manage Account'}
        onClose={closeAccountModal}
      >
        {modalAccount && (
          <div className="space-y-6">
            {/* Edit Account */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Edit Details</h4>
              <div className="space-y-3">
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Name
                  </label>
                  <Input
                    className="w-full"
                    placeholder="Account name"
                    value={modalAccount.name}
                    onChange={(e) => setModalAccount({ ...modalAccount, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Type
                  </label>
                  <Select
                    className="w-full"
                    value={modalAccount.type}
                    onChange={(e) => setModalAccount({ ...modalAccount, type: e.target.value })}
                  >
                    <option value="cash">Cash</option>
                    <option value="checking">Checking</option>
                    <option value="credit">Credit</option>
                    <option value="brokerage">Brokerage</option>
                    <option value="retirement">Retirement</option>
                    <option value="crypto">Crypto</option>
                    <option value="loan">Loan</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Institution (optional)
                  </label>
                  <Input
                    className="w-full"
                    placeholder="e.g., Chase, Bank of America"
                    value={modalAccount.institution || ''}
                    onChange={(e) =>
                      setModalAccount({ ...modalAccount, institution: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Currency
                  </label>
                  <Select
                    className="w-full"
                    value={modalAccount.currency || 'USD'}
                    onChange={(e) => setModalAccount({ ...modalAccount, currency: e.target.value })}
                  >
                    <option value="USD">USD 🇺🇸</option>
                    <option value="CAD">CAD 🇨🇦</option>
                    <option value="EUR">EUR 🇪🇺</option>
                    <option value="GBP">GBP 🇬🇧</option>
                  </Select>
                  {accountTransactionCount > 0 && (
                    <div className={`text-xs ${ds.text.muted} mt-1`}>
                      ⚠️ Changing currency won't convert existing transactions
                    </div>
                  )}
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Tracking Mode
                  </label>
                  <Select
                    className="w-full"
                    value={modalAccount.trackingMode || 'cash_flow'}
                    onChange={(e) =>
                      setModalAccount({
                        ...modalAccount,
                        trackingMode: e.target.value as 'cash_flow' | 'balance_only',
                      })
                    }
                  >
                    <option value="cash_flow">Cash Flow (budgeting)</option>
                    <option value="balance_only">Balance Only (net worth)</option>
                  </Select>
                  <div className={`text-xs ${ds.text.muted} mt-1`}>
                    {modalAccount.trackingMode === 'balance_only'
                      ? '📊 Transactions excluded from budgeting, only balance counts for net worth'
                      : '💰 Transactions included in budgeting analysis and net worth'}
                  </div>
                </div>
                {/* Show invert amounts option for bank-synced accounts */}
                {(modalAccount.plaidConnection || modalAccount.tellerConnection) && (
                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        checked={modalAccount.invertAmounts || false}
                        className="rounded"
                        type="checkbox"
                        onChange={(e) =>
                          setModalAccount({
                            ...modalAccount,
                            invertAmounts: e.target.checked,
                          })
                        }
                      />
                      <span className={`text-sm font-medium ${ds.text.primary}`}>
                        Invert transaction amounts
                      </span>
                    </label>
                    <div className={`text-xs ${ds.text.muted} mt-1 pl-6`}>
                      Enable if this account shows amounts backwards (expenses as positive). This
                      affects future bank syncs only.
                    </div>
                  </div>
                )}
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 py-3"
                  onClick={updateModalAccount}
                >
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Account Info */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Account Info</h4>
              <div className={`text-sm ${ds.text.secondary} space-y-1`}>
                <div>
                  <strong>Transactions:</strong> {accountTransactionCount}
                </div>
                <div>
                  <strong>Status:</strong> {modalAccount.isActive === false ? 'Archived' : 'Active'}
                </div>
                <div>
                  <strong>Current Balance:</strong>{' '}
                  <span className={modalAccountBalance >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatCurrency(modalAccountBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Reconcile Balance */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.purple.text} mb-3`}>Reconcile Balance</h4>
              <div className={`text-sm ${ds.text.secondary} mb-3`}>
                Enter the actual balance from your bank statement to create an adjustment
                transaction.
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Current
                    </label>
                    <div
                      className={`text-lg font-bold ${modalAccountBalance >= 0 ? ds.text.primary : 'text-red-600'}`}
                    >
                      {formatCurrency(modalAccountBalance)}
                    </div>
                  </div>
                  <div className={ds.text.muted}>→</div>
                  <div className="flex-1">
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Actual Balance
                    </label>
                    <Input
                      className="w-full"
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={reconcileTarget}
                      onChange={(e) => setReconcileTarget(e.target.value)}
                    />
                  </div>
                </div>
                {reconcileTarget && !isNaN(parseFloat(reconcileTarget)) && (
                  <div className={`${ds.bg.primary} rounded p-2 text-sm`}>
                    <span className={ds.text.secondary}>Adjustment needed: </span>
                    <span
                      className={`font-semibold ${parseFloat(reconcileTarget) - modalAccountBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {parseFloat(reconcileTarget) - modalAccountBalance >= 0 ? '+' : ''}
                      {formatCurrency(parseFloat(reconcileTarget) - modalAccountBalance)}
                    </span>
                  </div>
                )}
                <Button
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 disabled:cursor-not-allowed py-3"
                  disabled={
                    !reconcileTarget ||
                    isNaN(parseFloat(reconcileTarget)) ||
                    Math.abs(parseFloat(reconcileTarget) - modalAccountBalance) < 0.01
                  }
                  onClick={reconcileBalance}
                >
                  Create Adjustment
                </Button>
              </div>
            </div>

            {/* Bank Connection */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.info.text} mb-3`}>Bank Connection</h4>

              {modalAccount.tellerConnection ? (
                // Teller Connection UI
                <div className="space-y-4">
                  {/* Connection Status */}
                  <div className="flex items-center justify-between">
                    <div className={`text-sm ${ds.text.secondary}`}>
                      <div>
                        Status:{' '}
                        <SyncStatusBadge
                          lastSyncAt={modalAccount.tellerConnection.lastSyncAt}
                          status={modalAccount.tellerConnection.status}
                        />
                      </div>
                      {modalAccount.tellerConnection.tellerEnrollment?.institutionName && (
                        <div className="mt-1">
                          Connected to:{' '}
                          <span className={ds.text.primary}>
                            {modalAccount.tellerConnection.tellerEnrollment.institutionName}
                          </span>
                          {modalAccount.tellerConnection.tellerAccountName &&
                            ` - ${modalAccount.tellerConnection.tellerAccountName}`}{' '}
                          (Teller)
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Last Sync Error */}
                  {modalAccount.tellerConnection.lastSyncError && (
                    <div
                      className={`p-2 rounded ${ds.status.error.bg} ${ds.status.error.text} text-sm`}
                    >
                      {modalAccount.tellerConnection.lastSyncError}
                    </div>
                  )}

                  {/* Sync Result */}
                  {syncResult && (
                    <div
                      className={`p-2 rounded ${ds.status.success.bg} ${ds.status.success.text} text-sm`}
                    >
                      <div>
                        Sync complete: {syncResult.added} added
                        {syncResult.merged ? `, ${syncResult.merged} merged` : ''}
                        {syncResult.modified ? `, ${syncResult.modified} modified` : ''}
                        {syncResult.removed ? `, ${syncResult.removed} removed` : ''}
                      </div>
                      {syncResult.skippedOld && syncResult.skippedOld > 0 && (
                        <div className={`text-xs ${ds.text.muted} mt-1`}>
                          ({syncResult.skippedOld} pending transactions skipped)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-3">
                    {modalAccount.tellerConnection.status === 'disconnected' ? (
                      <TellerAccountLinkSelector
                        accountId={modalAccount.id}
                        accountName={modalAccount.name}
                        onSuccess={async () => {
                          await refreshAccounts();
                          const updatedAccounts = await fetch('/api/accounts').then((r) =>
                            r.json()
                          );
                          const updatedAccount = updatedAccounts.accounts?.find(
                            (a: Account) => a.id === modalAccount.id
                          );
                          if (updatedAccount) {
                            setModalAccount(updatedAccount);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <label className={`text-sm ${ds.text.secondary}`}>Import last:</label>
                          <Select
                            className="flex-1"
                            value={daysToSync.toString()}
                            onChange={(e) => setDaysToSync(parseInt(e.target.value))}
                          >
                            <option value="30">30 days</option>
                            <option value="60">60 days</option>
                            <option value="90">90 days</option>
                            <option value="180">6 months</option>
                            <option value="365">1 year</option>
                            <option value="730">2 years</option>
                          </Select>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1 py-3"
                            disabled={previewLoading}
                            variant="outline"
                            onClick={handleTellerPreview}
                          >
                            {previewLoading ? 'Loading...' : 'Preview'}
                          </Button>
                          <Button
                            className="flex-1 bg-blue-600 hover:bg-blue-700 py-3"
                            disabled={syncingAccountId === modalAccount.id}
                            onClick={handleTellerSync}
                          >
                            {syncingAccountId === modalAccount.id ? 'Syncing...' : 'Sync Now'}
                          </Button>
                        </div>
                      </>
                    )}
                    <div className="flex gap-2">
                      <Button
                        className="w-full py-3"
                        variant="outline"
                        onClick={handleTellerDisconnect}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                </div>
              ) : modalAccount.plaidConnection ? (
                // Plaid Connection UI
                <div className="space-y-4">
                  {/* Connection Status */}
                  <div className="flex items-center justify-between">
                    <div className={`text-sm ${ds.text.secondary}`}>
                      <div>
                        Status:{' '}
                        <SyncStatusBadge
                          lastSyncAt={modalAccount.plaidConnection.lastSyncAt}
                          status={modalAccount.plaidConnection.status}
                        />
                      </div>
                      {modalAccount.plaidConnection.plaidEnrollment?.institutionName && (
                        <div className="mt-1">
                          Connected to:{' '}
                          <span className={ds.text.primary}>
                            {modalAccount.plaidConnection.plaidEnrollment.institutionName}
                          </span>{' '}
                          (Plaid)
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Last Sync Error */}
                  {modalAccount.plaidConnection.lastSyncError && (
                    <div
                      className={`p-2 rounded ${ds.status.error.bg} ${ds.status.error.text} text-sm`}
                    >
                      {modalAccount.plaidConnection.lastSyncError}
                    </div>
                  )}

                  {/* Sync Result */}
                  {syncResult && (
                    <div
                      className={`p-2 rounded ${ds.status.success.bg} ${ds.status.success.text} text-sm`}
                    >
                      <div>
                        Sync complete: {syncResult.added} added, {syncResult.modified} modified,{' '}
                        {syncResult.removed} removed
                      </div>
                      {syncResult.skippedOld && syncResult.skippedOld > 0 && (
                        <div className={`text-xs ${ds.text.muted} mt-1`}>
                          ({syncResult.skippedOld} older transactions skipped)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-3">
                    {modalAccount.plaidConnection.status === 'needs_reauth' ? (
                      <PlaidReconnectButton
                        className="w-full bg-yellow-600 hover:bg-yellow-700 py-3"
                        enrollmentId={modalAccount.plaidConnection.plaidEnrollmentId}
                        onSuccess={async () => {
                          await refreshAccounts();
                          const updatedAccounts = await fetch('/api/accounts').then((r) =>
                            r.json()
                          );
                          const updatedAccount = updatedAccounts.accounts?.find(
                            (a: Account) => a.id === modalAccount.id
                          );
                          if (updatedAccount) {
                            setModalAccount(updatedAccount);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <label className={`text-sm ${ds.text.secondary}`}>Import last:</label>
                          <Select
                            className="flex-1"
                            value={daysToSync.toString()}
                            onChange={(e) => setDaysToSync(parseInt(e.target.value))}
                          >
                            <option value="30">30 days</option>
                            <option value="60">60 days</option>
                            <option value="90">90 days</option>
                            <option value="180">6 months</option>
                            <option value="365">1 year</option>
                            <option value="730">2 years</option>
                          </Select>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1 py-3"
                            disabled={previewLoading}
                            variant="outline"
                            onClick={handlePlaidPreview}
                          >
                            {previewLoading ? 'Loading...' : 'Preview'}
                          </Button>
                          <Button
                            className="flex-1 bg-blue-600 hover:bg-blue-700 py-3"
                            disabled={syncingAccountId === modalAccount.id}
                            onClick={handlePlaidSync}
                          >
                            {syncingAccountId === modalAccount.id ? 'Syncing...' : 'Sync Now'}
                          </Button>
                        </div>
                      </>
                    )}
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 py-3"
                        variant="outline"
                        onClick={handlePlaidDisconnect}
                      >
                        Disconnect
                      </Button>
                      <Button
                        className="flex-1 py-3"
                        variant="outline"
                        onClick={handlePlaidResetCursor}
                      >
                        Reset Cursor
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                // No connection - show both Teller and Plaid link selectors
                <div className="space-y-4">
                  <div>
                    <h5 className={`text-sm font-medium ${ds.text.secondary} mb-2`}>Teller</h5>
                    <TellerAccountLinkSelector
                      accountId={modalAccount.id}
                      accountName={modalAccount.name}
                      onSuccess={async () => {
                        await refreshAccounts();
                        const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
                        const updatedAccount = updatedAccounts.accounts?.find(
                          (a: Account) => a.id === modalAccount.id
                        );
                        if (updatedAccount) {
                          setModalAccount(updatedAccount);
                        }
                      }}
                    />
                  </div>
                  <div className={`text-center text-sm ${ds.text.muted}`}>or</div>
                  <div>
                    <h5 className={`text-sm font-medium ${ds.text.secondary} mb-2`}>Plaid</h5>
                    <PlaidAccountLinkSelector
                      accountId={modalAccount.id}
                      accountName={modalAccount.name}
                      onSuccess={async () => {
                        await refreshAccounts();
                        const updatedAccounts = await fetch('/api/accounts').then((r) => r.json());
                        const updatedAccount = updatedAccounts.accounts?.find(
                          (a: Account) => a.id === modalAccount.id
                        );
                        if (updatedAccount) {
                          setModalAccount(updatedAccount);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Archive/Restore */}
            {modalAccount.isActive !== false ? (
              <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
                <h4 className={`font-semibold ${ds.status.warning.text} mb-3`}>Archive Account</h4>
                <Button
                  className="w-full bg-yellow-600 text-white hover:bg-yellow-700 py-3"
                  onClick={archiveAccount}
                >
                  Archive Account
                </Button>
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  Archiving hides the account but preserves transaction history
                </div>
              </div>
            ) : (
              <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
                <h4 className={`font-semibold ${ds.status.success.text} mb-3`}>Restore Account</h4>
                <Button
                  className="w-full bg-green-600 text-white hover:bg-green-700 py-3"
                  onClick={restoreAccount}
                >
                  Restore Account
                </Button>
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  This will make the account active again
                </div>
              </div>
            )}

            {/* Delete Account */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.error.text} mb-3`}>Delete Account</h4>
              <Button
                className={`w-full py-3 ${
                  accountTransactionCount > 0
                    ? '!bg-slate-300 dark:!bg-slate-700 !text-slate-500 dark:!text-slate-400 cursor-not-allowed'
                    : '!bg-red-600 !text-white hover:!bg-red-700'
                }`}
                disabled={accountTransactionCount > 0}
                onClick={deleteAccount}
              >
                {accountTransactionCount > 0
                  ? `Cannot Delete (${accountTransactionCount} transactions)`
                  : 'Delete Account'}
              </Button>
              {accountTransactionCount > 0 ? (
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  <strong>Blocked:</strong> Archive the account instead to preserve transaction
                  history
                </div>
              ) : (
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  <strong>Warning:</strong> This action cannot be undone
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Category Management Modal */}
      <Modal
        isOpen={modalOpen}
        title={modalCategory ? `Manage ${modalCategory.name}` : 'Manage Category'}
        onClose={closeModal}
      >
        {modalCategory && (
          <div className="space-y-6">
            {/* Edit Category */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Edit Details</h4>
              <div className="space-y-3">
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Name
                  </label>
                  <Input
                    className="w-full"
                    placeholder="Category name"
                    value={modalCategory.name}
                    onChange={(e) => setModalCategory({ ...modalCategory, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Type
                  </label>
                  <div
                    className={`px-3 py-2 ${ds.bg.secondary} rounded text-sm ${ds.text.secondary}`}
                  >
                    {modalCategory.type.charAt(0).toUpperCase() + modalCategory.type.slice(1)}
                    {modalCategory.parentId
                      ? ' (inherited from group)'
                      : ' Group (auto-determined)'}
                  </div>
                  <div className={`text-xs ${ds.text.muted} mt-1`}>
                    {modalCategory.parentId
                      ? 'Category types are inherited from their parent group'
                      : 'Group types are automatically determined based on the group name'}
                  </div>
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 py-3"
                  onClick={updateModalCategory}
                >
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Transaction Management */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>
                Transactions ({categoryTransactions.length})
              </h4>

              {isLoadingTransactions ? (
                <div className={`text-center py-6 ${ds.text.muted}`}>
                  <div className="animate-pulse">Loading transactions...</div>
                </div>
              ) : categoryTransactions.length > 0 ? (
                <div className="space-y-4">
                  <div
                    className={`${ds.bg.primary} rounded-lg border ${ds.border.default} max-h-48 overflow-y-auto`}
                  >
                    {categoryTransactions.slice(0, 8).map((tx: any) => (
                      <div
                        key={tx.id}
                        className="flex justify-between items-center p-3 border-b border-slate-200/50 dark:border-slate-700/50 last:border-b-0"
                      >
                        <div className="flex-1 min-w-0">
                          <div className={`font-medium ${ds.text.primary} truncate`}>
                            {tx.merchant}
                          </div>
                          <div className={`text-xs ${ds.text.muted}`}>{tx.date.split('T')[0]}</div>
                        </div>
                        <div className={`font-semibold ${ds.text.primary} ml-3`}>
                          ${Math.abs(tx.amount).toFixed(2)}
                        </div>
                      </div>
                    ))}
                    {categoryTransactions.length > 8 && (
                      <div
                        className={`text-center py-2 text-sm ${ds.text.muted} ${ds.bg.secondary}`}
                      >
                        ... and {categoryTransactions.length - 8} more transactions
                      </div>
                    )}
                  </div>

                  <Button
                    className="w-full bg-yellow-600 text-white hover:bg-yellow-700 py-3"
                    onClick={unclassifyTransactions}
                  >
                    Unclassify All Transactions
                  </Button>
                  <div
                    className={`text-sm ${ds.text.secondary} ${ds.status.warning.bg} p-3 rounded`}
                  >
                    <strong>Note:</strong> This will remove the category from all{' '}
                    {categoryTransactions.length} transactions, making them appear in the review
                    queue again for re-categorization.
                  </div>
                </div>
              ) : (
                <div
                  className={`text-center py-6 ${ds.text.muted} ${ds.bg.primary} rounded-lg border ${ds.border.default}`}
                >
                  <div className="text-2xl mb-2">📭</div>
                  <div>No transactions in this category</div>
                </div>
              )}
            </div>

            {/* Delete Category */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.error.text} mb-3`}>Danger Zone</h4>
              <Button
                className={`w-full bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed disabled:${ds.text.muted} py-3`}
                disabled={categoryTransactions.length > 0}
                onClick={deleteCategory}
              >
                {categoryTransactions.length > 0
                  ? `Cannot Delete (${categoryTransactions.length} transactions)`
                  : 'Delete Category'}
              </Button>
              {categoryTransactions.length > 0 ? (
                <div
                  className={`text-sm ${ds.text.secondary} mt-2 ${ds.status.error.bg} p-2 rounded`}
                >
                  <strong>Blocked:</strong> Unclassify all transactions first to enable deletion
                </div>
              ) : (
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  <strong>Warning:</strong> This action cannot be undone
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Sync Preview Modal */}
      <Modal
        isOpen={showPreviewModal}
        title="Sync Preview"
        onClose={() => {
          setShowPreviewModal(false);
          setPreviewResult(null);
        }}
      >
        {previewResult && (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {previewResult.stats.added}
                  </div>
                  <div className={`text-xs ${ds.text.muted}`}>New</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {previewResult.stats.merged}
                  </div>
                  <div className={`text-xs ${ds.text.muted}`}>Merge</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-600">
                    {previewResult.stats.skippedDuplicates}
                  </div>
                  <div className={`text-xs ${ds.text.muted}`}>Duplicates</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-500">
                    {previewResult.stats.skippedPending}
                  </div>
                  <div className={`text-xs ${ds.text.muted}`}>Pending</div>
                </div>
              </div>
              <div className={`text-xs ${ds.text.muted} text-center mt-2`}>
                Date range: {previewResult.dateRange.from} to {previewResult.dateRange.to}
              </div>
            </div>

            {/* Transaction List */}
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className={`${ds.bg.tertiary} sticky top-0`}>
                  <tr>
                    <th className={`text-left p-2 ${ds.text.secondary}`}>Date</th>
                    <th className={`text-left p-2 ${ds.text.secondary}`}>Merchant</th>
                    <th className={`text-right p-2 ${ds.text.secondary}`}>Amount</th>
                    <th className={`text-left p-2 ${ds.text.secondary}`}>Category</th>
                    <th className={`text-left p-2 ${ds.text.secondary}`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewResult.transactions.map((tx) => (
                    <tr
                      key={tx.externalId}
                      className={`border-b ${ds.border.default} ${
                        !tx.wouldCreate && !tx.wouldMerge ? 'opacity-50' : ''
                      }`}
                    >
                      <td className={`p-2 ${ds.text.primary}`}>
                        {new Date(tx.date + 'T00:00:00').toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className={`p-2 ${ds.text.primary}`}>
                        <div className="truncate max-w-[150px]" title={tx.merchant}>
                          {tx.merchant}
                        </div>
                      </td>
                      <td
                        className={`p-2 text-right ${
                          tx.amount < 0 ? 'text-red-600' : 'text-green-600'
                        }`}
                      >
                        {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                      </td>
                      <td className={`p-2 ${ds.text.secondary}`}>
                        {tx.category ? (
                          <span className="text-xs">
                            {tx.category}
                            <span className={`ml-1 ${ds.text.muted}`}>
                              ({Math.round(tx.categoryConfidence * 100)}%)
                            </span>
                          </span>
                        ) : (
                          <span className={`text-xs ${ds.text.muted}`}>Uncategorized</span>
                        )}
                      </td>
                      <td className="p-2">
                        {tx.wouldCreate ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            New
                          </span>
                        ) : tx.wouldMerge ? (
                          <span
                            className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            title={tx.skipReason || 'Will merge with existing transaction'}
                          >
                            Merge
                          </span>
                        ) : (
                          <span
                            className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                            title={tx.skipReason || 'Skipped'}
                          >
                            Skip
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewResult.transactions.length === 0 && (
                <div className={`text-center py-8 ${ds.text.muted}`}>
                  No transactions found in this date range.
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewResult(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                disabled={
                  (previewResult.stats.added === 0 && previewResult.stats.merged === 0) ||
                  syncingAccountId !== null
                }
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewResult(null);
                  // Call the correct sync handler based on connection type
                  if (modalAccount?.tellerConnection) {
                    handleTellerSync();
                  } else if (modalAccount?.plaidConnection) {
                    handlePlaidSync();
                  }
                }}
              >
                {syncingAccountId
                  ? 'Syncing...'
                  : `Sync ${previewResult.stats.added + previewResult.stats.merged} Transactions`}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Sync All Modal */}
      <Modal
        isOpen={showSyncAllModal}
        size="xl"
        title="Sync All Accounts"
        onClose={handleSyncAllClose}
      >
        <div className="space-y-4">
          {/* Phase: Select lookback window */}
          {syncAllPhase === 'select' && (
            <>
              <p className={`text-sm ${ds.text.secondary}`}>
                Sync {syncableAccounts.length} connected account
                {syncableAccounts.length !== 1 ? 's' : ''} simultaneously.
              </p>

              <div className="flex items-center gap-2">
                <label className={`text-sm ${ds.text.secondary}`}>Import last:</label>
                <Select
                  className="flex-1"
                  value={syncAllDays.toString()}
                  onChange={(e) => setSyncAllDays(parseInt(e.target.value))}
                >
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                  <option value="180">6 months</option>
                  <option value="365">1 year</option>
                  <option value="730">2 years</option>
                </Select>
              </div>

              <div
                className={`rounded-lg border ${ds.border.default} ${ds.bg.secondary} p-3 text-sm`}
              >
                <div className={`mb-2 font-medium ${ds.text.primary}`}>Accounts to sync:</div>
                <div className="space-y-1">
                  {syncableAccounts.map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between ${ds.text.secondary}`}
                    >
                      <span>{a.name}</span>
                      <Badge>{a.tellerConnection ? 'Teller' : 'Plaid'}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 border-t pt-4">
                <Button className="flex-1" variant="outline" onClick={handleSyncAllClose}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  onClick={handleSyncAllPreview}
                >
                  Preview All
                </Button>
              </div>
            </>
          )}

          {/* Phase: Previewing / Preview / Syncing / Done */}
          {syncAllPhase !== 'select' && (
            <>
              {/* Aggregated stats (only when preview is done or later) */}
              {syncAllPhase !== 'previewing' &&
                (() => {
                  const allResults = Array.from(syncAllResults.values());
                  const totalNew = allResults.reduce(
                    (sum, r) => sum + (r.preview?.stats.added ?? 0),
                    0
                  );
                  const totalMerge = allResults.reduce(
                    (sum, r) => sum + (r.preview?.stats.merged ?? 0),
                    0
                  );
                  const totalDupes = allResults.reduce(
                    (sum, r) => sum + (r.preview?.stats.skippedDuplicates ?? 0),
                    0
                  );
                  const totalPending = allResults.reduce(
                    (sum, r) => sum + (r.preview?.stats.skippedPending ?? 0),
                    0
                  );

                  return (
                    <div className={`${ds.bg.secondary} rounded-lg border p-4`}>
                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold text-green-600">{totalNew}</div>
                          <div className={`text-xs ${ds.text.muted}`}>New</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-blue-600">{totalMerge}</div>
                          <div className={`text-xs ${ds.text.muted}`}>Merge</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-yellow-600">{totalDupes}</div>
                          <div className={`text-xs ${ds.text.muted}`}>Duplicates</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-gray-500">{totalPending}</div>
                          <div className={`text-xs ${ds.text.muted}`}>Pending</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {/* Per-account breakdown table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={`${ds.bg.tertiary}`}>
                    <tr>
                      <th className={`p-2 text-left ${ds.text.secondary}`}>Account</th>
                      <th className={`p-2 text-left ${ds.text.secondary}`}>Provider</th>
                      <th className={`p-2 text-right ${ds.text.secondary}`}>New</th>
                      <th className={`p-2 text-right ${ds.text.secondary}`}>Merge</th>
                      <th className={`p-2 text-right ${ds.text.secondary}`}>Skip</th>
                      <th className={`p-2 text-left ${ds.text.secondary}`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(syncAllResults.values()).map((r) => (
                      <tr key={r.accountId} className={`border-t ${ds.border.default}`}>
                        <td className={`p-2 ${ds.text.primary}`}>{r.accountName}</td>
                        <td className="p-2">
                          <Badge>{r.connectionType === 'teller' ? 'Teller' : 'Plaid'}</Badge>
                        </td>
                        <td className="p-2 text-right text-green-600">
                          {r.preview?.stats.added ?? '—'}
                        </td>
                        <td className="p-2 text-right text-blue-600">
                          {r.preview?.stats.merged ?? '—'}
                        </td>
                        <td className="p-2 text-right text-yellow-600">
                          {r.preview
                            ? (r.preview.stats.skippedDuplicates ?? 0) +
                              (r.preview.stats.skippedPending ?? 0)
                            : '—'}
                        </td>
                        <td className="p-2">
                          {r.status === 'previewing' && (
                            <span className={`text-xs ${ds.text.muted}`}>Previewing...</span>
                          )}
                          {r.status === 'preview_done' && (
                            <span className="text-xs rounded bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-300">
                              Ready
                            </span>
                          )}
                          {r.status === 'syncing' && (
                            <span className="text-xs rounded bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                              Syncing...
                            </span>
                          )}
                          {r.status === 'synced' && (
                            <span className="text-xs rounded bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-300">
                              {r.syncResult
                                ? `${r.syncResult.added} added${r.syncResult.merged ? `, ${r.syncResult.merged} merged` : ''}`
                                : 'Done'}
                            </span>
                          )}
                          {r.status === 'error' && (
                            <span
                              className="text-xs rounded bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-900 dark:text-red-300"
                              title={r.error}
                            >
                              Error: {r.error}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Done summary */}
              {syncAllPhase === 'done' &&
                (() => {
                  const allResults = Array.from(syncAllResults.values());
                  const synced = allResults.filter((r) => r.status === 'synced');
                  const errors = allResults.filter((r) => r.status === 'error');
                  const totalAdded = synced.reduce((sum, r) => sum + (r.syncResult?.added ?? 0), 0);
                  const totalMerged = synced.reduce(
                    (sum, r) => sum + (r.syncResult?.merged ?? 0),
                    0
                  );

                  return (
                    <div className="space-y-2">
                      {synced.length > 0 && (
                        <div
                          className={`rounded p-2 text-sm ${ds.status.success.bg} ${ds.status.success.text}`}
                        >
                          {synced.length} account{synced.length !== 1 ? 's' : ''} synced:{' '}
                          {totalAdded} added{totalMerged > 0 ? `, ${totalMerged} merged` : ''}
                        </div>
                      )}
                      {errors.length > 0 && (
                        <div
                          className={`rounded p-2 text-sm ${ds.status.error.bg} ${ds.status.error.text}`}
                        >
                          {errors.length} account{errors.length !== 1 ? 's' : ''} failed
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* Action buttons */}
              <div className="flex gap-2 border-t pt-4">
                {syncAllPhase === 'previewing' && (
                  <div className={`flex-1 text-center text-sm ${ds.text.muted}`}>
                    Previewing accounts...
                  </div>
                )}

                {syncAllPhase === 'preview' && (
                  <>
                    <Button className="flex-1" variant="outline" onClick={handleSyncAllClose}>
                      Cancel
                    </Button>
                    <Button
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      disabled={
                        !Array.from(syncAllResults.values()).some(
                          (r) =>
                            r.status === 'preview_done' &&
                            r.preview &&
                            (r.preview.stats.added > 0 || r.preview.stats.merged > 0)
                        )
                      }
                      onClick={handleSyncAllConfirm}
                    >
                      Sync{' '}
                      {Array.from(syncAllResults.values()).reduce(
                        (sum, r) =>
                          sum + (r.preview?.stats.added ?? 0) + (r.preview?.stats.merged ?? 0),
                        0
                      )}{' '}
                      Transactions
                    </Button>
                  </>
                )}

                {syncAllPhase === 'syncing' && (
                  <div className={`flex-1 text-center text-sm ${ds.text.muted}`}>
                    Syncing accounts...
                  </div>
                )}

                {syncAllPhase === 'done' && (
                  <Button className="flex-1" onClick={handleSyncAllClose}>
                    Close
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {tab === 'rules' && (
        <RulesTab
          accounts={accounts}
          categories={categories}
          rules={rules}
          onRefresh={refreshRules}
          onSync={triggerSync}
        />
      )}

      {tab === 'budgets' && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Monthly Budgets</div>
            <div className="flex items-center gap-2">
              <select
                className={`rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary}`}
                value={budgetViewMonth}
                onChange={(e) => setBudgetViewMonth(e.target.value)}
              >
                <option value="">All months (defaults)</option>
                {/* Generate last 12 months + next 2 months */}
                {Array.from({ length: 14 }, (_, i) => {
                  const d = new Date();
                  d.setMonth(d.getMonth() - 11 + i);
                  const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  return (
                    <option key={`month-${i}`} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Context indicator */}
            <div
              className={`p-3 rounded-lg text-sm ${budgetViewMonth ? `${ds.status.warning.bg} border ${ds.status.warning.border} ${ds.status.warning.text}` : `${ds.status.success.bg} border ${ds.status.success.border} ${ds.status.success.text}`}`}
            >
              {budgetViewMonth ? (
                <>
                  <strong>
                    Viewing{' '}
                    {new Date(budgetViewMonth + '-01').toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })}
                    :
                  </strong>{' '}
                  Changes here only affect this month. Budgets with a badge are overrides for this
                  month.
                </>
              ) : (
                <>
                  <strong>Viewing defaults:</strong> These budgets apply to every month unless
                  overridden.
                </>
              )}
            </div>

            {/* Add/Edit Budget */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>
                {budgetViewMonth
                  ? `Set Override for ${new Date(budgetViewMonth + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                  : 'Set Default Budget'}
              </h4>
              <div className="grid gap-3 md:grid-cols-3">
                <Select
                  value={budgetForm.categoryId}
                  onChange={(e) => setBudgetForm({ ...budgetForm, categoryId: e.target.value })}
                >
                  <option value="">Select category...</option>
                  {categories
                    .filter((c) => !c.parentId)
                    .sort(sortByName)
                    .map((group) => {
                      const groupCategories = categories
                        .filter((c) => c.parentId === group.id)
                        .sort(sortByName);
                      if (groupCategories.length === 0) return null;

                      return (
                        <optgroup key={group.id} label={group.name}>
                          {groupCategories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                </Select>
                <Input
                  placeholder="Budget amount"
                  type="number"
                  value={budgetForm.limitAmount}
                  onChange={(e) => setBudgetForm({ ...budgetForm, limitAmount: e.target.value })}
                />
                <Button
                  className={`py-3 ${budgetViewMonth ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
                  onClick={saveBudget}
                >
                  {budgetViewMonth
                    ? budgets.find((b) => b.categoryId === budgetForm.categoryId && b.isOverride)
                      ? 'Update Override'
                      : 'Set Override'
                    : budgets.find((b) => b.categoryId === budgetForm.categoryId)
                      ? 'Update Default'
                      : 'Set Default'}
                </Button>
              </div>
            </div>

            {/* Current Budgets */}
            {budgets.length > 0 ? (
              <div className="space-y-6">
                {/* Total Budget Summary */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-5 border border-green-200">
                  <div className="text-sm text-green-700 font-medium">
                    {budgetViewMonth
                      ? `Total Budget for ${new Date(budgetViewMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
                      : 'Total Monthly Budget'}
                  </div>
                  <div className="text-3xl font-bold text-green-800 mt-1">
                    {formatCurrency(budgets.reduce((sum, b) => sum + b.limitAmount, 0))}
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    {budgets.length} {budgets.length === 1 ? 'category' : 'categories'} budgeted
                  </div>
                </div>
                {/* Group budgets by their parent category group */}
                {categories
                  .filter((c) => !c.parentId) // Get all groups
                  .sort(sortByName)
                  .map((group) => {
                    // Find budgets that belong to categories in this group
                    const groupBudgets = budgets
                      .filter((b) => {
                        const category = categories.find((c) => c.id === b.categoryId);
                        return category?.parentId === group.id;
                      })
                      .sort((a, b) => {
                        const catA = categories.find((c) => c.id === a.categoryId);
                        const catB = categories.find((c) => c.id === b.categoryId);
                        return sortByName({ name: catA?.name ?? '' }, { name: catB?.name ?? '' });
                      });

                    if (groupBudgets.length === 0) return null;

                    const groupTotal = groupBudgets.reduce((sum, b) => sum + b.limitAmount, 0);

                    return (
                      <div key={group.id} className="space-y-3">
                        <div
                          className={`flex items-center justify-between border-b ${ds.border.default} pb-2`}
                        >
                          <div className={`text-sm font-semibold ${ds.text.primary}`}>
                            {group.name}
                          </div>
                          <div
                            className={`text-sm font-bold ${ds.text.secondary} ${ds.bg.tertiary} px-3 py-1 rounded-full`}
                          >
                            {formatCurrency(groupTotal)}
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                          {groupBudgets.map((b) => {
                            const category = categories.find((c) => c.id === b.categoryId);
                            const defaultBudget = defaultBudgets.find(
                              (db) => db.categoryId === b.categoryId
                            );
                            const isOverride = b.isOverride;

                            return (
                              <div
                                key={b.id}
                                className={`${ds.bg.primary} rounded-lg border p-4 hover:shadow-md transition-shadow ${isOverride ? 'border-amber-300 dark:border-amber-600' : ds.border.default}`}
                              >
                                <div className="flex items-start justify-between">
                                  <div
                                    className="flex-1 cursor-pointer"
                                    onClick={() =>
                                      setBudgetForm({
                                        categoryId: b.categoryId,
                                        limitAmount: String(b.limitAmount),
                                      })
                                    }
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className={`font-semibold ${ds.text.primary}`}>
                                        {category?.name ?? 'Unknown'}
                                      </span>
                                      {isOverride && (
                                        <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded font-medium">
                                          Override
                                        </span>
                                      )}
                                    </div>
                                    {isOverride && defaultBudget && (
                                      <div className={`text-xs ${ds.text.muted} mt-1`}>
                                        Default: {formatCurrency(defaultBudget.limitAmount)}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={`text-lg font-bold ${isOverride ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}
                                    >
                                      {formatCurrency(b.limitAmount)}
                                    </div>
                                    {isOverride ? (
                                      <button
                                        className={`${ds.text.muted} hover:text-amber-600 dark:hover:text-amber-400 transition-colors p-1`}
                                        title="Remove override (revert to default)"
                                        onClick={() => removeOverride(b.categoryId)}
                                      >
                                        <svg
                                          className="w-4 h-4"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                          />
                                        </svg>
                                      </button>
                                    ) : (
                                      <button
                                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                        title="Remove budget"
                                        onClick={() => deleteBudget(b.categoryId)}
                                      >
                                        <svg
                                          className="w-4 h-4"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            d="M6 18L18 6M6 6l12 12"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                          />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div
                className={`text-center py-8 ${ds.text.muted} ${ds.bg.secondary} rounded-lg border-2 border-dashed ${ds.border.default}`}
              >
                <div className="text-3xl mb-2">📊</div>
                <div className="font-medium">
                  No budgets set{budgetViewMonth ? ' for this month' : ' yet'}
                </div>
                <div className="text-sm mt-1">Use the form above to set your first budget</div>
              </div>
            )}

            {/* Info */}
            <div
              className={`${ds.status.info.bg} p-4 rounded-lg border ${ds.status.info.border} text-sm ${ds.status.info.text}`}
            >
              <strong>How it works:</strong> Default budgets apply to every month. Select a specific
              month from the dropdown to create overrides (e.g., bump up "Gifts" in December).
              Overrides only affect that one month.
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'import' && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>
              CSV import (per account)
            </div>
          </CardHeader>
          <CardContent className={`space-y-4 text-sm ${ds.text.primary}`}>
            <div className="grid gap-3 md:grid-cols-3">
              <Select
                value={importState.accountId}
                onChange={(e) => setImportState((s) => ({ ...s, accountId: e.target.value }))}
              >
                <option value="">Select account</option>
                {accounts
                  .filter((a) => a.isActive !== false) // Only show active accounts
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} {a.institution ? `(${a.institution})` : ''}{' '}
                      {a.currency && a.currency !== 'USD' ? `- ${a.currency}` : ''}
                    </option>
                  ))}
              </Select>
              <label className="relative cursor-pointer">
                <input
                  accept=".csv,text/csv"
                  className="hidden"
                  id="csv-file-input"
                  type="file"
                  onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
                />
                <div
                  className={`flex items-center justify-center gap-2 px-4 py-3 ${ds.bg.primary} border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 ${ds.bg.hover} transition-colors`}
                >
                  <svg
                    className={`w-5 h-5 ${ds.text.secondary}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  <span className={`text-sm font-medium ${ds.text.primary}`}>
                    {importState.csvText ? '✓ File selected' : 'Choose CSV file'}
                  </span>
                </div>
              </label>
              <Button
                className="py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!importState.accountId || !importState.csvText}
                onClick={importCsv}
              >
                Upload & import
              </Button>
            </div>

            {importState.columns.length > 0 && (
              <div className={`rounded-lg border ${ds.border.default} ${ds.bg.secondary} p-3`}>
                <div
                  className={`mb-3 text-xs font-semibold uppercase tracking-wide ${ds.text.muted}`}
                >
                  Map your CSV columns to transaction fields
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Transaction Date →
                    </label>
                    <Select
                      value={importState.mapping.date}
                      onChange={(e) =>
                        setImportState((s) => ({
                          ...s,
                          mapping: { ...s.mapping, date: e.target.value },
                        }))
                      }
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`date-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Amount →
                    </label>
                    <Select
                      value={importState.mapping.amount}
                      onChange={(e) =>
                        setImportState((s) => ({
                          ...s,
                          mapping: { ...s.mapping, amount: e.target.value },
                        }))
                      }
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`amount-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Merchant/Description →
                    </label>
                    <Select
                      value={importState.mapping.merchant}
                      onChange={(e) =>
                        setImportState((s) => ({
                          ...s,
                          mapping: { ...s.mapping, merchant: e.target.value },
                        }))
                      }
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`merchant-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Note/Memo (optional) →
                    </label>
                    <Select
                      value={importState.mapping.note}
                      onChange={(e) =>
                        setImportState((s) => ({
                          ...s,
                          mapping: { ...s.mapping, note: e.target.value },
                        }))
                      }
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`note-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* Advanced Options */}
                <details className="mt-4">
                  <summary
                    className={`cursor-pointer text-xs font-medium ${ds.text.secondary} hover:${ds.text.primary}`}
                  >
                    ⚙️ Advanced Options
                  </summary>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-2">
                      <input
                        checked={importState.invertAmounts}
                        className="rounded"
                        type="checkbox"
                        onChange={(e) =>
                          setImportState((s) => ({ ...s, invertAmounts: e.target.checked }))
                        }
                      />
                      <span className={`text-xs ${ds.text.secondary}`}>
                        Invert amounts (flip positive/negative)
                      </span>
                    </label>
                    <div className={`text-xs ${ds.text.muted} pl-6`}>
                      Use this if your bank reports amounts backwards (e.g., expenses as positive,
                      income as negative)
                    </div>
                  </div>
                </details>

                <div className={`mt-3 text-xs ${ds.text.muted}`}>
                  ✓ Auto-deduplicates by date+amount+merchant • Auto-categorizes • Detects transfers
                </div>
              </div>
            )}

            {importState.status && (
              <div className="space-y-3">
                <div className={`text-sm ${ds.text.primary} font-medium`}>{importState.status}</div>

                {importState.summary && (
                  <div className="space-y-2">
                    {/* Auto-Categorized Section */}
                    {importState.summary.autoCategorizedList &&
                      importState.summary.autoCategorizedList.length > 0 && (
                        <details
                          className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}
                        >
                          <summary
                            className={`cursor-pointer p-3 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}
                          >
                            🏷️ Auto-Categorized ({importState.summary.autoCategorized})
                          </summary>
                          <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                            {importState.summary.autoCategorizedList.map((t: any, i: number) => (
                              <div
                                key={i}
                                className="flex items-center justify-between py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0"
                              >
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`font-medium ${ds.text.primary} truncate text-sm`}
                                  >
                                    {t.merchant}
                                  </div>
                                  <div className={`text-xs ${ds.text.muted}`}>{t.date}</div>
                                </div>
                                <div
                                  className={`text-sm font-semibold ml-3 ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}
                                >
                                  ${Math.abs(t.amount).toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                    {/* Duplicates Section */}
                    {importState.summary.duplicates &&
                      importState.summary.duplicates.length > 0 && (
                        <details
                          className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}
                        >
                          <summary
                            className={`cursor-pointer p-3 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}
                          >
                            ⏭️ Skipped Duplicates ({importState.summary.duplicates.length})
                          </summary>
                          <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                            {importState.summary.duplicates.map((t: any, i: number) => (
                              <div
                                key={i}
                                className="flex items-center justify-between py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0"
                              >
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`font-medium ${ds.text.primary} truncate text-sm`}
                                  >
                                    {t.merchant}
                                  </div>
                                  <div className={`text-xs ${ds.text.muted}`}>
                                    {t.date} • {t.reason}
                                  </div>
                                </div>
                                <div
                                  className={`text-sm font-semibold ml-3 ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}
                                >
                                  ${Math.abs(t.amount).toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                    {/* Transfers Detected Section */}
                    {importState.summary.transfersDetected > 0 && (
                      <details
                        className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}
                      >
                        <summary
                          className={`cursor-pointer p-3 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}
                        >
                          🔄 Transfers Detected ({importState.summary.transfersDetected} pairs)
                        </summary>
                        <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
                          {importState.summary.crossAccountTransfers &&
                            importState.summary.crossAccountTransfers.map((t: any, i: number) => (
                              <div
                                key={i}
                                className="py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0"
                              >
                                <div className={`text-xs ${ds.text.muted} mb-1`}>{t.date}</div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <div className={`text-sm ${ds.text.primary}`}>{t.account1}</div>
                                    <div className={`text-xs ${ds.text.secondary} truncate`}>
                                      {t.merchant1}
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold text-red-600">
                                    ${Math.abs(t.amount1).toFixed(2)}
                                  </div>
                                  <div className={`text-xs ${ds.text.muted}`}>↔</div>
                                  <div className="flex-1">
                                    <div className={`text-sm ${ds.text.primary}`}>{t.account2}</div>
                                    <div className={`text-xs ${ds.text.secondary} truncate`}>
                                      {t.merchant2}
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold text-green-600">
                                    ${Math.abs(t.amount2).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          {importState.summary.sameAccountTransfers &&
                            importState.summary.sameAccountTransfers.map((t: any, i: number) => (
                              <div
                                key={`same-${i}`}
                                className="py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0"
                              >
                                <div className={`text-xs ${ds.text.muted} mb-1`}>
                                  {t.date} • Same account
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <div className={`text-xs ${ds.text.secondary} truncate`}>
                                      {t.merchant1}
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold text-red-600">
                                    ${Math.abs(t.amount1).toFixed(2)}
                                  </div>
                                  <div className={`text-xs ${ds.text.muted}`}>↔</div>
                                  <div className="flex-1">
                                    <div className={`text-xs ${ds.text.secondary} truncate`}>
                                      {t.merchant2}
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold text-green-600">
                                    ${Math.abs(t.amount2).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          <div
                            className={`text-xs ${ds.text.muted} mt-2 pt-2 border-t ${ds.border.default}`}
                          >
                            Transfers are automatically excluded from spending totals
                          </div>
                        </div>
                      </details>
                    )}

                    {/* Uncategorized Section */}
                    {importState.summary.uncategorizedList &&
                      importState.summary.uncategorizedList.length > 0 && (
                        <details
                          className={`${ds.status.warning.bg} rounded-lg border ${ds.status.warning.border}`}
                        >
                          <summary
                            className={`cursor-pointer p-3 font-medium text-sm ${ds.status.warning.text} hover:bg-yellow-100 dark:hover:bg-yellow-500/20`}
                          >
                            ❓ Need Categorization ({importState.summary.uncategorized})
                          </summary>
                          <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                            {importState.summary.uncategorizedList.map((t: any, i: number) => (
                              <div
                                key={i}
                                className="flex items-center justify-between py-2 border-b border-yellow-200/50 dark:border-yellow-500/20 last:border-0"
                              >
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`font-medium ${ds.text.primary} truncate text-sm`}
                                  >
                                    {t.merchant}
                                  </div>
                                  <div className={`text-xs ${ds.text.muted}`}>{t.date}</div>
                                </div>
                                <div
                                  className={`text-sm font-semibold ml-3 ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}
                                >
                                  ${Math.abs(t.amount).toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className={`px-3 pb-2 text-xs ${ds.status.warning.text}`}>
                            → Go to Transactions → Review Queue to categorize these
                          </div>
                        </details>
                      )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'tags' && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Tags</div>
            <Badge>{settingsTags.length} tags</Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Inline Create Tag */}
            <div className="flex items-center gap-2">
              {/* Color picker with preview dot + label */}
              <div className="relative flex items-center gap-1.5">
                <span
                  className={`w-4 h-4 rounded-full shrink-0 ${getTagColors(newTagColor).text}`}
                  style={{ backgroundColor: 'currentColor' }}
                />
                <Select
                  className="w-28 text-sm"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                >
                  {[
                    'blue',
                    'green',
                    'red',
                    'yellow',
                    'purple',
                    'pink',
                    'indigo',
                    'orange',
                    'teal',
                    'gray',
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                className="flex-1 max-w-sm"
                placeholder="New tag name... (Enter to create)"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!newTagName.trim()) return;
                    fetch('/api/tags', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
                    }).then((res) => {
                      if (!res.ok) {
                        res.json().then((d) => alert(d.error || 'Failed to create tag'));
                        return;
                      }
                      setNewTagName('');
                      setNewTagColor('blue');
                      refreshTags();
                      triggerSync();
                    });
                  }
                }}
              />
              <Button
                className="bg-blue-600 text-white hover:bg-blue-700 py-2 px-3 text-sm"
                disabled={!newTagName.trim()}
                onClick={async () => {
                  if (!newTagName.trim()) return;
                  const res = await fetch('/api/tags', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
                  });
                  if (!res.ok) {
                    const d = await res.json();
                    alert(d.error || 'Failed to create tag');
                    return;
                  }
                  setNewTagName('');
                  setNewTagColor('blue');
                  refreshTags();
                  triggerSync();
                }}
              >
                + Create
              </Button>
            </div>

            {/* Tag Cards Grid */}
            {settingsTags.length === 0 ? (
              <div className={`py-8 text-center text-sm ${ds.text.muted}`}>
                No tags yet. Type a name above and press Enter.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {settingsTags.map((tag) => {
                  const colors = getTagColors(tag.color);
                  return (
                    <div
                      key={tag.id}
                      className={`group relative px-3 py-2.5 rounded-lg border ${colors.border} ${colors.bg} cursor-pointer hover:shadow-md transition-all`}
                      onClick={() => {
                        setEditingTag(tag);
                        setEditTagModalOpen(true);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.text}`}
                          style={{ backgroundColor: 'currentColor' }}
                        />
                        <span
                          className={`font-medium text-sm ${colors.text} truncate`}
                          title={tag.name}
                        >
                          {tag.name}
                        </span>
                      </div>
                      {tag.transactionCount !== undefined && tag.transactionCount > 0 && (
                        <div className={`text-xs ${colors.text} opacity-70 mt-0.5 ml-[18px]`}>
                          {tag.transactionCount} txn{tag.transactionCount !== 1 ? 's' : ''}
                        </div>
                      )}
                      {/* Hover delete button */}
                      <button
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-500/20 text-red-500 dark:text-red-400 transition-all"
                        title="Delete tag"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (
                            !confirm(
                              `Delete "${tag.name}"?${
                                tag.transactionCount
                                  ? ` Removes from ${tag.transactionCount} transaction(s).`
                                  : ''
                              }`
                            )
                          )
                            return;
                          await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' });
                          refreshTags();
                          triggerSync();
                        }}
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M6 18L18 6M6 6l12 12"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit Tag Modal */}
      <Modal
        isOpen={editTagModalOpen}
        title={editingTag ? `Edit Tag: ${editingTag.name}` : 'Edit Tag'}
        onClose={() => {
          setEditTagModalOpen(false);
          setEditingTag(null);
        }}
      >
        {editingTag && (
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Name</label>
              <Input
                className="w-full"
                value={editingTag.name}
                onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
              />
            </div>
            <div>
              <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Color</label>
              <div className="grid grid-cols-5 gap-2">
                {[
                  'blue',
                  'green',
                  'red',
                  'yellow',
                  'purple',
                  'pink',
                  'indigo',
                  'orange',
                  'teal',
                  'gray',
                ].map((c) => {
                  const colors = getTagColors(c);
                  return (
                    <button
                      key={c}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        editingTag.color === c
                          ? `${colors.bg} ${colors.text} ${colors.border} ring-2 ring-offset-1 ring-blue-500`
                          : `${colors.bg} ${colors.text} ${colors.border} opacity-60 hover:opacity-100`
                      }`}
                      onClick={() => setEditingTag({ ...editingTag, color: c })}
                    >
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700 py-3"
              onClick={async () => {
                if (!editingTag.name.trim()) return;
                const res = await fetch(`/api/tags/${editingTag.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: editingTag.name.trim(), color: editingTag.color }),
                });
                if (!res.ok) {
                  const d = await res.json();
                  alert(d.error || 'Failed to update tag');
                  return;
                }
                setEditTagModalOpen(false);
                setEditingTag(null);
                refreshTags();
                triggerSync();
              }}
            >
              Save Changes
            </Button>
          </div>
        )}
      </Modal>

      {tab === 'sync' && <SyncSettings />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading settings...</div>}>
      <SettingsPageContent />
    </Suspense>
  );
}
