'use client';

import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtCompact, fmtMoney, fmtPct, signedTone } from './format';
import { squarify, tileBackground } from './treemap';

/**
 * The mock's map width in px. Tiles are laid out on this width and the given height, so their
 * shapes match the container, then placed in % of the actual width.
 */
const DESIGN_WIDTH = 470;

export function HoldingsMap({
  lines,
  height,
  currency,
}: {
  lines: HoldingLine[];
  height: number;
  /** Base currency of `valueBase`. */
  currency: string;
}) {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const tiles = squarify(
    lines.map((l) => ({ key: l.key, value: l.valueBase })),
    DESIGN_WIDTH,
    height
  );
  return (
    <div className="relative mt-2.5" style={{ height }}>
      {tiles.map((t) => {
        const l = byKey.get(t.key)!;
        const size = t.w < 64 || t.h < 42 ? 'tiny' : t.w < 120 || t.h < 64 ? 'small' : 'full';
        return (
          <div
            key={t.key}
            className="absolute flex flex-col justify-between overflow-hidden rounded-md border border-[var(--border)] px-[9px] py-2 transition hover:brightness-110"
            style={{
              left: `${(t.x / DESIGN_WIDTH) * 100}%`,
              width: `calc(${(t.w / DESIGN_WIDTH) * 100}% - 3px)`,
              top: t.y,
              height: t.h - 3,
              background: tileBackground(l.rangeChangePct),
            }}
            title={`${l.name} · ${fmtMoney(l.valueBase, { currency })} · ${l.weightPct.toFixed(1)}% of portfolio`}
          >
            {size !== 'tiny' && (
              <>
                <div className="min-w-0">
                  <div className="font-mono text-xs font-medium text-[var(--text-primary)]">
                    {l.label}
                  </div>
                  {size === 'full' && (
                    <div className="truncate text-[10.5px] text-[var(--text-secondary)]">
                      {l.weightPct.toFixed(1)}% · {l.name}
                    </div>
                  )}
                </div>
                <div className="flex justify-between font-mono text-[11px]">
                  {size === 'full' && (
                    <span className="text-[var(--text-secondary)]">
                      {fmtCompact(l.valueBase, currency)}
                    </span>
                  )}
                  <span className={signedTone(l.rangeChangePct)}>
                    {l.rangeChangePct == null ? '—' : fmtPct(l.rangeChangePct)}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
