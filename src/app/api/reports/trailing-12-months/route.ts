import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { dashboardAnalytics } from '@/lib/analytics';

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;
    const endMonth =
      search.get('month') ||
      (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      })();

    const [endYear, endM] = endMonth.split('-').map(Number);
    const results = [];

    // Get data for 12 months ending with the specified month
    for (let i = 11; i >= 0; i--) {
      const d = new Date(endYear, endM - 1 - i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      // Build filter strings and UTC dates to match Monthly Detail behavior
      const year = d.getFullYear();
      const monthNum = d.getMonth() + 1;
      const lastDay = new Date(year, monthNum, 0).getDate();
      const startDateStr = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      const endDateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // Create UTC dates like Monthly Detail does (filters.ts lines 50, 57)
      const startDate = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, monthNum - 1, lastDay, 23, 59, 59, 999));

      // Calculate from actual transactions first
      const data = await dashboardAnalytics(
        prisma,
        { startDate: startDateStr, endDate: endDateStr },
        startDate,
        endDate
      );

      let income = data.netCashflow.income;
      let spending = data.netCashflow.spending;
      let savings = data.netCashflow.savings;
      let savingsRate = data.savingsRate.rate;

      // If no transaction data exists, fall back to backfilled snapshot
      if (income === 0 && spending === 0) {
        const snapshot = await prisma.monthlySnapshot.findFirst({
          where: { month },
        });

        if (snapshot) {
          income = snapshot.incomeTotal;
          spending = snapshot.spendingTotal;
          savings = snapshot.savingsTotal;
          // Convert from percentage to decimal to match dashboardAnalytics format
          savingsRate = snapshot.savingsRatePct / 100;
        }
      }

      results.push({
        month,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        income,
        spending,
        savings,
        savingsRate,
      });
    }

    return NextResponse.json({ months: results });
  } catch (error) {
    console.error('Failed to generate trailing 12 months report:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
