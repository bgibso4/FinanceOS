import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { isoDateSchema } from '@/lib/http';
import type { TripRecord } from './types';

export const tripInputSchema = z
  .object({
    name: z.string().trim().min(1),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((t) => t.endDate >= t.startDate, {
    message: 'End date must not be before start date',
    path: ['endDate'],
  });

export type TripInput = z.infer<typeof tripInputSchema>;

export class TripNotFoundError extends Error {
  constructor() {
    super('Trip not found');
  }
}

const RECORD = { id: true, name: true, startDate: true, endDate: true } as const;

export class TripStore {
  constructor(private readonly prisma: PrismaClient) {}

  list(): Promise<TripRecord[]> {
    return this.prisma.trip.findMany({
      select: RECORD,
      orderBy: [{ startDate: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  create(input: TripInput): Promise<TripRecord> {
    return this.prisma.trip.create({ data: input, select: RECORD });
  }

  async update(id: string, input: TripInput): Promise<TripRecord> {
    await this.require(id);
    return this.prisma.trip.update({ where: { id }, data: input, select: RECORD });
  }

  /** Transactions stay; their `tripId` clears and the trip's dismissals cascade away. */
  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.prisma.trip.delete({ where: { id } });
  }

  /** Links free, non-split transactions to the trip and remembers the ones turned down. */
  async assign(id: string, { add, dismiss }: { add: string[]; dismiss: string[] }) {
    await this.require(id);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transaction.updateMany({
        where: { id: { in: add }, tripId: null, isSplitParent: false },
        data: { tripId: id },
      });
      const known = await tx.transaction.findMany({
        where: { id: { in: dismiss } },
        select: { id: true },
      });
      for (const { id: transactionId } of known) {
        await tx.tripDismissal.upsert({
          where: { tripId_transactionId: { tripId: id, transactionId } },
          create: { tripId: id, transactionId },
          update: {},
        });
      }
      return { added: count };
    });
  }

  private async require(id: string): Promise<void> {
    if (!(await this.prisma.trip.findUnique({ where: { id }, select: { id: true } }))) {
      throw new TripNotFoundError();
    }
  }
}
