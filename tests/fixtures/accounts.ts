import { createAccountData, type AccountData } from '../helpers/factories';

export const testAccounts: AccountData[] = [
  createAccountData({
    id: 'acc-checking-1',
    name: 'Main Checking',
    type: 'checking',
    institution: 'Chase',
    currency: 'USD',
  }),
  createAccountData({
    id: 'acc-credit-1',
    name: 'Rewards Credit Card',
    type: 'credit',
    institution: 'American Express',
    currency: 'USD',
  }),
  createAccountData({
    id: 'acc-savings-1',
    name: 'Savings',
    type: 'checking',
    institution: 'Ally',
    currency: 'USD',
  }),
  createAccountData({
    id: 'acc-eur-1',
    name: 'Euro Account',
    type: 'checking',
    institution: 'N26',
    currency: 'EUR',
  }),
];

export const inactiveAccount = createAccountData({
  id: 'acc-inactive-1',
  name: 'Old Account',
  type: 'checking',
  isActive: false,
});
