import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createTransactionData } from '../../helpers/factories';
import { detectTransfers } from '@/lib/sync-common';

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

describe('Venmo pass-through handling in detectTransfers', () => {
  let prisma: PrismaClient;
  let venmoId: string;
  let checkingId: string;
  let cardId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    venmoId = (
      await prisma.account.create({
        data: createAccountData({ name: 'Personal Profile', institution: 'Venmo - Personal' }),
      })
    ).id;
    checkingId = (
      await prisma.account.create({
        data: createAccountData({ name: 'Checking', institution: 'Chase' }),
      })
    ).id;
    cardId = (
      await prisma.account.create({
        data: createAccountData({ name: 'Freedom', type: 'credit', institution: 'Chase' }),
      })
    ).id;
  });

  async function addTx(accountId: string, overrides: Parameters<typeof createTransactionData>[1]) {
    return prisma.transaction.create({ data: createTransactionData(accountId, overrides) });
  }

  async function topUps() {
    return prisma.transaction.findMany({
      where: { accountId: venmoId, merchant: { startsWith: 'Top-up from' } },
    });
  }

  it('adds a linked top-up when a bank-funded Venmo payment syncs after its bank twin', async () => {
    const bank = await addTx(checkingId, { date: daysAgo(4), amount: -100, merchant: 'VENMO' });
    const payment = await addTx(venmoId, {
      date: daysAgo(5),
      amount: -100,
      merchant: 'Adrian Fekete "Din"',
    });

    await detectTransfers(venmoId, new Set([payment.id]), prisma);

    const [topUp] = await topUps();
    expect(topUp).toBeDefined();
    expect(topUp.amount).toBe(100);
    expect(topUp.merchant).toBe('Top-up from Checking');
    expect(topUp.date.getTime()).toBe(payment.date.getTime());
    expect(topUp.isTransfer).toBe(true);

    const bankAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: bank.id } });
    expect(bankAfter.isTransfer).toBe(true);
    expect(bankAfter.transferGroupId).toBe(topUp.transferGroupId);

    // The payment itself is real spending
    const paymentAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfter.isTransfer).toBe(false);
  });

  it('adds the top-up when the bank twin is the one that syncs second', async () => {
    await addTx(venmoId, { date: daysAgo(5), amount: -55, merchant: 'Ron Shimo "Haircut"' });
    const bank = await addTx(checkingId, { date: daysAgo(3), amount: -55, merchant: 'Venmo' });

    await detectTransfers(checkingId, new Set([bank.id]), prisma);

    expect(await topUps()).toHaveLength(1);
    const bankAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: bank.id } });
    expect(bankAfter.isTransfer).toBe(true);
  });

  it('does not add a second top-up on later syncs', async () => {
    const payment = await addTx(venmoId, {
      date: daysAgo(5),
      amount: -100,
      merchant: 'Billy Wagner "Din"',
    });
    const bank = await addTx(checkingId, { date: daysAgo(4), amount: -100, merchant: 'VENMO' });

    await detectTransfers(venmoId, new Set([payment.id]), prisma);
    await detectTransfers(checkingId, new Set([bank.id]), prisma);
    await detectTransfers(venmoId, new Set([payment.id]), prisma);

    expect(await topUps()).toHaveLength(1);
  });

  it('leaves a payment made from the Venmo balance alone (no bank twin)', async () => {
    const payment = await addTx(venmoId, {
      date: daysAgo(5),
      amount: -75,
      merchant: 'Ron Shimo "Haircut"',
    });

    await detectTransfers(venmoId, new Set([payment.id]), prisma);

    expect(await topUps()).toHaveLength(0);
  });

  it('clears the transfer flag Plaid puts on payments to people', async () => {
    const payment = await addTx(venmoId, {
      date: daysAgo(5),
      amount: -1280,
      merchant: 'Adrian Fekete "Whis"',
      isTransfer: true,
    });

    await detectTransfers(venmoId, new Set([payment.id]), prisma);

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.isTransfer).toBe(false);
  });

  it('never pairs a received Venmo payment with an exact-amount card charge', async () => {
    const received = await addTx(venmoId, {
      date: daysAgo(2),
      amount: 35,
      merchant: 'Fernando Valdivia "Happy Hour"',
    });
    const charge = await addTx(cardId, { date: daysAgo(2), amount: -35, merchant: 'CVS' });

    await detectTransfers(venmoId, new Set([received.id]), prisma);

    const r = await prisma.transaction.findUniqueOrThrow({ where: { id: received.id } });
    const c = await prisma.transaction.findUniqueOrThrow({ where: { id: charge.id } });
    expect(r.isTransfer).toBe(false);
    expect(c.isTransfer).toBe(false);
  });

  it('never pairs Venmo rows with each other as a same-account transfer', async () => {
    const inbound = await addTx(venmoId, {
      date: daysAgo(2),
      amount: 70,
      merchant: 'Jay Park "Din"',
    });
    const outbound = await addTx(venmoId, {
      date: daysAgo(2),
      amount: -70,
      merchant: 'Luka "Golf"',
    });

    await detectTransfers(venmoId, new Set([inbound.id, outbound.id]), prisma);

    for (const id of [inbound.id, outbound.id]) {
      const t = await prisma.transaction.findUniqueOrThrow({ where: { id } });
      expect(t.isTransfer).toBe(false);
    }
  });

  it('still links a Venmo cash-out to the bank deposit', async () => {
    const cashOut = await addTx(venmoId, {
      date: daysAgo(6),
      amount: -400,
      merchant: 'Standard transfer',
    });
    const deposit = await addTx(checkingId, { date: daysAgo(4), amount: 400, merchant: 'VENMO' });

    await detectTransfers(venmoId, new Set([cashOut.id]), prisma);

    const a = await prisma.transaction.findUniqueOrThrow({ where: { id: cashOut.id } });
    const b = await prisma.transaction.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(a.isTransfer).toBe(true);
    expect(a.transferGroupId).toBeTruthy();
    expect(a.transferGroupId).toBe(b.transferGroupId);
    expect(await topUps()).toHaveLength(0);
  });
});
