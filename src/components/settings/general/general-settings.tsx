'use client';

import { useEffect, useState } from 'react';
import type { PriceIndexResponse } from '@/lib/price-index/api';
import { REGION_NAMES, type IndexRegion } from '@/lib/price-index/types';
import { ds } from '@/lib/design-system';
import { errorText, sendJson } from '@/lib/send-json';
import { AppearanceGroup } from './appearance-group';
import { CurrencyGroup, fetchRates, type PairRate } from './currency-group';
import { InflationGroup } from './inflation-group';
import { SaveBar } from './save-bar';

/** The two choices that change every total, so they wait for Save. */
type Choices = { baseCurrency: string; inflationRegion: IndexRegion };

type Loaded = { rates: PairRate[]; regions: PriceIndexResponse['regions']; saved: Choices };

async function load(): Promise<Loaded> {
  const [rates, index, settings] = await Promise.all([
    fetchRates(),
    sendJson<PriceIndexResponse>('/api/price-index', 'GET'),
    sendJson<{ settings: { baseCurrency: string } }>('/api/settings', 'GET'),
  ]);
  return {
    rates,
    regions: index.regions,
    saved: {
      baseCurrency: settings.settings.baseCurrency,
      inflationRegion: index.selected,
    },
  };
}

function changesText(saved: Choices, draft: Choices): string {
  const changes: string[] = [];
  if (draft.baseCurrency !== saved.baseCurrency) {
    changes.push(`Base currency → ${draft.baseCurrency}`);
  }
  if (draft.inflationRegion !== saved.inflationRegion) {
    changes.push(`Reports adjusts by ${REGION_NAMES[draft.inflationRegion]} inflation`);
  }
  return changes.join(' · ');
}

/**
 * Settings → General. Loads its own data; base currency and the inflation choice are drafts
 * until Save (leaving the tab discards them). `onSaved` lets the page reload what depends on them.
 */
export function GeneralSettings({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Choices | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    load()
      .then((loaded) => {
        setData(loaded);
        setDraft(loaded.saved);
      })
      .catch((error) => {
        console.error('Failed to load general settings:', error);
        setLoadFailed(true);
      });
  }, []);

  // Without every saved value a Save could overwrite one with a guess, so show nothing editable.
  if (loadFailed) {
    return <p className={`text-sm ${ds.text.muted}`}>Couldn&apos;t load settings</p>;
  }
  if (!data || !draft) return null;

  const changes = changesText(data.saved, draft);
  const toggleRow = (key: string) => setOpenRow((open) => (open === key ? null : key));
  const edit = (patch: Partial<Choices>) => {
    setDraft({ ...draft, ...patch });
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await sendJson('/api/settings', 'PATCH', draft);
      setData((d) => d && { ...d, saved: draft });
      setSaveError(null);
      onSaved();
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(data.saved);
    setSaveError(null);
  };

  return (
    <div className="max-w-[760px]">
      <CurrencyGroup
        baseCurrency={draft.baseCurrency}
        openRow={openRow}
        rates={data.rates}
        onBaseCurrencyChange={(baseCurrency) => edit({ baseCurrency })}
        onRatesChange={(rates) => setData((d) => d && { ...d, rates })}
        onToggleRow={toggleRow}
      />
      <InflationGroup
        chosen={draft.inflationRegion}
        openRow={openRow}
        regions={data.regions}
        saved={data.saved.inflationRegion}
        onChoose={(inflationRegion) => edit({ inflationRegion })}
        onToggleRow={toggleRow}
      />
      <AppearanceGroup />
      {changes && (
        <SaveBar
          error={saveError}
          message={changes}
          saving={saving}
          onDiscard={discard}
          onSave={save}
        />
      )}
    </div>
  );
}
