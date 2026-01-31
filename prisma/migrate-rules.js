/**
 * Migration script: Convert Rule matchType/matchValue to conditions JSON
 *
 * Run BEFORE `npx prisma db push` to convert existing rules.
 * This script reads the old format and writes the new format.
 *
 * Usage: node prisma/migrate-rules.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function convertToConditions(matchType, matchValue) {
  const fieldOperatorMap = {
    merchantContains: { field: 'merchant', operator: 'contains' },
    merchantRegex: { field: 'merchant', operator: 'regex' },
    noteContains: { field: 'note', operator: 'contains' },
  };

  const mapping = fieldOperatorMap[matchType];
  if (!mapping) {
    console.warn(`Unknown matchType: ${matchType}, defaulting to merchant contains`);
    return [{ field: 'merchant', operator: 'contains', value: matchValue }];
  }

  return [{ field: mapping.field, operator: mapping.operator, value: matchValue }];
}

async function main() {
  // Check if rules still have the old columns
  const rules = await prisma.$queryRaw`SELECT * FROM Rule`;

  if (rules.length === 0) {
    console.log('No rules to migrate.');
    return;
  }

  // Check if old columns exist
  const firstRule = rules[0];
  if (!('matchType' in firstRule)) {
    console.log('Rules already migrated (no matchType column found). Skipping.');
    return;
  }

  if ('conditions' in firstRule && firstRule.conditions) {
    console.log('Rules already have conditions column with data. Skipping.');
    return;
  }

  console.log(`Migrating ${rules.length} rules from matchType/matchValue to conditions JSON...`);

  for (const rule of rules) {
    const conditions = convertToConditions(rule.matchType, rule.matchValue);
    const conditionsJson = JSON.stringify(conditions);

    await prisma.$executeRaw`UPDATE Rule SET conditions = ${conditionsJson} WHERE id = ${rule.id}`;
    console.log(
      `  Migrated rule ${rule.id}: ${rule.matchType}/${rule.matchValue} -> ${conditionsJson}`
    );
  }

  console.log(`\nMigration complete. ${rules.length} rules converted.`);
  console.log('You can now run `npx prisma db push` to update the schema.');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
