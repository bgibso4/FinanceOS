import Link from 'next/link';

import { getTagColors } from '@/components/tag-input';
import { tagCostHref } from '@/lib/analytics-query';
import { fmtMoney } from '@/lib/currency';
import { ds } from '@/lib/design-system';

export type TagWithTotals = {
  id: string;
  name: string;
  color: string;
  transactionCount: number;
  total: number;
  firstDate: string | null;
  lastDate: string | null;
};

type Props = {
  tags: TagWithTotals[];
  today: string;
  onEdit: (tag: TagWithTotals) => void;
  onDelete: (tag: TagWithTotals) => void;
};

const ROW = 'grid grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_2rem] items-center gap-3 px-3';

export function TagsTable({ tags, today, onEdit, onDelete }: Props) {
  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <div className={`${ROW} py-2 text-xs ${ds.text.muted} border-b border-[var(--border)]`}>
        <span>Tag</span>
        <span className="text-right">Transactions</span>
        <span className="text-right">Total</span>
        <span />
        <span />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {tags.map((tag) => {
          const colors = getTagColors(tag.color);
          return (
            <div
              key={tag.id}
              className={`${ROW} group py-2.5 text-sm cursor-pointer hover:bg-bg-elevated transition-colors`}
              onClick={() => onEdit(tag)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.text}`}
                  style={{ backgroundColor: 'currentColor' }}
                />
                <span className={`font-medium truncate ${colors.text}`} title={tag.name}>
                  {tag.name}
                </span>
              </span>
              <span className={`text-right ${ds.text.secondary}`}>{tag.transactionCount}</span>
              <span className={`text-right font-mono ${ds.text.primary}`}>
                {fmtMoney(tag.total)}
              </span>
              <span className="text-right">
                {tag.firstDate && tag.lastDate && (
                  <Link
                    className={`text-xs ${ds.text.muted} hover:text-accent`}
                    href={tagCostHref(
                      { name: tag.name, firstDate: tag.firstDate, lastDate: tag.lastDate },
                      today
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    See cost →
                  </Link>
                )}
              </span>
              <button
                aria-label="Delete tag"
                className="justify-self-end opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-red/10 text-red transition-all"
                title="Delete tag"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(tag);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
