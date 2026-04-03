'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type TagDef = { id: string; name: string; color: string };

export const tagColorMap: Record<string, { bg: string; text: string; border: string }> = {
  blue: {
    bg: 'bg-[var(--tag-blue)]/10',
    text: 'text-[var(--tag-blue)]',
    border: 'border-[var(--tag-blue)]/15',
  },
  green: {
    bg: 'bg-[var(--tag-green)]/10',
    text: 'text-[var(--tag-green)]',
    border: 'border-[var(--tag-green)]/15',
  },
  red: {
    bg: 'bg-[var(--tag-red)]/10',
    text: 'text-[var(--tag-red)]',
    border: 'border-[var(--tag-red)]/15',
  },
  yellow: {
    bg: 'bg-[var(--tag-yellow)]/10',
    text: 'text-[var(--tag-yellow)]',
    border: 'border-[var(--tag-yellow)]/15',
  },
  purple: {
    bg: 'bg-[var(--tag-purple)]/10',
    text: 'text-[var(--tag-purple)]',
    border: 'border-[var(--tag-purple)]/15',
  },
  pink: {
    bg: 'bg-[var(--tag-pink)]/10',
    text: 'text-[var(--tag-pink)]',
    border: 'border-[var(--tag-pink)]/15',
  },
  indigo: {
    bg: 'bg-[var(--tag-indigo)]/10',
    text: 'text-[var(--tag-indigo)]',
    border: 'border-[var(--tag-indigo)]/15',
  },
  orange: {
    bg: 'bg-[var(--tag-orange)]/10',
    text: 'text-[var(--tag-orange)]',
    border: 'border-[var(--tag-orange)]/15',
  },
  teal: {
    bg: 'bg-[var(--tag-teal)]/10',
    text: 'text-[var(--tag-teal)]',
    border: 'border-[var(--tag-teal)]/15',
  },
  gray: {
    bg: 'bg-[var(--bg-elevated)]',
    text: 'text-[var(--text-secondary)]',
    border: 'border-[var(--border)]',
  },
};

export function getTagColors(color: string) {
  return tagColorMap[color] || tagColorMap.gray;
}

type TagInputProps = {
  value: string[];
  onChange: (tags: string[]) => void;
  availableTags: TagDef[];
  onCreateTag?: (name: string) => Promise<TagDef | null>;
  size?: 'sm' | 'md';
};

export function TagInput({
  value,
  onChange,
  availableTags,
  onCreateTag,
  size = 'md',
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter available tags: exclude already-applied, match search text
  const filtered = availableTags.filter(
    (t) => !value.includes(t.name) && t.name.toLowerCase().includes(inputValue.toLowerCase())
  );

  const exactMatch = availableTags.some((t) => t.name.toLowerCase() === inputValue.toLowerCase());
  const showCreate = inputValue.trim() && !exactMatch && onCreateTag;

  // Total items in dropdown: filtered tags + optional create option
  const totalItems = filtered.length + (showCreate ? 1 : 0);

  useEffect(() => {
    setHighlightIndex(0);
  }, [inputValue]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addTag = (tagName: string) => {
    if (!value.includes(tagName)) {
      onChange([...value, tagName]);
    }
    setInputValue('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const removeTag = (tagName: string) => {
    onChange(value.filter((t) => t !== tagName));
  };

  const handleCreateTag = async () => {
    if (!onCreateTag || !inputValue.trim()) return;
    const tag = await onCreateTag(inputValue.trim());
    if (tag) {
      addTag(tag.name);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (totalItems === 0) return;

      if (highlightIndex < filtered.length) {
        addTag(filtered[highlightIndex].name);
      } else if (showCreate) {
        handleCreateTag();
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const pillSize = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-1';

  return (
    <div ref={containerRef} className="relative">
      {/* Pills + Input Row */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5',
          size === 'sm' ? 'min-h-[32px]' : 'min-h-[38px]'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tagName) => {
          const tagDef = availableTags.find((t) => t.name === tagName);
          const colors = getTagColors(tagDef?.color || 'gray');
          return (
            <span
              key={tagName}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border',
                pillSize,
                colors.bg,
                colors.text,
                colors.border
              )}
            >
              {tagName}
              <button
                className="ml-0.5 hover:opacity-70"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tagName);
                }}
              >
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    clipRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    fillRule="evenodd"
                  />
                </svg>
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          className={cn(
            'flex-1 min-w-[80px] bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            size === 'sm' ? 'text-xs' : 'text-sm'
          )}
          placeholder={value.length > 0 ? 'Add tag...' : 'Type to add tags...'}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && totalItems > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((tag, i) => {
            const colors = getTagColors(tag.color);
            return (
              <button
                key={tag.id}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  i === highlightIndex ? 'bg-[var(--bg-elevated)]' : 'hover:bg-[var(--bg-base)]'
                )}
                type="button"
                onClick={() => addTag(tag.name)}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                <span
                  className={cn('w-2.5 h-2.5 rounded-full shrink-0', colors.text)}
                  style={{ backgroundColor: 'currentColor' }}
                />
                <span className="text-[var(--text-primary)]">{tag.name}</span>
              </button>
            );
          })}
          {showCreate && (
            <button
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors border-t border-[var(--border)]',
                highlightIndex === filtered.length
                  ? 'bg-[var(--bg-elevated)]'
                  : 'hover:bg-[var(--bg-base)]'
              )}
              type="button"
              onClick={handleCreateTag}
              onMouseEnter={() => setHighlightIndex(filtered.length)}
            >
              <span className="text-[var(--accent)]">+</span>
              <span className="text-[var(--text-secondary)]">
                Create &ldquo;{inputValue.trim()}&rdquo;
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
