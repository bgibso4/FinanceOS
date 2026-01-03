import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dashboardAnalytics } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams;
    const endMonth = search.get("month") || (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    })();
    
    const [endYear, endM] = endMonth.split('-').map(Number);
    const results = [];
    
    // Get data for 12 months ending with the specified month
    for (let i = 11; i >= 0; i--) {
      const d = new Date(endYear, endM - 1 - i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const startDate = new Date(d.getFullYear(), d.getMonth(), 1);
      const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      
      const data = await dashboardAnalytics(prisma, {}, startDate, endDate);
      
      results.push({
        month,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        income: data.netCashflow.income,
        spending: data.netCashflow.spending,
        savings: data.netCashflow.savings,
        savingsRate: data.savingsRate.rate
      });
    }
    
    return NextResponse.json({ months: results });
  } catch (error) {
    console.error("Failed to generate trailing 12 months report:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
