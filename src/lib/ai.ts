import OpenAI from 'openai';
import { z } from 'zod';
import type { Condition } from './rule-matcher';

export function isAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type MerchantGroup = {
  merchantNormalized: string;
  rawMerchants: string[];
  transactionCount: number;
  avgAmount: number;
  accountNames: string[];
};

export type RuleSuggestion = {
  conditions: Condition[];
  categoryId: string;
  categoryName: string;
  renameTo: string | null;
  description: string;
  confidence: number;
};

type CategoryInfo = {
  id: string;
  name: string;
  groupName: string | null;
};

const suggestionSchema = z.array(
  z.object({
    merchantKey: z.string(),
    categoryName: z.string(),
    matchValue: z.string(),
    renameTo: z.string().nullable(),
    description: z.string(),
    confidence: z.number(),
  })
);

export async function suggestRules(
  uncategorized: MerchantGroup[],
  categories: CategoryInfo[]
): Promise<RuleSuggestion[]> {
  if (!isAIConfigured() || uncategorized.length === 0) return [];

  const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  const categoryList = categories.reduce(
    (acc, c) => {
      const group = c.groupName || 'Other';
      if (!acc[group]) acc[group] = [];
      acc[group].push(c.name);
      return acc;
    },
    {} as Record<string, string[]>
  );

  const categoryText = Object.entries(categoryList)
    .map(([group, names]) => `- ${group}: ${names.join(', ')}`)
    .join('\n');

  const merchantText = uncategorized
    .slice(0, 50)
    .map(
      (m) =>
        `- "${m.rawMerchants[0]}" (${m.transactionCount} transactions, avg $${Math.abs(m.avgAmount).toFixed(0)}, accounts: ${m.accountNames.join(', ')})`
    )
    .join('\n');

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `You are a personal finance categorization assistant. You suggest rules for categorizing bank transactions. Respond ONLY with valid JSON.`,
      },
      {
        role: 'user',
        content: `Available categories (grouped):\n${categoryText}\n\nThese merchants have uncategorized transactions:\n${merchantText}\n\nFor each merchant, suggest a categorization rule as a JSON array:\n[\n  {\n    "merchantKey": "the normalized merchant key",\n    "categoryName": "exact category name from list above",\n    "matchValue": "distinctive substring to match (use a short, unique part of the merchant name)",\n    "renameTo": "clean human-readable merchant name, or null if already clean",\n    "description": "brief description of this rule",\n    "confidence": 0.0-1.0\n  }\n]\n\nRules:\n- Only suggest categories from the list above (exact name match required)\n- Use "contains" matching on the most distinctive part of the merchant name\n- Set confidence based on how certain you are about the category\n- Skip merchants you're unsure about\n- Set renameTo to a clean merchant name (e.g., "WHOLEFDS MKT" -> "Whole Foods")`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = suggestionSchema.parse(JSON.parse(jsonMatch[0]));

    return parsed
      .filter((s) => {
        const cat = categoryMap.get(s.categoryName.toLowerCase());
        return cat && s.confidence >= 0.5;
      })
      .map((s) => {
        const cat = categoryMap.get(s.categoryName.toLowerCase())!;
        return {
          conditions: [
            { field: 'merchant' as const, operator: 'contains' as const, value: s.matchValue },
          ],
          categoryId: cat.id,
          categoryName: cat.name,
          renameTo: s.renameTo,
          description: s.description,
          confidence: s.confidence,
        };
      });
  } catch {
    console.error('Failed to parse AI suggestion response');
    return [];
  }
}

export type ParsedRule = {
  conditions: Condition[];
  categoryName: string | null;
  renameTo: string | null;
  description: string;
};

const parsedRuleSchema = z.object({
  conditions: z.array(
    z.object({
      field: z.enum(['merchant', 'merchantNormalized', 'note', 'amount', 'account']),
      operator: z.enum(['contains', 'exact', 'regex', 'gt', 'lt', 'between', 'equals']),
      value: z.string(),
      negate: z.boolean().optional(),
    })
  ),
  categoryName: z.string().nullable(),
  renameTo: z.string().nullable(),
  description: z.string(),
});

export async function parseNaturalLanguageRule(
  text: string,
  categories: CategoryInfo[]
): Promise<ParsedRule | null> {
  if (!isAIConfigured()) return null;

  const categoryText = categories.map((c) => c.name).join(', ');

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `You are a rule builder that converts natural language into structured transaction categorization rules. Respond ONLY with valid JSON.`,
      },
      {
        role: 'user',
        content: `Available categories: ${categoryText}\n\nConvert this to a rule:\n"${text}"\n\nRespond with JSON:\n{\n  "conditions": [\n    { "field": "merchant|merchantNormalized|note|amount|account", "operator": "contains|exact|regex|gt|lt|between|equals", "value": "..." }\n  ],\n  "categoryName": "exact name from categories list, or null",\n  "renameTo": "clean merchant name or null",\n  "description": "brief description"\n}\n\nFor amount ranges, use {"min":X,"max":Y} as the value string.\nOnly use category names from the available list.`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return null;

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return parsedRuleSchema.parse(JSON.parse(jsonMatch[0]));
  } catch {
    console.error('Failed to parse natural language rule response');
    return null;
  }
}
