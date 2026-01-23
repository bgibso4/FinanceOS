import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { inferSpecFromQuestion, runAnalyticQuery } from '@/lib/agent';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question: string = body.question ?? '';
  const spec = body.spec ?? inferSpecFromQuestion(question);
  try {
    const response = await runAnalyticQuery(prisma, spec);
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json(
      {
        textAnswer: 'Unable to process analytic query.',
        assumptions: [err?.message ?? 'unknown error'],
      },
      { status: 400 }
    );
  }
}
