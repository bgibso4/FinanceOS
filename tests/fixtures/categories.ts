import { createCategoryData, type CategoryData } from '../helpers/factories';

export const expenseCategories: CategoryData[] = [
  createCategoryData({
    id: 'cat-food',
    name: 'Food & Dining',
    type: 'expense',
  }),
  createCategoryData({
    id: 'cat-groceries',
    name: 'Groceries',
    type: 'expense',
    parentId: 'cat-food',
  }),
  createCategoryData({
    id: 'cat-restaurants',
    name: 'Restaurants',
    type: 'expense',
    parentId: 'cat-food',
  }),
  createCategoryData({
    id: 'cat-transport',
    name: 'Transportation',
    type: 'expense',
  }),
  createCategoryData({
    id: 'cat-rideshare',
    name: 'Rideshare',
    type: 'expense',
    parentId: 'cat-transport',
  }),
  createCategoryData({
    id: 'cat-entertainment',
    name: 'Entertainment',
    type: 'expense',
  }),
  createCategoryData({
    id: 'cat-shopping',
    name: 'Shopping',
    type: 'expense',
  }),
  createCategoryData({
    id: 'cat-utilities',
    name: 'Utilities',
    type: 'expense',
  }),
];

export const incomeCategories: CategoryData[] = [
  createCategoryData({
    id: 'cat-salary',
    name: 'Salary',
    type: 'income',
  }),
  createCategoryData({
    id: 'cat-freelance',
    name: 'Freelance',
    type: 'income',
  }),
  createCategoryData({
    id: 'cat-investments',
    name: 'Investment Income',
    type: 'income',
  }),
];

export const transferCategory = createCategoryData({
  id: 'cat-transfer',
  name: 'Transfer',
  type: 'transfer',
});

export const allCategories: CategoryData[] = [
  ...expenseCategories,
  ...incomeCategories,
  transferCategory,
];
