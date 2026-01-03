import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { month, income, spending } = body;

    if (!month || income === undefined || spending === undefined) {
      return NextResponse.json(
        { error: "Month, income, and spending are required" },
        { status: 400 }
      );
    }

    const incomeNum = Number(income);
    const spendingNum = Number(spending);

    if (isNaN(incomeNum) || isNaN(spendingNum)) {
      return NextResponse.json(
        { error: "Income and spending must be valid numbers" },
        { status: 400 }
      );
    }

    const savings = incomeNum - spendingNum;
    const savingsRate = incomeNum > 0 ? (savings / incomeNum) * 100 : 0;

    // Upsert the snapshot (create or update if exists)
    const snapshot = await prisma.monthlySnapshot.upsert({
      where: { month },
      update: {
        incomeTotal: incomeNum,
        spendingTotal: spendingNum,
        savingsTotal: savings,
        savingsRatePct: savingsRate,
        categoryTotals: "{}",
        merchantTotals: "{}"
      },
      create: {
        month,
        incomeTotal: incomeNum,
        spendingTotal: spendingNum,
        savingsTotal: savings,
        savingsRatePct: savingsRate,
        categoryTotals: "{}",
        merchantTotals: "{}"
      }
    });

    return NextResponse.json({ snapshot });
  } catch (error) {
    console.error("Failed to create snapshot:", error);
    return NextResponse.json({ error: "Failed to create snapshot" }, { status: 500 });
  }
}
