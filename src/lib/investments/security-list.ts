import type { PrismaClient } from '@prisma/client';
import { INVESTMENT_TRACKING_MODE } from '@/lib/account-defaults';
import { systemClock, type Clock } from '@/lib/clock';
import { PriceBook, institutionPricedIds } from '@/lib/prices/price-book';
import { SecurityType, type Pricing } from './codes';
import { latestSets } from './current-holdings';
import { isoDay, utcDay } from './dates';
import { isManualHoldingSecurity } from './manual-holding';

/** One row of Settings → Securities (spec 2026-10-14 §6). */
export type SecurityListItem = {
  id: string;
  /** Ticker, or the name when there is no ticker (cash reads `<currency> cash`). */
  label: string;
  name: string;
  type: SecurityType;
  currency: string;
  pricing: Pricing;
  priceSymbol: string | null;
  proxySymbol: string | null;
  fixedPrice: number | null;
  /** The latest price the security's pricing mode uses; `date` (YYYY-MM-DD) is null for Fixed. */
  latest: { price: number; date: string | null } | null;
  /** Whether institution prices are stored, so Institution pricing can be offered for it. */
  hasInstitutionPrice: boolean;
  /** Active accounts whose latest snapshot holds a non-zero quantity. */
  heldIn: number;
};

export type SecurityList = { securities: SecurityListItem[]; symbolHint: string };

const INVESTMENT = { trackingMode: INVESTMENT_TRACKING_MODE } as const;

/**
 * Aggregator cash carries an internal id as ticker and a long or oddly spaced name, so cash reads
 * by its currency.
 */
const labelOf = (s: { type: string; ticker: string | null; name: string; currency: string }) =>
  s.type === SecurityType.Cash ? `${s.currency} cash` : (s.ticker ?? s.name);

/**
 * Every security an investment account (active or closed) holds or traded, with how it is
 * priced. Manual accounts' balance mirrors are not securities and are left out.
 */
export class SecurityListReader {
  constructor(
    private readonly prisma: PrismaClient,
    /** How to write a price symbol, from the market data provider; shown in the price window. */
    private readonly symbolHint: string,
    private readonly clock: Clock = systemClock
  ) {}

  async list(): Promise<SecurityList> {
    const today = utcDay(this.clock.now());
    const referenced = { some: { account: INVESTMENT } };
    const [found, snapshots] = await Promise.all([
      this.prisma.security.findMany({
        where: { OR: [{ holdings: referenced }, { transactions: referenced }] },
        include: { proxy: { select: { priceSymbol: true } } },
      }),
      this.prisma.holdingSnapshot.findMany({
        where: { account: { ...INVESTMENT, isActive: true }, date: { lte: today } },
        select: { accountId: true, securityId: true, date: true, quantity: true },
        orderBy: { date: 'desc' },
      }),
    ]);
    const securities = found.filter((s) => !isManualHoldingSecurity(s.id));

    const heldIn = new Map<string, number>();
    // The latest day per account first (as CurrentHoldingsReader does), then drop balance mirrors.
    for (const s of latestSets(snapshots)) {
      if (s.quantity !== 0 && !isManualHoldingSecurity(s.securityId))
        heldIn.set(s.securityId, (heldIn.get(s.securityId) ?? 0) + 1);
    }

    const ids = securities.map((s) => s.id);
    const book = await PriceBook.load(this.prisma, ids, today);
    const institutionPriced = await institutionPricedIds(this.prisma, ids);
    const items: SecurityListItem[] = securities.map((s) => {
      const latest = book.latest(s.id);
      return {
        id: s.id,
        label: labelOf(s),
        name: s.name,
        type: s.type as SecurityType,
        currency: s.currency,
        pricing: s.pricing as Pricing,
        priceSymbol: s.priceSymbol,
        proxySymbol: s.proxy?.priceSymbol ?? null,
        fixedPrice: s.fixedPrice,
        latest: latest
          ? { price: latest.price, date: latest.date ? isoDay(latest.date) : null }
          : null,
        hasInstitutionPrice: institutionPriced.has(s.id),
        heldIn: heldIn.get(s.id) ?? 0,
      };
    });
    items.sort(
      (a, b) =>
        a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.id.localeCompare(b.id)
    );
    return { securities: items, symbolHint: this.symbolHint };
  }
}
