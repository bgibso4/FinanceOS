import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse } from '../_lib/http';
import { parseJsonBody } from '@/lib/http';

const id = z.string().min(1).optional();
const buySecurityId = z.string().min(1).nullable();

const bodySchema = z.discriminatedUnion('section', [
  z.object({
    section: z.literal('classes'),
    items: z.array(
      z.object({
        id,
        name: z.string().trim().min(1),
        pct: z.number().min(0),
        splitByRegion: z.boolean(),
        buySecurityId,
      })
    ),
  }),
  z.object({
    section: z.literal('regions'),
    items: z.array(
      z.object({ id, name: z.string().trim().min(1), tiltPct: z.number(), buySecurityId })
    ),
  }),
  z.object({
    section: z.literal('countries'),
    items: z.array(
      z.object({
        id,
        name: z.string().trim().min(1),
        weightPct: z.number().min(0),
        regionId: z.string().min(1),
      })
    ),
  }),
  z.object({
    section: z.literal('funds'),
    items: z.array(
      z.object({
        securityId: z.string().min(1),
        classId: z.string().min(1).nullable(),
        regionId: z.string().min(1).nullable(),
      })
    ),
  }),
  z.object({
    section: z.literal('accounts'),
    items: z.array(z.object({ accountId: z.string().min(1), inTargets: z.boolean() })),
  }),
]);

export async function GET(_request: NextRequest) {
  try {
    const { targets } = await getInvestmentServices();
    return NextResponse.json(await targets.read());
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load investing targets');
  }
}

export async function PUT(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema, 'Invalid investing targets');
  if ('response' in body) return body.response;
  try {
    const { targets } = await getInvestmentServices();
    return NextResponse.json(await targets.save(body.data));
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to save investing targets');
  }
}
