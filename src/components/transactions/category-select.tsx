import React from 'react';
import { Select } from '@/components/ui/select';
import type { Category } from './types';

// Strip emojis for sorting purposes
const stripEmojis = (str: string) =>
  str.replace(/[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}️]/gu, '').trim();

export const sortByName = (a: { name: string }, b: { name: string }) =>
  stripEmojis(a.name).localeCompare(stripEmojis(b.name));

type Props = {
  categories: Category[];
  value: string;
  onChange: (id: string | null) => void;
  id?: string;
  'aria-label'?: string;
  /** Label for the empty choice. */
  placeholder?: string;
  className?: string;
};

export function CategorySelect({
  categories,
  value,
  onChange,
  id,
  'aria-label': ariaLabel,
  placeholder = 'No category',
  className = 'w-full',
}: Props) {
  return (
    <Select
      aria-label={ariaLabel}
      className={className}
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {categories
        .filter((c) => !c.parentId)
        .sort(sortByName)
        .map((group) => {
          const groupCategories = categories
            .filter((c) => c.parentId === group.id)
            .sort(sortByName);
          if (groupCategories.length === 0) return null;

          return (
            <optgroup key={group.id} label={group.name}>
              {groupCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </optgroup>
          );
        })}
    </Select>
  );
}
