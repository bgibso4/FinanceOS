import type { CategorySlice } from '@/lib/travel/types';

const STRENGTHS = [100, 68, 44, 26, 14];

/** One hue in steps: rank 0 (the biggest share) is darkest, rank 4 and beyond the lightest. */
export const tonalShade = (rank: number) =>
  `color-mix(in srgb, var(--accent) ${STRENGTHS[Math.min(rank, STRENGTHS.length - 1)]}%, var(--bg-card))`;

const percent = (share: number) => Math.round(share * 100);

/** A trip split by category, biggest first, with the top three named underneath. */
export function TonalBar({ slices: all }: { slices: CategorySlice[] }) {
  const slices = all.filter((slice) => slice.share > 0);
  return (
    <div>
      <div className="flex h-[9px] gap-[2px] overflow-hidden rounded-[5px] bg-[var(--track-bg)]">
        {slices.map((slice, rank) => (
          <i
            key={slice.categoryId ?? slice.name}
            data-segment
            className="block h-full"
            style={{ width: `${+(slice.share * 100).toFixed(2)}%`, background: tonalShade(rank) }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        {slices.slice(0, 3).map((slice, rank) => (
          <span key={slice.categoryId ?? slice.name} className="inline-flex items-center gap-[5px]">
            <i
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ background: tonalShade(rank) }}
            />
            {`${slice.name} ${percent(slice.share)}%`}
          </span>
        ))}
      </div>
    </div>
  );
}
