import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { AccountBase } from 'plaid';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { encryptAccessToken, decryptAccessToken } from '@/lib/encryption';
import { classifyPlaidError } from '@/lib/bank-errors';
import { isAccountIgnored, type ProviderAccount } from '@/lib/bank-account-matching';
import { isAccountsCacheFresh, parseCachedAccounts } from '@/lib/enrollment-cache';

const createSchema = z.object({
  publicToken: z.string(),
  institutionId: z.string().optional(),
  institutionName: z.string(),
});

// GET: List all Plaid enrollments with available accounts
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get('refresh') === '1';

    const enrollments = await prisma.plaidEnrollment.findMany({
      include: {
        connections: {
          include: {
            account: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch available accounts for each enrollment
    const plaid = getPlaidClient();
    const ignored = await prisma.ignoredBankAccount.findMany({ where: { provider: 'plaid' } });

    /**
     * Write the provider's account list to the cache, swallowing any failure. Isolated
     * from the fetch on purpose: caching is an optimization, and a write error inside
     * the try below is classified as a bank auth failure, which flips a live enrollment
     * to needs_reauth.
     */
    const cacheAccounts = async (id: string, accounts: AccountBase[]) => {
      try {
        await prisma.plaidEnrollment.update({
          where: { id },
          data: { cachedAccounts: JSON.stringify(accounts), accountsCachedAt: new Date() },
        });
      } catch (e) {
        console.error('Failed to cache Plaid accounts (non-fatal):', e);
      }
    };
    const enrollmentsWithAccounts = await Promise.all(
      enrollments.map(async (enrollment) => {
        try {
          const cached = forceRefresh
            ? null
            : isAccountsCacheFresh(enrollment.accountsCachedAt, new Date())
              ? parseCachedAccounts<AccountBase>(enrollment.cachedAccounts)
              : null;

          let allAccounts: AccountBase[];
          if (cached) {
            allAccounts = cached;
          } else {
            const accessToken = decryptAccessToken(
              enrollment.accessTokenEncrypted,
              enrollment.accessTokenIv
            );

            const response = await plaid.accountsGet({ access_token: accessToken });
            allAccounts = response.data.accounts;

            await cacheAccounts(enrollment.id, allAccounts);
          }

          // Filter out already-linked accounts
          const linkedPlaidAccountIds = new Set(
            enrollment.connections.map((c) => c.plaidAccountId)
          );
          const unlinked: ProviderAccount[] = allAccounts
            .filter((acc) => !linkedPlaidAccountIds.has(acc.account_id))
            .map((acc) => ({
              externalId: acc.account_id,
              name: acc.name,
              type: acc.type,
              subtype: acc.subtype || '',
              lastFour: acc.mask || '',
            }));

          const institutionKey = enrollment.institutionId ?? '';

          return {
            id: enrollment.id,
            plaidItemId: enrollment.plaidItemId,
            institutionId: enrollment.institutionId,
            institutionName: enrollment.institutionName,
            status: enrollment.status,
            lastSyncAt: enrollment.lastSyncAt,
            connections: enrollment.connections.map((c) => ({
              id: c.id,
              plaidAccountId: c.plaidAccountId,
              plaidAccountName: c.plaidAccountName,
              account: c.account,
              status: c.status,
            })),
            availableAccounts: unlinked.filter(
              (a) => !isAccountIgnored(a, institutionKey, ignored)
            ),
            hiddenAccounts: unlinked.filter((a) => isAccountIgnored(a, institutionKey, ignored)),
            totalAccountCount: allAccounts.length,
          };
        } catch (error) {
          const { needsReauth, reason } = classifyPlaidError(error);

          if (needsReauth) {
            // Stale bank session — expected lifecycle state. Log concisely (the
            // raw AxiosError is a multi-KB object) and persist so Settings shows
            // "Needs Reconnection" plus the Reconnect button on load. Plaid uses
            // 'needs_reauth' (matching the connection-level status the sync route
            // sets, and the value the UI's PlaidReconnectButton keys off).
            console.warn(
              `Plaid enrollment "${enrollment.institutionName}" needs reconnection: ${reason}`
            );
            if (enrollment.status !== 'needs_reauth') {
              await prisma.plaidEnrollment
                .update({
                  where: { id: enrollment.id },
                  data: { status: 'needs_reauth' },
                })
                .catch((e) => console.error('Failed to update Plaid enrollment status:', e));
            }
          } else {
            console.error(
              `Error fetching accounts for Plaid enrollment "${enrollment.institutionName}": ${reason}`
            );
          }

          // Return enrollment without available accounts if fetch fails
          return {
            id: enrollment.id,
            plaidItemId: enrollment.plaidItemId,
            institutionId: enrollment.institutionId,
            institutionName: enrollment.institutionName,
            status: needsReauth ? 'needs_reauth' : 'error',
            lastSyncAt: enrollment.lastSyncAt,
            connections: enrollment.connections.map((c) => ({
              id: c.id,
              plaidAccountId: c.plaidAccountId,
              plaidAccountName: c.plaidAccountName,
              account: c.account,
              status: c.status,
            })),
            availableAccounts: [],
            hiddenAccounts: [],
            totalAccountCount: enrollment.connections.length,
          };
        }
      })
    );

    return NextResponse.json({ enrollments: enrollmentsWithAccounts });
  } catch (error: unknown) {
    console.error('Error fetching Plaid enrollments:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch enrollments';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Create new Plaid enrollment (institution-level connection)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSchema.parse(body);

    const plaid = getPlaidClient();

    // Exchange public token for access token
    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token: parsed.publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Encrypt the access token
    const { encrypted, iv } = encryptAccessToken(accessToken);

    // Check if enrollment already exists for this item
    const existing = await prisma.plaidEnrollment.findUnique({
      where: { plaidItemId: itemId },
    });

    if (existing) {
      // Update existing enrollment with new token
      const updated = await prisma.plaidEnrollment.update({
        where: { id: existing.id },
        data: {
          accessTokenEncrypted: encrypted,
          accessTokenIv: iv,
          status: 'connected',
        },
      });

      return NextResponse.json({
        success: true,
        enrollmentId: updated.id,
        isUpdate: true,
      });
    }

    // Create new enrollment
    const enrollment = await prisma.plaidEnrollment.create({
      data: {
        plaidItemId: itemId,
        institutionId: parsed.institutionId,
        institutionName: parsed.institutionName,
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        status: 'connected',
      },
    });

    return NextResponse.json({
      success: true,
      enrollmentId: enrollment.id,
      isUpdate: false,
    });
  } catch (error: unknown) {
    console.error('Error creating Plaid enrollment:', error);
    const message = error instanceof Error ? error.message : 'Failed to create enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Remove Plaid enrollment and all connections
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const enrollmentId = searchParams.get('id');

    if (!enrollmentId) {
      return NextResponse.json({ error: 'Enrollment ID required' }, { status: 400 });
    }

    const enrollment = await prisma.plaidEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { connections: true },
    });

    if (!enrollment) {
      // Already deleted - return success for idempotency
      return NextResponse.json({ success: true, alreadyDeleted: true });
    }

    // Try to remove item from Plaid
    try {
      const plaid = getPlaidClient();
      const accessToken = decryptAccessToken(
        enrollment.accessTokenEncrypted,
        enrollment.accessTokenIv
      );
      await plaid.itemRemove({ access_token: accessToken });
    } catch (plaidError) {
      console.error('Error removing Plaid item:', plaidError);
      // Continue with local deletion
    }

    // Delete enrollment (cascades to connections)
    await prisma.plaidEnrollment.delete({
      where: { id: enrollmentId },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting Plaid enrollment:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
