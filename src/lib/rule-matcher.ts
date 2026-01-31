export type ConditionField = 'merchant' | 'merchantNormalized' | 'note' | 'amount' | 'account';

export type ConditionOperator = 'contains' | 'exact' | 'regex' | 'gt' | 'lt' | 'between' | 'equals';

export type Condition = {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  negate?: boolean;
};

export type MatchInput = {
  merchant: string;
  merchantNormalized: string;
  note: string | null;
  amount: number;
  accountId: string;
};

function getStringField(input: MatchInput, field: ConditionField): string | null {
  switch (field) {
    case 'merchant':
      return input.merchant;
    case 'merchantNormalized':
      return input.merchantNormalized;
    case 'note':
      return input.note;
    default:
      return null;
  }
}

function evaluateStringCondition(
  fieldValue: string | null,
  operator: ConditionOperator,
  value: string
): boolean {
  if (fieldValue === null || fieldValue === undefined) return false;

  switch (operator) {
    case 'contains':
      return fieldValue.toLowerCase().includes(value.toLowerCase());
    case 'exact':
      return fieldValue.toLowerCase() === value.toLowerCase();
    case 'regex':
      try {
        const regex = new RegExp(value, 'i');
        return regex.test(fieldValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function evaluateAmountCondition(
  amount: number,
  operator: ConditionOperator,
  value: string
): boolean {
  switch (operator) {
    case 'gt':
      return amount > parseFloat(value);
    case 'lt':
      return amount < parseFloat(value);
    case 'equals':
      return amount === parseFloat(value);
    case 'between': {
      try {
        const range = JSON.parse(value) as { min?: number; max?: number };
        const aboveMin = range.min === undefined || amount >= range.min;
        const belowMax = range.max === undefined || amount <= range.max;
        return aboveMin && belowMax;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

function evaluateAccountCondition(
  accountId: string,
  operator: ConditionOperator,
  value: string
): boolean {
  if (operator === 'equals') {
    return accountId === value;
  }
  return false;
}

export function evaluateCondition(condition: Condition, input: MatchInput): boolean {
  let result = false;

  if (condition.field === 'amount') {
    result = evaluateAmountCondition(input.amount, condition.operator, condition.value);
  } else if (condition.field === 'account') {
    result = evaluateAccountCondition(input.accountId, condition.operator, condition.value);
  } else {
    const fieldValue = getStringField(input, condition.field);
    result = evaluateStringCondition(fieldValue, condition.operator, condition.value);
  }

  return condition.negate ? !result : result;
}

/**
 * Evaluate all conditions against an input using AND logic.
 * All conditions must pass for the rule to match.
 */
export function evaluateRule(conditions: Condition[], input: MatchInput): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((condition) => evaluateCondition(condition, input));
}

/**
 * Parse conditions from JSON string (as stored in DB).
 * Returns empty array if parsing fails.
 */
export function parseConditions(conditionsJson: string): Condition[] {
  try {
    const parsed = JSON.parse(conditionsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
