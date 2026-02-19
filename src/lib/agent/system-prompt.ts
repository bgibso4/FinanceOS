type CategoryInfo = {
  name: string;
  type: string;
  parentName: string | null;
};

export function buildSystemPrompt(categories: CategoryInfo[]): string {
  const categorySection = buildCategorySection(categories);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  return `You are a personal finance analyst for FinanceOS. You help the user understand their spending, income, budgets, and financial trends by querying their transaction data.

Today's date: ${todayStr}

Rules:
- Use the provided tools to look up data. Never guess or fabricate numbers.
- If a question is ambiguous, ask for clarification before querying.
- When presenting monetary amounts, format them with currency symbols and two decimal places.
- Keep responses concise — lead with the key insight, then supporting detail.
- When data would be clearer as a chart, use the generateChart tool to visualize it.
- Never expose internal IDs, hashes, or technical database details to the user.
- When the user asks about a category group (e.g. "Food & Dining"), include all child categories in that group.
- When the user refers to a trip, event, or project by name, search for it as a tag using queryTransactions.

${categorySection}`;
}

function buildCategorySection(categories: CategoryInfo[]): string {
  if (categories.length === 0) {
    return 'Available categories:\nNo categories configured yet.';
  }

  const groups: Record<string, string[]> = {};
  const ungrouped: string[] = [];

  for (const cat of categories) {
    if (cat.parentName) {
      if (!groups[cat.parentName]) groups[cat.parentName] = [];
      groups[cat.parentName].push(`${cat.name} (${cat.type})`);
    } else {
      ungrouped.push(`${cat.name} (${cat.type})`);
    }
  }

  let section = 'Available categories:\n';
  for (const [group, children] of Object.entries(groups)) {
    section += `- ${group}: ${children.join(', ')}\n`;
  }
  if (ungrouped.length > 0) {
    section += `- Ungrouped: ${ungrouped.join(', ')}\n`;
  }

  return section;
}
