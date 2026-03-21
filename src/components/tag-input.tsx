'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type TagDef = { id: string; name: string; color: string };

export const tagColorMap: Record<string, { bg: string; text: string; border: string }> = {
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-500/20',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-500/30',
  },
  green: {
    bg: 'bg-green-100 dark:bg-green-500/20',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-500/30',
  },
  red: {
    bg: 'bg-red-100 dark:bg-red-500/20',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-500/30',
  },
  yellow: {
    bg: 'bg-yellow-100 dark:bg-yellow-500/20',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-200 dark:border-yellow-500/30',
  },
  purple: {
    bg: 'bg-purple-100 dark:bg-purple-500/20',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-500/30',
  },
  pink: {
    bg: 'bg-pink-100 dark:bg-pink-500/20',
    text: 'text-pink-700 dark:text-pink-300',
    border: 'border-pink-200 dark:border-pink-500/30',
  },
  indigo: {
    bg: 'bg-indigo-100 dark:bg-indigo-500/20',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-200 dark:border-indigo-500/30',
  },
  orange: {
    bg: 'bg-orange-100 dark:bg-orange-500/20',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-200 dark:border-orange-500/30',
  },
  teal: {
    bg: 'bg-teal-100 dark:bg-teal-500/20',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-500/30',
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
                  className={cn('w-2.5 h-2.5 rounded-full', colors.bg, 'border', colors.border)}
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
