import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const snapshotId1 = search.get('snapshot1');
  const snapshotId2 = search.get('snapshot2');

  if (!snapshotId1 || !snapshotId2) {
    return NextResponse.json(
      { error: 'Both snapshot1 and snapshot2 query params are required' },
      { status: 400 }
    );
  }

  const [snapshot1, snapshot2] = await Promise.all([
    prisma.netWorthSnapshot.findUnique({ where: { id: snapshotId1 } }),
    prisma.netWorthSnapshot.findUnique({ where: { id: snapshotId2 } }),
  ]);

  if (!snapshot1 || !snapshot2) {
    return NextResponse.json({ error: 'One or both snapshots not found' }, { status: 404 });
  }

  // Parse account balances
  const balances1 = JSON.parse(snapshot1.accountBalances) as Record<
    string,
    { balance: number; name: string; type: string; currency: string }
  >;
  const balances2 = JSON.parse(snapshot2.accountBalances) as Record<
    string,
    { balance: number; name: string; type: string; currency: string }
  >;

  // Calculate changes
  const netWorthChange = snapshot2.netWorth - snapshot1.netWorth;
  const netWorthChangePercent =
    snapshot1.netWorth !== 0 ? (netWorthChange / Math.abs(snapshot1.netWorth)) * 100 : 0;

  const assetsChange = snapshot2.totalAssets - snapshot1.totalAssets;
  const assetsChangePercent =
    snapshot1.totalAssets !== 0 ? (assetsChange / snapshot1.totalAssets) * 100 : 0;

  const liabilitiesChange = snapshot2.totalLiabilities - snapshot1.totalLiabilities;
  const liabilitiesChangePercent =
    snapshot1.totalLiabilities !== 0 ? (liabilitiesChange / snapshot1.totalLiabilities) * 100 : 0;

  // Per-account changes
  const allAccountIds = new Set([...Object.keys(balances1), ...Object.keys(balances2)]);
  const accountChanges: Array<{
    accountId: string;
    name: string;
    type: string;
    balance1: number;
    balance2: number;
    change: number;
    changePercent: number;
  }> = [];

  for (const accountId of allAccountIds) {
    const acc1 = balances1[accountId];
    const acc2 = balances2[accountId];

    const balance1 = acc1?.balance ?? 0;
    const balance2 = acc2?.balance ?? 0;
    const change = balance2 - balance1;
    const changePercent = balance1 !== 0 ? (change / Math.abs(balance1)) * 100 : 0;

    accountChanges.push({
      accountId,
      name: acc2?.name ?? acc1?.name ?? 'Unknown',
      type: acc2?.type ?? acc1?.type ?? 'other',
      balance1,
      balance2,
      change,
      changePercent,
    });
  }

  // Sort by absolute change (biggest movers first)
  accountChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return NextResponse.json({
    snapshot1: {
      id: snapshot1.id,
      date: snapshot1.date,
      period: snapshot1.period,
      netWorth: snapshot1.netWorth,
      totalAssets: snapshot1.totalAssets,
      totalLiabilities: snapshot1.totalLiabilities,
    },
    snapshot2: {
      id: snapshot2.id,
      date: snapshot2.date,
      period: snapshot2.period,
      netWorth: snapshot2.netWorth,
      totalAssets: snapshot2.totalAssets,
      totalLiabilities: snapshot2.totalLiabilities,
    },
    comparison: {
      netWorthChange,
      netWorthChangePercent,
      assetsChange,
      assetsChangePercent,
      liabilitiesChange,
      liabilitiesChangePercent,
      accountChanges,
    },
  });
}
