'use client';

import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtCompact, fmtMoney, fmtPct, signedTone } from './format';
import { squarify, tileBackground } from './treemap';

/** Layout units across; tiles are placed in % of the container width. */
const CANVAS = 1000;
/** The mock's canvas width, used only to decide which tile details fit. */
const DESIGN_WIDTH = 470;

export function HoldingsMap({ lines, height }: { lines: HoldingLine[]; height: number }) {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const tiles = squarify(
    lines.map((l) => ({ key: l.key, value: l.valueBase })),
    CANVAS,
    height
  );
  return (
    <div className="relative mt-2.5" style={{ height }}>
      {tiles.map((t) => {
        const l = byKey.get(t.key)!;
        const px = (t.w / CANVAS) * DESIGN_WIDTH;
        const size = px < 64 || t.h < 42 ? 'tiny' : px < 120 || t.h < 64 ? 'small' : 'full';
        return (
          <div
            key={t.key}
            className="absolute flex flex-col justify-between overflow-hidden rounded-md border border-[var(--border)] px-[9px] py-2 transition hover:brightness-110"
            style={{
              left: `${(t.x / CANVAS) * 100}%`,
              width: `calc(${(t.w / CANVAS) * 100}% - 3px)`,
              top: t.y,
              height: t.h - 3,
              background: tileBackground(l.rangeChangePct),
            }}
            title={`${l.name} · ${fmtMoney(l.valueBase)} · ${l.weightPct.toFixed(1)}% of portfolio`}
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
                    <span className="text-[var(--text-secondary)]">{fmtCompact(l.valueBase)}</span>
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
