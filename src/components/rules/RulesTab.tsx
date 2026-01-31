'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { ConditionBuilder } from './ConditionBuilder';
import type { Condition } from '@/lib/rule-matcher';

type Category = { id: string; name: string; type: string; parentId?: string | null };
type Account = { id: string; name: string };
type Rule = {
  id: string;
  conditions: string; // JSON string
  priority: number;
  isEnabled: boolean;
  categoryId: string | null;
  renameTo: string | null;
  description: string | null;
};

type RulesTabProps = {
  rules: Rule[];
  categories: Category[];
  accounts: Account[];
  onRefresh: () => void;
  onSync: () => void;
};

const sortByName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function parseConditions(json: string): Condition[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function describeConditions(conditions: Condition[], accounts: Account[]): string {
  return conditions
    .map((c) => {
      const neg = c.negate ? 'NOT ' : '';
      const fieldLabel = c.field === 'merchantNormalized' ? 'normalized merchant' : c.field;
      if (c.field === 'account') {
        const acct = accounts.find((a) => a.id === c.value);
        return `${neg}account is ${acct?.name || c.value}`;
      }
      if (c.field === 'amount') {
        if (c.operator === 'between') {
          try {
            const r = JSON.parse(c.value);
            return `${neg}amount between $${r.min ?? '?'} and $${r.max ?? '?'}`;
          } catch {
            return `${neg}amount between ?`;
          }
        }
        const amountLabels: Record<string, string> = {
          gt: '>',
          lt: '<',
          equals: '=',
          between: 'between',
        };
        const opLabel = amountLabels[c.operator] || c.operator;
        return `${neg}amount ${opLabel} $${c.value}`;
      }
      const textLabels: Record<string, string> = {
        contains: 'contains',
        exact: 'is exactly',
        regex: 'matches',
      };
      const opLabel = textLabels[c.operator] || c.operator;
      return `${neg}${fieldLabel} ${opLabel} "${c.value}"`;
    })
    .join(' AND ');
}

function getConditionIcon(conditions: Condition[]): string {
  if (conditions.length === 0) return '⚙️';
  const first = conditions[0];
  if (first.field === 'amount') return '💲';
  if (first.field === 'account') return '🏦';
  if (first.operator === 'regex') return '🔍';
  if (first.field === 'note') return '📝';
  return '🏪';
}

// Sortable rule card for drag-and-drop
function SortableRuleCard({
  rule,
  categories,
  accounts,
  selected,
  onToggleSelect,
  onClick,
}: {
  rule: Rule;
  categories: Category[];
  accounts: Account[];
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const conditions = parseConditions(rule.conditions);
  const category = categories.find((c) => c.id === rule.categoryId);
  const group = category ? categories.find((g) => g.id === category.parentId) : null;
  const icon = getConditionIcon(conditions);
  const desc = describeConditions(conditions, accounts);

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`rounded-xl border ${selected ? 'border-purple-500 ring-1 ring-purple-500' : ds.border.default} ${ds.bg.primary} p-4 shadow-sm hover:shadow-md ${ds.border.hover} transition-all cursor-pointer ${!rule.isEnabled ? 'opacity-60' : ''}`}
        onClick={onClick}
      >
        <div className="space-y-3">
          {/* Header with checkbox and drag handle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                checked={selected}
                className="rounded"
                type="checkbox"
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleSelect();
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-xl">{icon}</span>
              {conditions.length > 1 && (
                <Badge className={`text-xs px-1.5 py-0.5 ${ds.text.secondary} ${ds.bg.tertiary}`}>
                  {conditions.length} conditions
                </Badge>
              )}
            </div>
            <div
              {...listeners}
              className={`cursor-grab active:cursor-grabbing p-1 rounded ${ds.text.muted} hover:${ds.text.primary}`}
              title="Drag to reorder"
              onClick={(e) => e.stopPropagation()}
            >
              ⠿
            </div>
          </div>

          {/* Rule Content */}
          <div className="space-y-2">
            <div className={`text-sm font-medium ${ds.text.primary} line-clamp-2`}>{desc}</div>
            {rule.description && (
              <div className={`text-xs ${ds.text.muted} italic truncate`}>{rule.description}</div>
            )}
            <div className={`text-xs ${ds.text.secondary} space-y-1`}>
              {category && (
                <div className="truncate">
                  → {group?.name} → {category.name}
                </div>
              )}
              {rule.renameTo && (
                <div className="truncate">✏️ Rename to &quot;{rule.renameTo}&quot;</div>
              )}
              {!category && !rule.renameTo && (
                <div className="truncate text-red-500">⚠️ No action configured</div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <Badge className={`text-xs px-2 py-1 ${ds.text.secondary} ${ds.bg.tertiary}`}>
              #{rule.priority}
            </Badge>
            {!rule.isEnabled && (
              <Badge className={`text-xs px-2 py-1 ${ds.status.error.text} ${ds.status.error.bg}`}>
                Disabled
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type TestResult = {
  matches: {
    rule: {
      id: string;
      conditions: Condition[];
      categoryName: string | null;
      renameTo: string | null;
      description: string | null;
      priority: number;
    };
    isWinnerCategory: boolean;
    isWinnerRename: boolean;
  }[];
  result: { categoryId: string | null; categoryName: string | null; renameTo: string | null };
};

type PreviewResult = {
  matchCount: number;
  sampleTransactions: { id: string; merchant: string; amount: number; date: string }[];
};

type AISuggestion = {
  conditions: Condition[];
  categoryId: string;
  categoryName: string;
  renameTo: string | null;
  description: string;
  confidence: number;
  matchingTransactionCount: number;
  sampleTransactions: { merchant: string; amount: number }[];
};

export function RulesTab({ rules, categories, accounts, onRefresh, onSync }: RulesTabProps) {
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterEnabled, setFilterEnabled] = useState('');

  // New rule form
  const [newConditions, setNewConditions] = useState<Condition[]>([
    { field: 'merchant', operator: 'contains', value: '' },
  ]);
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newRenameTo, setNewRenameTo] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState(100);

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [editConditions, setEditConditions] = useState<Condition[]>([]);

  // Rule tester
  const [testerOpen, setTesterOpen] = useState(false);
  const [testMerchant, setTestMerchant] = useState('');
  const [testNote, setTestNote] = useState('');
  const [testAmount, setTestAmount] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Preview
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // AI Suggestions
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsMessage, setSuggestionsMessage] = useState('');

  // Drag-and-drop
  const [localRules, setLocalRules] = useState(rules);
  useEffect(() => setLocalRules(rules), [rules]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Filter rules
  const isSearchActive = searchQuery || filterCategory || filterEnabled;
  const filteredRules = localRules.filter((rule) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const conds = parseConditions(rule.conditions);
      const matchesSearch =
        conds.some((c) => c.value.toLowerCase().includes(q)) ||
        (rule.renameTo && rule.renameTo.toLowerCase().includes(q)) ||
        (rule.description && rule.description.toLowerCase().includes(q));
      if (!matchesSearch) return false;
    }
    if (filterCategory && rule.categoryId !== filterCategory) return false;
    if (filterEnabled === 'enabled' && !rule.isEnabled) return false;
    if (filterEnabled === 'disabled' && rule.isEnabled) return false;
    return true;
  });

  const activeCount = localRules.filter((r) => r.isEnabled).length;
  const disabledCount = localRules.length - activeCount;

  // CRUD Operations
  const createRule = async () => {
    const hasValue = newConditions.some((c) => c.value.trim());
    if (!hasValue) {
      alert('Please enter at least one condition value');
      return;
    }
    if (!newCategoryId && !newRenameTo.trim()) {
      alert('Please select a category or enter a rename value (or both)');
      return;
    }
    try {
      const response = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conditions: newConditions,
          categoryId: newCategoryId || null,
          renameTo: newRenameTo.trim() || null,
          description: newDescription.trim() || null,
          priority: newPriority,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to create rule: ${error.message || 'Unknown error'}`);
        return;
      }
      setNewConditions([{ field: 'merchant', operator: 'contains', value: '' }]);
      setNewCategoryId('');
      setNewRenameTo('');
      setNewDescription('');
      setNewPriority(100);
      setPreview(null);
      onRefresh();
      onSync();
    } catch {
      alert('Failed to create rule');
    }
  };

  const updateRule = async () => {
    if (!editRule) return;
    if (!editRule.categoryId && !editRule.renameTo) {
      alert('Rule must have either a category or rename value (or both)');
      return;
    }
    try {
      await fetch(`/api/rules/${editRule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conditions: editConditions,
          categoryId: editRule.categoryId || null,
          renameTo: editRule.renameTo || null,
          description: editRule.description || null,
          priority: editRule.priority,
          isEnabled: editRule.isEnabled,
        }),
      });
      setEditModalOpen(false);
      setEditRule(null);
      onRefresh();
      onSync();
    } catch {
      alert('Failed to update rule');
    }
  };

  const deleteRule = async () => {
    if (!editRule) return;
    try {
      await fetch(`/api/rules/${editRule.id}`, { method: 'DELETE' });
      setEditModalOpen(false);
      setEditRule(null);
      onRefresh();
      onSync();
    } catch {
      alert('Failed to delete rule');
    }
  };

  // Bulk operations
  const bulkAction = async (action: 'delete' | 'enable' | 'disable') => {
    if (selectedIds.size === 0) return;
    if (action === 'delete' && !confirm(`Delete ${selectedIds.size} rule(s)?`)) return;
    try {
      await fetch('/api/rules/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ruleIds: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      onRefresh();
      onSync();
    } catch {
      alert('Bulk operation failed');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRules.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRules.map((r) => r.id)));
    }
  };

  // Drag-and-drop reorder
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localRules.findIndex((r) => r.id === active.id);
    const newIndex = localRules.findIndex((r) => r.id === over.id);
    const reordered = arrayMove(localRules, oldIndex, newIndex);
    setLocalRules(reordered);

    try {
      await fetch('/api/rules/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleIds: reordered.map((r) => r.id) }),
      });
      onRefresh();
      onSync();
    } catch {
      setLocalRules(rules); // revert
    }
  };

  // Rule tester
  const runTest = async () => {
    if (!testMerchant.trim()) return;
    setTestLoading(true);
    try {
      const res = await fetch('/api/rules/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: testMerchant,
          note: testNote || null,
          amount: testAmount ? Number(testAmount) : undefined,
        }),
      });
      setTestResult(await res.json());
    } catch {
      alert('Test failed');
    } finally {
      setTestLoading(false);
    }
  };

  // Live preview (debounced)
  const fetchPreview = useCallback(async (conditions: Condition[]) => {
    const hasValue = conditions.some((c) => c.value.trim());
    if (!hasValue) {
      setPreview(null);
      return;
    }
    try {
      const res = await fetch('/api/rules/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions }),
      });
      setPreview(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => fetchPreview(newConditions), 500);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [newConditions, fetchPreview]);

  // AI suggestions
  const fetchSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestionsMessage('');
    try {
      const res = await fetch('/api/rules/suggest', { method: 'POST' });
      const data = await res.json();
      setSuggestions(data.suggestions || []);
      setSuggestionsMessage(data.message || '');
      setSuggestionsOpen(true);
    } catch {
      alert('Failed to get suggestions');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const acceptSuggestion = async (suggestion: AISuggestion) => {
    try {
      await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conditions: suggestion.conditions,
          categoryId: suggestion.categoryId,
          renameTo: suggestion.renameTo,
          description: suggestion.description,
        }),
      });
      setSuggestions((prev) => prev.filter((s) => s !== suggestion));
      onRefresh();
      onSync();
    } catch {
      alert('Failed to create rule');
    }
  };

  const acceptAllSuggestions = async () => {
    for (const s of suggestions) {
      await acceptSuggestion(s);
    }
  };

  const openEditModal = (rule: Rule) => {
    setEditRule(rule);
    setEditConditions(parseConditions(rule.conditions));
    setEditModalOpen(true);
  };

  // Category select helper (used in both create and edit)
  const CategorySelect = ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— None —</option>
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
  );

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className={`text-sm font-semibold ${ds.text.primary}`}>Automation Rules</div>
        <div className="flex items-center gap-2">
          <Button
            className={`text-xs px-3 py-1.5 ${ds.bg.tertiary} ${ds.text.secondary}`}
            onClick={() => setTesterOpen(!testerOpen)}
          >
            {testerOpen ? 'Hide Tester' : 'Test Rules'}
          </Button>
          <Button
            className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white"
            disabled={suggestionsLoading}
            onClick={fetchSuggestions}
          >
            {suggestionsLoading ? 'Analyzing...' : 'AI Suggest Rules'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Rule Tester Panel */}
        {testerOpen && (
          <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
            <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Test Your Rules</h4>
            <div className="grid gap-3 md:grid-cols-4 mb-3">
              <Input
                placeholder="Merchant name"
                value={testMerchant}
                onChange={(e) => setTestMerchant(e.target.value)}
              />
              <Input
                placeholder="Note (optional)"
                value={testNote}
                onChange={(e) => setTestNote(e.target.value)}
              />
              <Input
                placeholder="Amount (optional)"
                type="number"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
              />
              <Button disabled={testLoading || !testMerchant.trim()} onClick={runTest}>
                {testLoading ? 'Testing...' : 'Test'}
              </Button>
            </div>
            {testResult && (
              <div className="space-y-2">
                {testResult.matches.length === 0 ? (
                  <div className={`text-sm ${ds.text.muted} py-2`}>No rules matched.</div>
                ) : (
                  <>
                    <div className={`text-sm font-medium ${ds.text.primary}`}>
                      {testResult.matches.length} rule(s) matched
                      {testResult.result.categoryName && ` → ${testResult.result.categoryName}`}
                      {testResult.result.renameTo && ` (rename: "${testResult.result.renameTo}")`}
                    </div>
                    {testResult.matches.map((m, i) => (
                      <div
                        key={i}
                        className={`text-xs p-2 rounded ${
                          m.isWinnerCategory || m.isWinnerRename
                            ? `${ds.status.success.bg} ${ds.status.success.text}`
                            : `${ds.bg.tertiary} ${ds.text.muted}`
                        }`}
                      >
                        #{m.rule.priority} {m.isWinnerCategory && '★ '}
                        {describeConditions(m.rule.conditions, accounts)}
                        {m.rule.categoryName && ` → ${m.rule.categoryName}`}
                        {m.rule.renameTo && ` (rename: "${m.rule.renameTo}")`}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Add New Rule */}
        <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
          <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Add New Rule</h4>
          <div className={`text-xs ${ds.text.secondary} mb-3 ${ds.status.info.bg} p-2 rounded`}>
            <strong>Conditions:</strong> All conditions must match (AND logic). Lower priority
            numbers run first.
          </div>

          {/* Conditions */}
          <div className="mb-3">
            <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>When</label>
            <ConditionBuilder
              accounts={accounts}
              conditions={newConditions}
              onChange={setNewConditions}
            />
          </div>

          {/* Live Preview */}
          {preview && (
            <div
              className={`text-xs mb-3 p-2 rounded ${
                preview.matchCount > 500
                  ? `${ds.status.warning.bg} ${ds.status.warning.text}`
                  : `${ds.status.info.bg} ${ds.text.secondary}`
              }`}
            >
              This rule would match <strong>{preview.matchCount}</strong> existing transactions
              {preview.matchCount > 500 && ' (very broad rule!)'}
              {preview.sampleTransactions.length > 0 && (
                <span className={ds.text.muted}>
                  {' '}
                  — e.g. {preview.sampleTransactions.map((t) => t.merchant).join(', ')}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="grid gap-3 md:grid-cols-2 mb-3">
            <div>
              <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                Assign category <span className={ds.text.muted}>(optional)</span>
              </label>
              <CategorySelect value={newCategoryId} onChange={setNewCategoryId} />
            </div>
            <div>
              <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                Rename merchant to <span className={ds.text.muted}>(optional)</span>
              </label>
              <Input
                placeholder="e.g., 'Internal Transfer'"
                value={newRenameTo}
                onChange={(e) => setNewRenameTo(e.target.value)}
              />
            </div>
          </div>

          {/* Description + Priority + Submit */}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                Description <span className={ds.text.muted}>(optional)</span>
              </label>
              <Input
                placeholder="Why does this rule exist?"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div>
              <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                Priority
              </label>
              <Input
                type="number"
                value={newPriority}
                onChange={(e) => setNewPriority(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end">
              <Button className="w-full py-3" onClick={createRule}>
                Add Rule
              </Button>
            </div>
          </div>
        </div>

        {/* Toolbar: Search, Filter, Stats */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="flex-1 min-w-[200px]"
              placeholder="Search rules..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Select
              className="w-40"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories
                .filter((c) => c.parentId)
                .sort(sortByName)
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
            </Select>
            <Select
              className="w-32"
              value={filterEnabled}
              onChange={(e) => setFilterEnabled(e.target.value)}
            >
              <option value="">All status</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </Select>
          </div>

          {/* Stats bar */}
          <div className={`flex items-center justify-between text-xs ${ds.text.muted}`}>
            <div className="flex items-center gap-3">
              <span>
                Total: {localRules.length} | Active: {activeCount} | Disabled: {disabledCount}
              </span>
              {isSearchActive && (
                <span className={ds.text.secondary}>
                  Showing {filteredRules.length} of {localRules.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <input
                checked={selectedIds.size > 0 && selectedIds.size === filteredRules.length}
                className="rounded"
                type="checkbox"
                onChange={toggleSelectAll}
              />
              <span>Select all</span>
            </div>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div
            className={`flex items-center justify-between ${ds.status.info.bg} p-3 rounded-lg border ${ds.border.default}`}
          >
            <span className={`text-sm font-medium ${ds.text.primary}`}>
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                className={`text-xs px-3 py-1.5 ${ds.bg.primary}`}
                onClick={() => bulkAction('enable')}
              >
                Enable
              </Button>
              <Button
                className={`text-xs px-3 py-1.5 ${ds.bg.primary}`}
                onClick={() => bulkAction('disable')}
              >
                Disable
              </Button>
              <Button
                className="text-xs px-3 py-1.5 bg-red-600 text-white hover:bg-red-700"
                onClick={() => bulkAction('delete')}
              >
                Delete
              </Button>
            </div>
          </div>
        )}

        {/* Rules Grid with Drag-and-Drop */}
        {isSearchActive ? (
          // When filtering, disable drag-and-drop
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filteredRules.map((rule) => (
              <SortableRuleCard
                key={rule.id}
                accounts={accounts}
                categories={categories}
                rule={rule}
                selected={selectedIds.has(rule.id)}
                onClick={() => openEditModal(rule)}
                onToggleSelect={() => {
                  const next = new Set(selectedIds);
                  if (next.has(rule.id)) {
                    next.delete(rule.id);
                  } else {
                    next.add(rule.id);
                  }
                  setSelectedIds(next);
                }}
              />
            ))}
          </div>
        ) : (
          <DndContext
            collisionDetection={closestCenter}
            sensors={sensors}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={localRules.map((r) => r.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {localRules.map((rule) => (
                  <SortableRuleCard
                    key={rule.id}
                    accounts={accounts}
                    categories={categories}
                    rule={rule}
                    selected={selectedIds.has(rule.id)}
                    onClick={() => openEditModal(rule)}
                    onToggleSelect={() => {
                      const next = new Set(selectedIds);
                      if (next.has(rule.id)) {
                        next.delete(rule.id);
                      } else {
                        next.add(rule.id);
                      }
                      setSelectedIds(next);
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {localRules.length === 0 && (
          <div className={`text-center py-8 ${ds.text.muted}`}>
            <div className="text-4xl mb-2">🤖</div>
            <div className="text-lg font-medium">No automation rules yet</div>
            <div className="text-sm">Create rules above or use AI Suggest to get started</div>
          </div>
        )}
      </CardContent>

      {/* Edit Rule Modal */}
      <Modal
        isOpen={editModalOpen}
        title="Edit Rule"
        onClose={() => {
          setEditModalOpen(false);
          setEditRule(null);
        }}
      >
        {editRule && (
          <div className="space-y-6">
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Conditions</h4>
              <ConditionBuilder
                accounts={accounts}
                conditions={editConditions}
                onChange={setEditConditions}
              />
            </div>

            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Actions</h4>
              <div className="space-y-3">
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Category
                  </label>
                  <CategorySelect
                    value={editRule.categoryId || ''}
                    onChange={(v) => setEditRule({ ...editRule, categoryId: v || null })}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Rename Merchant To
                  </label>
                  <Input
                    placeholder="e.g., 'Internal Transfer'"
                    value={editRule.renameTo || ''}
                    onChange={(e) => setEditRule({ ...editRule, renameTo: e.target.value || null })}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Description
                  </label>
                  <Input
                    placeholder="Why does this rule exist?"
                    value={editRule.description || ''}
                    onChange={(e) =>
                      setEditRule({ ...editRule, description: e.target.value || null })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                      Priority
                    </label>
                    <Input
                      type="number"
                      value={editRule.priority}
                      onChange={(e) =>
                        setEditRule({ ...editRule, priority: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                      Status
                    </label>
                    <Select
                      value={editRule.isEnabled ? 'enabled' : 'disabled'}
                      onChange={(e) =>
                        setEditRule({ ...editRule, isEnabled: e.target.value === 'enabled' })
                      }
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </Select>
                  </div>
                </div>
                <Button
                  className="w-full bg-purple-600 hover:bg-purple-700 py-3"
                  onClick={updateRule}
                >
                  Save Changes
                </Button>
              </div>
            </div>

            {/* How This Rule Works */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>How This Rule Works</h4>
              <div className={`text-sm ${ds.text.secondary} space-y-2`}>
                <div>
                  <strong>When:</strong> {describeConditions(editConditions, accounts)}
                </div>
                <div>
                  <strong>Then:</strong>{' '}
                  {editRule.categoryId && editRule.renameTo ? (
                    <>
                      Categorize as &quot;
                      {categories.find((c) => c.id === editRule.categoryId)?.name || 'Unknown'}
                      &quot; and rename to &quot;{editRule.renameTo}&quot;
                    </>
                  ) : editRule.categoryId ? (
                    <>
                      Categorize as &quot;
                      {categories.find((c) => c.id === editRule.categoryId)?.name || 'Unknown'}
                      &quot;
                    </>
                  ) : editRule.renameTo ? (
                    <>Rename to &quot;{editRule.renameTo}&quot;</>
                  ) : (
                    <>No action configured</>
                  )}
                </div>
              </div>
            </div>

            {/* Delete */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.error.text} mb-3`}>Delete Rule</h4>
              <Button
                className="w-full bg-red-600 text-white hover:bg-red-700 py-3"
                onClick={deleteRule}
              >
                Delete Rule
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* AI Suggestions Modal */}
      <Modal
        isOpen={suggestionsOpen}
        title="AI Rule Suggestions"
        onClose={() => setSuggestionsOpen(false)}
      >
        <div className="space-y-4">
          {suggestionsMessage && (
            <div className={`text-sm ${ds.text.secondary} p-3 ${ds.bg.secondary} rounded`}>
              {suggestionsMessage}
            </div>
          )}
          {suggestions.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${ds.text.primary}`}>
                  {suggestions.length} suggestion(s)
                </span>
                <Button
                  className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={acceptAllSuggestions}
                >
                  Accept All
                </Button>
              </div>
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default} space-y-2`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`text-sm font-medium ${ds.text.primary}`}>
                      {describeConditions(s.conditions, accounts)} → {s.categoryName}
                    </div>
                    <Badge
                      className={`text-xs ${
                        s.confidence > 0.8 ? ds.status.success.text : ds.status.warning.text
                      }`}
                    >
                      {Math.round(s.confidence * 100)}% confident
                    </Badge>
                  </div>
                  {s.renameTo && (
                    <div className={`text-xs ${ds.text.secondary}`}>
                      Rename to &quot;{s.renameTo}&quot;
                    </div>
                  )}
                  <div className={`text-xs ${ds.text.muted}`}>
                    {s.description} — {s.matchingTransactionCount} matching transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="text-xs px-3 py-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => acceptSuggestion(s)}
                    >
                      Accept
                    </Button>
                    <Button
                      className={`text-xs px-3 py-1 ${ds.bg.tertiary}`}
                      onClick={() => {
                        setSuggestionsOpen(false);
                        setNewConditions(s.conditions);
                        setNewCategoryId(s.categoryId);
                        setNewRenameTo(s.renameTo || '');
                        setNewDescription(s.description);
                      }}
                    >
                      Edit First
                    </Button>
                    <Button
                      className={`text-xs px-3 py-1 ${ds.bg.tertiary} ${ds.text.muted}`}
                      onClick={() => setSuggestions((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
          {suggestions.length === 0 && !suggestionsMessage && (
            <div className={`text-center py-4 ${ds.text.muted}`}>No suggestions available.</div>
          )}
        </div>
      </Modal>
    </Card>
  );
}
