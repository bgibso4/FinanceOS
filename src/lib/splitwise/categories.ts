import type { PrismaClient } from '@prisma/client';
import { autoCategorize, findCategoryBySearchTerms } from '@/lib/categorization';
import type { Categoriser } from './importer';

/** M3/P5: Splitwise's own category → a search term for yours, used when no rule matches. */
const SEARCH_TERM_BY_SPLITWISE_CATEGORY: Record<string, string> = {
  Hotel: 'lodging',
  Taxi: 'rideshare',
  Parking: 'transportation',
  Groceries: 'groceries',
  'Dining out': 'restaurants',
  'Gas/fuel': 'gas',
  'Entertainment - Other': 'entertainment',
  Movies: 'entertainment',
  Music: 'entertainment',
  Games: 'entertainment',
  Sports: 'sports',
};

/** Confidence of a fallback hit: the same as a keyword-catalog hit in autoCategorize. */
const FALLBACK_CONFIDENCE = 0.72;

/** Your rules and keywords first (autoCategorize, with its rename), then the Splitwise map. */
export function splitwiseCategoriser(prisma: PrismaClient): Categoriser {
  return async (row, accountId) => {
    const auto = await autoCategorize(prisma, row.description, null, row.amount, accountId);
    const merchant = auto.renameTo ?? row.description;
    if (auto.categoryId) {
      return { categoryId: auto.categoryId, confidence: auto.confidence, merchant };
    }

    const term = SEARCH_TERM_BY_SPLITWISE_CATEGORY[row.category];
    const categoryId =
      term &&
      findCategoryBySearchTerms(
        [term],
        await prisma.category.findMany({ select: { id: true, name: true, parentId: true } })
      );
    return categoryId
      ? { categoryId, confidence: FALLBACK_CONFIDENCE, merchant }
      : { categoryId: null, confidence: auto.confidence, merchant };
  };
}
