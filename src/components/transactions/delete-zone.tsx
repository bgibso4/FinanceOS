'use client';

import { useState } from 'react';

interface DeleteZoneProps {
  onDelete: () => Promise<void>;
}

export function DeleteZone({ onDelete }: DeleteZoneProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const handleDelete = async () => {
    setPending(true);
    try {
      await onDelete();
    } finally {
      setPending(false);
    }
  };

  if (!confirming) {
    return (
      <button
        className="mx-auto flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--red)_45%,transparent)] px-5 text-sm font-medium text-[var(--red)] transition-colors hover:bg-[color-mix(in_srgb,var(--red)_10%,transparent)]"
        type="button"
        onClick={() => setConfirming(true)}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="14"
        >
          <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v6m4-6v6" />
        </svg>
        Delete transaction
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-sm">
      <span className="text-[var(--text-secondary)]">Delete this transaction for good?</span>
      <div className="flex items-center gap-2">
        <button
          className="h-10 rounded-[10px] border border-[var(--border-hover)] px-5 text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
          disabled={pending}
          type="button"
          onClick={() => setConfirming(false)}
        >
          Keep it
        </button>
        <button
          className="h-10 rounded-[10px] bg-[var(--red)] px-5 font-medium text-white hover:opacity-90 disabled:opacity-50"
          disabled={pending}
          type="button"
          onClick={handleDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
