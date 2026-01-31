'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';
import type { Condition, ConditionField, ConditionOperator } from '@/lib/rule-matcher';

type Account = { id: string; name: string };

type ConditionBuilderProps = {
  conditions: Condition[];
  onChange: (conditions: Condition[]) => void;
  accounts?: Account[];
};

const FIELD_OPTIONS: { value: ConditionField; label: string }[] = [
  { value: 'merchant', label: 'Merchant' },
  { value: 'merchantNormalized', label: 'Merchant (normalized)' },
  { value: 'note', label: 'Note' },
  { value: 'amount', label: 'Amount' },
  { value: 'account', label: 'Account' },
];

const OPERATORS_FOR_FIELD: Record<ConditionField, { value: ConditionOperator; label: string }[]> = {
  merchant: [
    { value: 'contains', label: 'contains' },
    { value: 'exact', label: 'is exactly' },
    { value: 'regex', label: 'matches regex' },
  ],
  merchantNormalized: [
    { value: 'contains', label: 'contains' },
    { value: 'exact', label: 'is exactly' },
    { value: 'regex', label: 'matches regex' },
  ],
  note: [
    { value: 'contains', label: 'contains' },
    { value: 'exact', label: 'is exactly' },
    { value: 'regex', label: 'matches regex' },
  ],
  amount: [
    { value: 'gt', label: 'greater than' },
    { value: 'lt', label: 'less than' },
    { value: 'between', label: 'between' },
    { value: 'equals', label: 'equals' },
  ],
  account: [{ value: 'equals', label: 'is' }],
};

function getDefaultOperator(field: ConditionField): ConditionOperator {
  if (field === 'amount') return 'gt';
  if (field === 'account') return 'equals';
  return 'contains';
}

function ConditionRow({
  condition,
  index,
  accounts,
  onUpdate,
  onRemove,
  canRemove,
}: {
  condition: Condition;
  index: number;
  accounts?: Account[];
  onUpdate: (index: number, condition: Condition) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}) {
  const operators = OPERATORS_FOR_FIELD[condition.field] || [];
  const isBetween = condition.field === 'amount' && condition.operator === 'between';
  const isAccount = condition.field === 'account';

  let betweenMin = '';
  let betweenMax = '';
  if (isBetween) {
    try {
      const range = JSON.parse(condition.value);
      betweenMin = range.min?.toString() ?? '';
      betweenMax = range.max?.toString() ?? '';
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {index > 0 && (
        <span className={`text-xs font-medium ${ds.text.muted} w-8 text-center`}>AND</span>
      )}
      {index === 0 && <span className="w-8" />}

      <Select
        className="w-40"
        value={condition.field}
        onChange={(e) => {
          const newField = e.target.value as ConditionField;
          onUpdate(index, {
            ...condition,
            field: newField,
            operator: getDefaultOperator(newField),
            value: '',
          });
        }}
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>

      {condition.negate && <span className={`text-xs font-bold ${ds.status.error.text}`}>NOT</span>}

      <Select
        className="w-36"
        value={condition.operator}
        onChange={(e) =>
          onUpdate(index, {
            ...condition,
            operator: e.target.value as ConditionOperator,
            value: '',
          })
        }
      >
        {operators.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </Select>

      {isAccount && accounts ? (
        <Select
          className="flex-1 min-w-[120px]"
          value={condition.value}
          onChange={(e) => onUpdate(index, { ...condition, value: e.target.value })}
        >
          <option value="">Select account...</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      ) : isBetween ? (
        <div className="flex items-center gap-1 flex-1">
          <Input
            className="w-24"
            placeholder="Min"
            type="number"
            value={betweenMin}
            onChange={(e) => {
              const range = {
                min: e.target.value ? Number(e.target.value) : undefined,
                max: betweenMax ? Number(betweenMax) : undefined,
              };
              onUpdate(index, { ...condition, value: JSON.stringify(range) });
            }}
          />
          <span className={`text-xs ${ds.text.muted}`}>and</span>
          <Input
            className="w-24"
            placeholder="Max"
            type="number"
            value={betweenMax}
            onChange={(e) => {
              const range = {
                min: betweenMin ? Number(betweenMin) : undefined,
                max: e.target.value ? Number(e.target.value) : undefined,
              };
              onUpdate(index, { ...condition, value: JSON.stringify(range) });
            }}
          />
        </div>
      ) : condition.field === 'amount' ? (
        <Input
          className="flex-1 min-w-[100px]"
          placeholder="Amount"
          type="number"
          value={condition.value}
          onChange={(e) => onUpdate(index, { ...condition, value: e.target.value })}
        />
      ) : (
        <Input
          className="flex-1 min-w-[120px]"
          placeholder={condition.operator === 'regex' ? 'Regex pattern...' : 'Value...'}
          value={condition.value}
          onChange={(e) => onUpdate(index, { ...condition, value: e.target.value })}
        />
      )}

      <button
        className={`text-xs px-1.5 py-0.5 rounded ${ds.text.muted} hover:${ds.status.error.text} transition-colors`}
        title={condition.negate ? 'Remove NOT' : 'Add NOT (negate)'}
        onClick={() => onUpdate(index, { ...condition, negate: !condition.negate })}
      >
        {condition.negate ? '!N' : 'N'}
      </button>

      {canRemove && (
        <button
          className={`text-sm ${ds.text.muted} hover:${ds.status.error.text} transition-colors`}
          title="Remove condition"
          onClick={() => onRemove(index)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function ConditionBuilder({ conditions, onChange, accounts }: ConditionBuilderProps) {
  const updateCondition = (index: number, condition: Condition) => {
    const updated = [...conditions];
    updated[index] = condition;
    onChange(updated);
  };

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const addCondition = () => {
    onChange([...conditions, { field: 'merchant', operator: 'contains', value: '' }]);
  };

  return (
    <div className="space-y-2">
      {conditions.map((condition, index) => (
        <ConditionRow
          key={index}
          accounts={accounts}
          canRemove={conditions.length > 1}
          condition={condition}
          index={index}
          onRemove={removeCondition}
          onUpdate={updateCondition}
        />
      ))}
      <Button
        className={`text-xs px-3 py-1 ${ds.bg.tertiary} ${ds.text.secondary} hover:${ds.text.primary}`}
        onClick={addCondition}
      >
        + Add Condition
      </Button>
    </div>
  );
}
