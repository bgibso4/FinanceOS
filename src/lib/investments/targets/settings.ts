import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { RateBook } from '@/lib/fx/rate-book';
import { BalanceSource } from '../codes';
import { InvestmentInputError } from '../account-guard';
import type { CurrentHoldingsReader } from '../current-holdings';
import { utcDay } from '../dates';
import type { HoldingRow } from '../holdings-view';
import { roundCents } from '../money';
import {
  finalTargets,
  targetTotals,
  type ClassInput,
  type FinalTarget,
  type RegionInput,
  type TargetSetup,
} from './allocation';
import { DEFAULT_CLASSES, DEFAULT_COUNTRIES, DEFAULT_REGIONS } from './defaults';

export type TargetCountryView = {
  id: string;
  name: string;
  weightPct: number;
  regionId: string;
};

export type TargetSettingsView = {
  classes: ClassInput[];
  regions: RegionInput[];
  countries: TargetCountryView[];
  final: FinalTarget[];
  totals: ReturnType<typeof targetTotals>;
  funds: {
    securityId: string;
    label: string;
    name: string;
    heldIn: string[];
    valueBase: number;
    classId: string | null;
    regionId: string | null;
  }[];
  accounts: {
    id: string;
    name: string;
    typedBalance: boolean;
    inTargets: boolean;
    valueBase: number;
  }[];
};

export type TargetChange =
  | {
      section: 'classes';
      items: {
        id?: string;
        name: string;
        pct: number;
        splitByRegion: boolean;
        buySecurityId: string | null;
      }[];
    }
  | {
      section: 'regions';
      items: { id?: string; name: string; tiltPct: number; buySecurityId: string | null }[];
    }
  | {
      section: 'countries';
      items: { id?: string; name: string; weightPct: number; regionId: string }[];
    }
  | {
      section: 'funds';
      items: { securityId: string; classId: string | null; regionId: string | null }[];
    }
  | { section: 'accounts'; items: { accountId: string; inTargets: boolean }[] };

/** The two delegates `saveList` works on; both have the same row shape for what it touches. */
type ListModel = {
  findMany(args: { select: { id: true } }): Promise<{ id: string }[]>;
  update(args: { where: { id: string }; data: never }): Promise<unknown>;
  create(args: { data: never }): Promise<unknown>;
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<unknown>;
};

/** Investing targets: the setup, what is held, and validated saves one section at a time. */
export class TargetSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly holdings: Pick<CurrentHoldingsReader, 'read'>,
    private readonly clock: Clock = systemClock
  ) {}

  /** Create the starting setup when there are no classes. */
  async ensureDefaults(): Promise<void> {
    if ((await this.prisma.targetClass.count()) > 0) return;
    await this.prisma.$transaction(async (tx) => {
      if ((await tx.targetClass.count()) > 0) return;
      await tx.targetClass.createMany({
        data: DEFAULT_CLASSES.map((c, sortOrder) => ({ ...c, sortOrder })),
      });
      const regionIds = new Map<string, string>();
      for (const [sortOrder, r] of DEFAULT_REGIONS.entries()) {
        const row = await tx.targetRegion.create({ data: { ...r, sortOrder } });
        regionIds.set(r.name, row.id);
      }
      await tx.targetCountry.createMany({
        data: DEFAULT_COUNTRIES.map(({ region, ...c }, sortOrder) => ({
          ...c,
          sortOrder,
          regionId: regionIds.get(region)!,
        })),
      });
    });
  }

  async setup(): Promise<TargetSetup & { countries: TargetCountryView[] }> {
    await this.ensureDefaults();
    const [classes, regions, countries] = await Promise.all([
      this.prisma.targetClass.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.targetRegion.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.targetCountry.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    return {
      classes: classes.map(({ id, name, pct, splitByRegion, buySecurityId }) => ({
        id,
        name,
        pct,
        splitByRegion,
        buySecurityId,
      })),
      regions: regions.map(({ id, name, tiltPct, buySecurityId }) => ({
        id,
        name,
        tiltPct,
        buySecurityId,
      })),
      countries: countries.map(({ id, name, weightPct, regionId }) => ({
        id,
        name,
        weightPct,
        regionId,
      })),
    };
  }

  async read(): Promise<TargetSettingsView> {
    const setup = await this.setup();
    const today = utcDay(this.clock.now());
    const [accounts, settings, rates, securities] = await Promise.all([
      this.prisma.account.findMany({
        where: { trackingMode: 'investment', isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.userSettings.findFirst(),
      RateBook.load(this.prisma),
      this.prisma.security.findMany({
        where: { OR: [{ targetClassId: { not: null } }, { targetRegionId: { not: null } }] },
        select: { id: true, targetClassId: true, targetRegionId: true },
      }),
    ]);
    const rows = await this.holdings.read({
      accounts,
      today,
      rangeStart: today,
      baseCurrency: settings?.baseCurrency || 'USD',
      rates,
    });
    const assigned = new Map(securities.map((s) => [s.id, s]));
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));

    const byFund = new Map<string, HoldingRow[]>();
    for (const r of rows.filter((h) => h.kind === 'security')) {
      byFund.set(r.securityId, [...(byFund.get(r.securityId) ?? []), r]);
    }
    const funds = [...byFund.entries()]
      .map(([securityId, lines]) => ({
        securityId,
        label: lines[0].label,
        name: lines[0].name,
        heldIn: lines.map((l) => accountName.get(l.accountId)!).sort(),
        valueBase: roundCents(lines.reduce((s, l) => s + l.valueBase, 0)),
        classId: assigned.get(securityId)?.targetClassId ?? null,
        regionId: assigned.get(securityId)?.targetRegionId ?? null,
      }))
      .sort((a, b) => b.valueBase - a.valueBase);

    return {
      classes: setup.classes,
      regions: setup.regions,
      countries: setup.countries,
      final: finalTargets(setup),
      totals: targetTotals(setup),
      funds,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        typedBalance: a.balanceSource === BalanceSource.Manual,
        inTargets: a.inTargets,
        valueBase: roundCents(
          rows.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.valueBase, 0)
        ),
      })),
    };
  }

  async save(change: TargetChange): Promise<TargetSettingsView> {
    await this.ensureDefaults();
    switch (change.section) {
      case 'classes':
        if (change.items.filter((c) => c.splitByRegion).length > 1) {
          throw new InvestmentInputError('Only one class can be split by region');
        }
        await this.prisma.$transaction(async (tx) => {
          await this.saveList(tx.targetClass as unknown as ListModel, change.items, (removed) =>
            tx.security.updateMany({
              where: { targetClassId: { in: removed } },
              data: { targetClassId: null, targetRegionId: null },
            })
          );
        });
        break;
      case 'regions':
        if (change.items.some((r) => r.tiltPct <= -100)) {
          throw new InvestmentInputError('Tilt must be above −100%');
        }
        await this.prisma.$transaction((tx) =>
          this.saveList(tx.targetRegion as unknown as ListModel, change.items)
        );
        break;
      case 'countries':
        await this.saveCountries(change.items);
        break;
      case 'funds':
        await this.saveFunds(change.items);
        break;
      case 'accounts':
        await this.prisma.$transaction(
          change.items.map((i) =>
            this.prisma.account.update({
              where: { id: i.accountId },
              data: { inTargets: i.inTargets },
            })
          )
        );
        break;
    }
    return this.read();
  }

  private async saveCountries(items: Extract<TargetChange, { section: 'countries' }>['items']) {
    const regions = new Set((await this.prisma.targetRegion.findMany()).map((r) => r.id));
    if (items.some((c) => !regions.has(c.regionId))) {
      throw new InvestmentInputError('Unknown region');
    }
    await this.prisma.$transaction((tx) =>
      this.saveList(tx.targetCountry as unknown as ListModel, items)
    );
  }

  private async saveFunds(items: Extract<TargetChange, { section: 'funds' }>['items']) {
    const [classes, regions] = await Promise.all([
      this.prisma.targetClass.findMany(),
      this.prisma.targetRegion.findMany({ select: { id: true } }),
    ]);
    const split = new Set(classes.filter((c) => c.splitByRegion).map((c) => c.id));
    for (const i of items) {
      if (i.classId && !classes.some((c) => c.id === i.classId)) {
        throw new InvestmentInputError('Unknown class');
      }
      if (i.regionId && !regions.some((r) => r.id === i.regionId)) {
        throw new InvestmentInputError('Unknown region');
      }
      const isSplit = i.classId !== null && split.has(i.classId);
      if (isSplit && !i.regionId) throw new InvestmentInputError('Pick a region for this fund');
      if (!isSplit && i.regionId) {
        throw new InvestmentInputError('Only funds in a class split by region have a region');
      }
    }
    await this.prisma.$transaction(
      items.map((i) =>
        this.prisma.security.update({
          where: { id: i.securityId },
          data: { targetClassId: i.classId, targetRegionId: i.regionId },
        })
      )
    );
  }

  /**
   * Make `model` hold exactly `items`, inside the caller's transaction: rows with an id are
   * updated, rows without one created, rows not listed deleted. `sortOrder` is the list index.
   * `beforeDelete` gets the ids about to be deleted, for cleanup that needs them still present.
   */
  private async saveList<T extends { id?: string }>(
    model: ListModel,
    items: T[],
    beforeDelete?: (removed: string[]) => Promise<unknown>
  ): Promise<void> {
    const existing = (await model.findMany({ select: { id: true } })).map((r) => r.id);
    const kept = new Set(items.map((i) => i.id).filter((id): id is string => !!id));
    const removed = existing.filter((id) => !kept.has(id));
    for (const [sortOrder, { id, ...data }] of items.entries()) {
      if (id) await model.update({ where: { id }, data: { ...data, sortOrder } as never });
      else await model.create({ data: { ...data, sortOrder } as never });
    }
    if (!removed.length) return;
    await beforeDelete?.(removed);
    await model.deleteMany({ where: { id: { in: removed } } });
  }
}
