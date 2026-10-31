import type { TrackingMode } from '@/lib/account-defaults';
import { BalanceSource } from '@/lib/investments/codes';
import { SOURCE_LABEL } from './format';

/** What the Manage account drawer needs to know to choose its sections and labels. */
export type DrawerAccount = {
  trackingMode?: string;
  balanceSource?: string | null;
  institution?: string | null;
  hasConnection: boolean; // any bank connection
};

/** Sections between Details and Info; Details, Info and Archive always render. */
export type DrawerSection = 'connection' | 'holdings' | 'entered' | 'reconcile';

export const TRACKING_INVESTMENT_TEXT = 'Investment: holdings and balance history';

const INVESTMENT: TrackingMode = 'investment';
const HOLDINGS_SOURCES: readonly string[] = [BalanceSource.Provider, BalanceSource.Valuation];

/** Section card and heading styles shared by the drawer's sections. */
export const SECTION_CARD =
  'mb-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4';
export const SECTION_HEAD =
  'mb-3 flex items-center justify-between gap-2.5 text-[13.5px] font-semibold text-[var(--text-primary)]';
export const SECTION_SUB = 'text-[11.5px] font-normal text-[var(--text-muted)]';

const isInvestment = (a: DrawerAccount) => a.trackingMode === INVESTMENT;

export function drawerSections(a: DrawerAccount): DrawerSection[] {
  if (!isInvestment(a)) return ['connection', 'reconcile'];
  const sections: DrawerSection[] = [];
  if (a.hasConnection) sections.push('connection');
  if (a.balanceSource && HOLDINGS_SOURCES.includes(a.balanceSource)) sections.push('holdings');
  sections.push('entered');
  return sections;
}

/** `Investment · Valued` for investment accounts; null otherwise. */
export function investmentBadge(a: DrawerAccount): string | null {
  if (!isInvestment(a)) return null;
  const label = SOURCE_LABEL[a.balanceSource as BalanceSource];
  return label ? `Investment · ${label}` : 'Investment';
}

/** `Test Bank` or `Test Bank · Investment · Valued`. */
export function drawerSubtitle(a: DrawerAccount): string {
  return [a.institution, investmentBadge(a)].filter(Boolean).join(' · ');
}
