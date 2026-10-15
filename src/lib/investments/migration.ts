import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { utcDay } from './dates';
import { roundCents } from './money';
import { BalanceRowSource, BalanceSource } from './codes';

export const ADJUSTMENT_MERCHANT = 'Balance Adjustment';

export type Adjustment = { date: Date; amount: number };

export function replayAdjustments(adjustments: Adjustment[]): { date: Date; balance: number }[] {
  const sorted = [...adjustments].sort((a, b) => a.date.getTime() - b.date.getTime());
  const byDay = new Map<string, { date: Date; balance: number }>();
  let running = 0;
  for (const adj of sorted) {
    running += adj.amount;
    const day = utcDay(adj.date);
    byDay.set(day.toISOString(), { date: day, balance: roundCents(running) });
  }
  return [...byDay.values()];
}

const PlaidRefSchema = z.object({ institution: z.string(), mask: z.string() });

export const MigrationConfigSchema = z.object({
  accounts: z.array(
    z.object({
      accountId: z.string(),
      balanceSource: z.enum(BalanceSource),
      plaid: PlaidRefSchema.optional(),
    })
  ),
  create: z
    .array(
      z.object({ name: z.string(), type: z.string(), currency: z.string(), plaid: PlaidRefSchema })
    )
    .default([]),
});
export type MigrationConfig = z.input<typeof MigrationConfigSchema>;

export type PlaidAccountRef = {
  enrollmentId: string;
  institutionName: string;
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
};

type ConvertStep = {
  accountId: string;
  accountName: string;
  balanceSource: BalanceSource;
  currency: string;
  balances: { date: Date; balance: number }[];
  adjustmentIds: string[];
  plaid: PlaidAccountRef | null;
};
type CreateStep = { name: string; type: string; currency: string; plaid: PlaidAccountRef };

export type MigrationPlan = {
  convert: ConvertStep[];
  create: CreateStep[];
  skipped: { accountId: string; reason: string }[];
};

function matchPlaid(
  ref: { institution: string; mask: string },
  plaidAccounts: PlaidAccountRef[]
): PlaidAccountRef {
  const hits = plaidAccounts.filter(
    (p) =>
      p.mask === ref.mask && p.institutionName.toLowerCase().includes(ref.institution.toLowerCase())
  );
  if (hits.length !== 1) {
    throw new Error(
      `Expected exactly 1 Plaid account at "${ref.institution}" ending ${ref.mask}, found ${hits.length}`
    );
  }
  return hits[0];
}

export async function buildMigrationPlan(
  prisma: PrismaClient,
  input: MigrationConfig,
  plaidAccounts: PlaidAccountRef[]
): Promise<MigrationPlan> {
  const config = MigrationConfigSchema.parse(input);
  const plan: MigrationPlan = { convert: [], create: [], skipped: [] };

  const ids = config.accounts.map((e) => e.accountId);
  const dupId = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupId) throw new Error(`Account ${dupId} is listed more than once in the config`);
  const claimed = new Set<string>();
  const claim = (p: PlaidAccountRef, who: string) => {
    const key = `${p.enrollmentId}:${p.accountId}`;
    if (claimed.has(key)) throw new Error(`${who}: Plaid account already claimed by another entry`);
    claimed.add(key);
  };

  for (const entry of config.accounts) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: entry.accountId } });
    if (account.trackingMode === 'investment') {
      plan.skipped.push({ accountId: account.id, reason: 'already an investment account' });
      continue;
    }
    const txns = await prisma.transaction.findMany({ where: { accountId: account.id } });
    const other = txns.filter((t) => t.merchant !== ADJUSTMENT_MERCHANT);
    if (other.length) {
      throw new Error(
        `Account ${account.id} has ${other.length} non-adjustment transaction(s); refusing to convert`
      );
    }
    if (entry.balanceSource === BalanceSource.Provider && !entry.plaid) {
      throw new Error(
        `Account ${account.id}: provider accounts need a plaid { institution, mask }`
      );
    }
    const plaid = entry.plaid ? matchPlaid(entry.plaid, plaidAccounts) : null;
    if (plaid) {
      claim(plaid, `Account ${account.id}`);
      const existing = await prisma.plaidConnection.findFirst({
        where: {
          OR: [
            { accountId: account.id },
            { plaidEnrollmentId: plaid.enrollmentId, plaidAccountId: plaid.accountId },
          ],
        },
      });
      if (existing) {
        throw new Error(
          `Account ${account.id}: Plaid connection conflict (account already has a connection, or the Plaid account is linked elsewhere)`
        );
      }
    }
    plan.convert.push({
      accountId: account.id,
      accountName: account.name,
      balanceSource: entry.balanceSource,
      currency: account.currency,
      balances: replayAdjustments(txns.map((t) => ({ date: t.date, amount: t.amount }))),
      adjustmentIds: txns.map((t) => t.id),
      plaid,
    });
  }

  for (const entry of config.create) {
    const plaid = matchPlaid(entry.plaid, plaidAccounts);
    claim(plaid, `Create "${entry.name}"`);
    const linked = await prisma.plaidConnection.findFirst({
      where: { plaidEnrollmentId: plaid.enrollmentId, plaidAccountId: plaid.accountId },
    });
    if (linked) {
      plan.skipped.push({ accountId: linked.accountId, reason: 'Plaid account already linked' });
      continue;
    }
    plan.create.push({ name: entry.name, type: entry.type, currency: entry.currency, plaid });
  }
  return plan;
}

function connectionData(accountId: string, p: PlaidAccountRef) {
  return {
    accountId,
    plaidEnrollmentId: p.enrollmentId,
    plaidAccountId: p.accountId,
    plaidAccountName: p.name,
    plaidAccountType: p.type,
    plaidAccountSubtype: p.subtype,
    plaidAccountMask: p.mask,
    status: 'connected',
  };
}

export async function applyMigrationPlan(
  prisma: PrismaClient,
  plan: MigrationPlan
): Promise<{ convertedAccountIds: string[]; createdAccountIds: string[] }> {
  const createdAccountIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const step of plan.convert) {
      await tx.account.update({
        where: { id: step.accountId },
        data: { trackingMode: 'investment', balanceSource: step.balanceSource },
      });
      for (const b of step.balances) {
        await tx.accountBalance.upsert({
          where: { accountId_date: { accountId: step.accountId, date: b.date } },
          create: {
            accountId: step.accountId,
            date: b.date,
            balance: b.balance,
            currency: step.currency,
            source: BalanceRowSource.Manual,
          },
          update: {},
        });
      }
      await tx.transaction.deleteMany({ where: { id: { in: step.adjustmentIds } } });
      if (step.plaid)
        await tx.plaidConnection.create({ data: connectionData(step.accountId, step.plaid) });
    }
    for (const step of plan.create) {
      const account = await tx.account.create({
        data: {
          name: step.name,
          type: step.type,
          institution: step.plaid.institutionName,
          currency: step.currency,
          trackingMode: 'investment',
          balanceSource: BalanceSource.Provider,
        },
      });
      await tx.plaidConnection.create({ data: connectionData(account.id, step.plaid) });
      createdAccountIds.push(account.id);
    }
  });
  return { convertedAccountIds: plan.convert.map((c) => c.accountId), createdAccountIds };
}
