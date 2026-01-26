import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  accountId: z.string(), // FinanceOS account ID
  plaidEnrollmentId: z.string(),
  plaidAccountId: z.string(),
  plaidAccountName: z.string().optional(),
  plaidAccountType: z.string().optional(),
  plaidAccountSubtype: z.string().optional(),
  plaidAccountMask: z.string().optional(),
});

// POST: Link a FinanceOS account to a specific Plaid account
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.parse(body);

    // Verify enrollment exists
    const enrollment = await prisma.plaidEnrollment.findUnique({
      where: { id: parsed.plaidEnrollmentId },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    // Verify account exists
    const account = await prisma.account.findUnique({
      where: { id: parsed.accountId },
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Check if account already has a Plaid connection
    const existingConnection = await prisma.plaidConnection.findUnique({
      where: { accountId: parsed.accountId },
    });

    if (existingConnection) {
      // Update existing connection
      const updated = await prisma.plaidConnection.update({
        where: { id: existingConnection.id },
        data: {
          plaidEnrollmentId: parsed.plaidEnrollmentId,
          plaidAccountId: parsed.plaidAccountId,
          plaidAccountName: parsed.plaidAccountName,
          plaidAccountType: parsed.plaidAccountType,
          plaidAccountSubtype: parsed.plaidAccountSubtype,
          plaidAccountMask: parsed.plaidAccountMask,
          status: 'connected',
          lastSyncError: null,
        },
      });

      // Update account institution name
      await prisma.account.update({
        where: { id: parsed.accountId },
        data: { institution: enrollment.institutionName },
      });

      return NextResponse.json({
        success: true,
        connectionId: updated.id,
        isUpdate: true,
      });
    }

    // Create new connection
    const connection = await prisma.plaidConnection.create({
      data: {
        accountId: parsed.accountId,
        plaidEnrollmentId: parsed.plaidEnrollmentId,
        plaidAccountId: parsed.plaidAccountId,
        plaidAccountName: parsed.plaidAccountName,
        plaidAccountType: parsed.plaidAccountType,
        plaidAccountSubtype: parsed.plaidAccountSubtype,
        plaidAccountMask: parsed.plaidAccountMask,
        status: 'connected',
      },
    });

    // Update account institution name
    await prisma.account.update({
      where: { id: parsed.accountId },
      data: { institution: enrollment.institutionName },
    });

    return NextResponse.json({
      success: true,
      connectionId: connection.id,
      isUpdate: false,
    });
  } catch (error: unknown) {
    console.error('Error creating Plaid connection:', error);
    const message = error instanceof Error ? error.message : 'Failed to create connection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
