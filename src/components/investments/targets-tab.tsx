'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pricing } from '@/lib/investments/codes';
import type { SecurityList } from '@/lib/investments/security-list';
import type { TargetChange, TargetSettingsView } from '@/lib/investments/targets/settings';
import { errorText, sendJson } from './editor-kit';
import {
  AccountsCard,
  ClassesCard,
  CountriesCard,
  FundsCard,
  RegionsCard,
  type BuyOption,
} from './targets-cards';

type Section = TargetChange['section'];

/** Settings → Investing Targets: the classes, regions, countries, fund assignments and accounts. */
export function TargetsTab() {
  const [view, setView] = useState<TargetSettingsView | null>(null);
  const [buyOptions, setBuyOptions] = useState<BuyOption[]>([]);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({});
  const [saving, setSaving] = useState<Section | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [targets, securities] = await Promise.all([
          sendJson<TargetSettingsView>('/api/investments/targets', 'GET'),
          sendJson<SecurityList>('/api/investments/securities', 'GET'),
        ]);
        if (!live) return;
        setView(targets);
        setBuyOptions(
          securities.securities
            .filter((s) => s.pricing === Pricing.Market)
            .map((s) => ({ id: s.id, label: s.label }))
        );
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(async (change: TargetChange) => {
    setSaving(change.section);
    setErrors((e) => ({ ...e, [change.section]: undefined }));
    try {
      setView(await sendJson<TargetSettingsView>('/api/investments/targets', 'PUT', change));
      return true;
    } catch (e) {
      setErrors((prev) => ({ ...prev, [change.section]: errorText(e) }));
      return false;
    } finally {
      setSaving(null);
    }
  }, []);

  if (failed) {
    return (
      <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
        Couldn’t load your investing targets.
      </p>
    );
  }
  if (!view) {
    return <p className="py-6 text-center text-sm text-[var(--text-secondary)]">Loading…</p>;
  }

  const props = (section: Section) => ({
    error: errors[section] ?? null,
    saving: saving !== null,
    onSave: save,
  });
  return (
    <div className="max-w-[920px] space-y-4">
      <ClassesCard buyOptions={buyOptions} view={view} {...props('classes')} />
      <RegionsCard buyOptions={buyOptions} view={view} {...props('regions')} />
      <CountriesCard view={view} {...props('countries')} />
      <FundsCard view={view} {...props('funds')} />
      <AccountsCard view={view} {...props('accounts')} />
    </div>
  );
}
