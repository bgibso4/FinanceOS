import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

import { SplitwiseImportCard } from '@/components/settings/import/splitwise-import-card';

const API = '/api/import/splitwise';
const FILE_NAME = 'trip-pair_2026-11-08_export.csv';
const EXPORT = [
  'Date,Description,Category,Cost,Currency,Me,Person A',
  '',
  '2026-10-10,Test Dinner,Dining out,51.00,USD,-25.50,25.50',
  '2026-10-11,Test Hotel,Hotel,90.00,USD,-45.00,45.00',
  '2026-10-12,Me paid Person A,Payment,100.00,USD,100.00,-100.00',
  '2026-10-13,Test Taxi,Taxi,20.00,USD,0.00,0.00',
  '',
  '2026-11-08,Total balance, , ,USD,29.50,-29.50',
].join('\n');

const tx = (id: string, merchant: string, amount: number, category: string | null) => ({
  id,
  date: '2026-10-10T00:00:00.000Z',
  merchant,
  amount,
  confidenceScore: 0.72,
  isTransfer: false,
  note: null,
  tags: [],
  category: category ? { id: `c-${id}`, name: category } : null,
  account: { id: 'a1', name: 'Test Splitwise', currency: 'USD' },
});

const RESULT = {
  importId: 'imp1',
  group: 'trip-pair',
  fileName: FILE_NAME,
  createdAt: new Date().toISOString(),
  firstImport: true,
  canUndo: true,
  counts: {
    new: 2,
    payments: 1,
    changed: 1,
    deleted: 1,
    unchanged: 3,
    skippedByDate: 0,
    others: 1,
    otherCurrency: 0,
    ignored: 2,
    needCategory: 1,
  },
  notes: [
    { transactionId: 't1', kind: 'new', cost: 51, category: 'Dining out' },
    { transactionId: 't2', kind: 'changed', was: -40, cost: 90, category: 'Hotel' },
    { transactionId: 't3', kind: 'payment', cost: 100, category: 'Payment' },
  ],
  transactions: [
    tx('t1', 'Test Dinner', -25.5, 'Test Restaurants'),
    tx('t2', 'Test Hotel', -45, 'Test Lodging'),
    tx('t3', 'Me paid Person A', 100, null),
  ],
  deleted: [
    {
      rowId: 'r9',
      date: '2026-10-09',
      description: 'Test Napa',
      amount: -53.5,
      category: 'Test Lodging',
      restored: false,
    },
  ],
  others: [{ date: '2026-10-13', description: 'Test Taxi', cost: 20 }],
  total: 29.5,
};

type Server = {
  known: boolean;
  postError: string | null;
  result: unknown;
  patchOk: boolean;
  /** When set, transaction saves wait for it. */
  patchGate?: Promise<void>;
  defaultAccountId: string | null;
  accounts: { id: string; name: string; isActive?: boolean; institution?: string | null }[];
};
let server: Server;
let calls: { url: string; method: string; body?: Record<string, unknown> }[];

function stub() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const reply = (data: unknown, status = 200) =>
        ({ ok: status < 400, status, json: async () => data }) as Response;
      if (url === API && method === 'GET')
        return reply({ accountId: server.defaultAccountId, person: 'Me', knownGroups: [] });
      if (url.startsWith(`${API}?`)) return reply({ known: server.known });
      if (url === API && method === 'POST')
        return server.postError ? reply({ error: server.postError }, 400) : reply(server.result);
      if (url === `${API}/imp1`) return reply(RESULT);
      if (url === `${API}/imp1/undo`) return reply({ success: true });
      if (url === `${API}/imp1/rows/r9/restore`)
        return reply({ ...RESULT, deleted: [{ ...RESULT.deleted[0], restored: true }] });
      if (url === '/api/transactions/bulk') return reply({ success: true });
      if (url.startsWith('/api/transactions/') && method === 'PATCH') {
        await server.patchGate;
        return server.patchOk ? reply({}) : reply({ error: 'Test save boom' }, 500);
      }
      if (url === '/api/accounts') return reply({ accounts: server.accounts });
      if (url === '/api/categories')
        return reply({ categories: [{ id: 'c-t1', name: 'Test Restaurants', type: 'expense' }] });
      if (url === '/api/tags') return reply({ tags: [] });
      if (url === '/api/settings') return reply({ settings: { baseCurrency: 'USD' } });
      if (url === '/api/travel/trips')
        return reply({ trips: [{ id: 'trip1', name: 'Test Trip', startDate: '2026-10-01' }] });
      return reply({});
    })
  );
}

beforeEach(() => {
  server = {
    known: false,
    postError: null,
    result: RESULT,
    patchOk: true,
    defaultAccountId: 'a1',
    accounts: [{ id: 'a1', name: 'Test Splitwise', isActive: true, institution: 'Splitwise' }],
  };
  stub();
  vi.stubGlobal('confirm', () => true);
});

/** The test export as a picked file; jsdom's File has no text(), which browsers all have. */
const exportFile = () =>
  Object.assign(new File([EXPORT], FILE_NAME, { type: 'text/csv' }), {
    text: async () => EXPORT,
  });

const posts = () => calls.filter((c) => c.method === 'POST');

/** Renders the card, waits for its defaults, and picks the test export. */
async function pickFile() {
  render(<SplitwiseImportCard />);
  await screen.findByDisplayValue('Me');
  await screen.findByRole('option', { name: 'Test Splitwise' });
  const file = exportFile();
  await userEvent.upload(screen.getByLabelText('Splitwise export file'), file);
}

async function imported() {
  server.known = true;
  await pickFile();
  await screen.findByText('Imported trip-pair');
}

describe('SplitwiseImportCard', () => {
  it('firstImportAsksThenImports', async () => {
    await pickFile();
    expect(await screen.findByText('First import of trip-pair')).toBeInTheDocument();
    expect(screen.getByText(/2 people · 4 rows/)).toBeInTheDocument();
    expect(calls.some((c) => c.url === `${API}?accountId=a1&group=trip-pair`)).toBe(true);
    expect(posts()).toHaveLength(0);

    await userEvent.click(screen.getByRole('radio', { name: 'Skip rows before' }));
    const cut = screen.getByLabelText('Skip rows dated before');
    await userEvent.clear(cut);
    await userEvent.type(cut, '2026-10-11');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Imported trip-pair')).toBeInTheDocument();
    expect(posts()[0]).toMatchObject({
      url: API,
      body: {
        accountId: 'a1',
        person: 'Me',
        fileName: FILE_NAME,
        text: EXPORT,
        skipBefore: '2026-10-11',
      },
    });
  });

  describe('intoListsActiveAccounts', () => {
    const OLD = { id: 'old', name: 'Test Old', isActive: false, institution: 'Splitwise' };
    const CHECKING = { id: 'a2', name: 'Test Checking', isActive: true, institution: 'Test Bank' };
    const SPLITWISE = {
      id: 'a1',
      name: 'Test Splitwise',
      isActive: true,
      institution: 'Splitwise',
    };
    const into = () => screen.getByLabelText('Into') as HTMLSelectElement;

    it('inactiveDefaultFallsBackToTheSplitwiseAccount', async () => {
      server.defaultAccountId = 'old';
      server.accounts = [OLD, CHECKING, SPLITWISE];
      render(<SplitwiseImportCard />);
      await screen.findByRole('option', { name: 'Test Checking' });

      expect(screen.queryByRole('option', { name: 'Test Old' })).not.toBeInTheDocument();
      await waitFor(() => expect(into().value).toBe('a1'));
    });

    it('inactiveDefaultWithoutASplitwiseAccountIsEmpty', async () => {
      server.defaultAccountId = 'old';
      server.accounts = [OLD, CHECKING];
      render(<SplitwiseImportCard />);
      await screen.findByRole('option', { name: 'Test Checking' });
      await screen.findByDisplayValue('Me');

      expect(into().value).toBe('');
    });
  });

  it('knownGroupImportsWithoutAsking', async () => {
    await imported();
    expect(screen.queryByText(/First import of/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).not.toHaveProperty('skipBefore');
    expect(screen.getByText(/into Test Splitwise · first import of this group/)).toBeVisible();
  });

  it('chipsMatchResult', async () => {
    await imported();
    for (const chip of [
      '2 new · 1 payment',
      '1 changed',
      '1 deleted',
      '3 unchanged',
      '2 deleted by you, ignored',
      '1 not yours',
      '1 need a category',
    ]) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
    expect(screen.queryByText(/skipped, typed by hand/)).not.toBeInTheDocument();

    const row = (merchant: string) => within(screen.getByText(merchant).closest('tr')!);
    expect(row('Test Dinner').getByText('New')).toBeInTheDocument();
    expect(row('Test Dinner').getByText('$51.00 total · Dining out in Splitwise')).toBeVisible();
    expect(row('Test Hotel').getByText('Changed in Splitwise')).toBeInTheDocument();
    expect(row('Test Hotel').getByText('-$40.00').tagName).toBe('S');
    expect(row('Me paid Person A').getByText('Payment')).toBeInTheDocument();
    expect(screen.getByText('Splitwise shows your balance in this group as')).toBeVisible();
    expect(screen.getByText('$29.50')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('Test Taxi')).toBeVisible();
  });

  it('flaggedNotesShowTheirCheckBadges', async () => {
    const flagged = {
      ...RESULT,
      notes: [
        {
          transactionId: 't1',
          kind: 'changed',
          was: -20,
          cost: 51,
          category: 'Dining out',
          flag: 'check-split',
        },
        { transactionId: 't2', kind: 'changed', cost: 90, category: '', flag: 'deleted-check' },
      ],
    };
    server.result = flagged;
    server.known = true;
    await pickFile();
    await screen.findByText('Imported trip-pair');
    const row = (merchant: string) => within(screen.getByText(merchant).closest('tr')!);
    expect(row('Test Dinner').getByText('Check the split')).toBeInTheDocument();
    expect(row('Test Dinner').queryByText('-$20.00')).not.toBeInTheDocument();
    expect(row('Test Hotel').getByText('Deleted in Splitwise · check')).toBeInTheDocument();
    expect(row('Test Hotel').queryByText('Changed in Splitwise')).not.toBeInTheDocument();
    expect(row('Test Hotel').getByText('$90.00 total')).toBeInTheDocument();
  });

  it('rowOpensSharedDrawer', async () => {
    await imported();
    await userEvent.click(screen.getByText('Test Dinner'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent(
      'Test Dinner'
    );
  });

  it('selectShowsBulkBar', async () => {
    await imported();
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByText('Test Dinner'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await screen.findByRole('option', { name: 'Test Trip' });
    await userEvent.selectOptions(screen.getByLabelText('Set trip'), 'trip1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply Trip' }));

    await waitFor(() => expect(calls.filter((c) => c.url === `${API}/imp1`)).toHaveLength(1));
    expect(posts().find((c) => c.url === '/api/transactions/bulk')?.body).toEqual({
      action: 'update',
      transactionIds: ['t1'],
      data: { tripId: 'trip1' },
    });
  });

  it('undoConfirmsInlineThenReverts', async () => {
    await imported();
    await userEvent.click(screen.getByRole('button', { name: 'Undo this import' }));
    expect(
      screen.getByText(
        'Undo removes the 2 transactions this import created, puts 1 changed row back to the old amount, and restores 1 deleted row. Edits you made to them are lost.'
      )
    ).toBeVisible();
    expect(posts().some((c) => c.url.endsWith('/undo'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText(/Undo removes/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Undo this import' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText('Import undone')).toBeInTheDocument();
    expect(posts().filter((c) => c.url === `${API}/imp1/undo`)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText('Import a Splitwise export')).toBeVisible();
  });

  /** Opens Test Dinner in the drawer and edits its amount, leaving the autosave pending. */
  async function editInDrawer() {
    await userEvent.click(screen.getByText('Test Dinner'));
    const amount = within(await screen.findByRole('dialog')).getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-20');
  }

  const patchIndex = () => calls.findIndex((c) => c.method === 'PATCH');

  it('importAnotherFileSavesThePendingDrawerEditFirst', async () => {
    await imported();
    await editInDrawer();
    expect(patchIndex()).toBe(-1);
    await userEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(await screen.findByText('Export file')).toBeVisible();
    expect(patchIndex()).toBeGreaterThan(-1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('undoSavesThePendingDrawerEditBeforeUndoing', async () => {
    await imported();
    await userEvent.click(screen.getByRole('button', { name: 'Undo this import' }));
    await editInDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText('Import undone')).toBeInTheDocument();
    const undoIndex = calls.findIndex((c) => c.url === `${API}/imp1/undo`);
    expect(patchIndex()).toBeGreaterThan(-1);
    expect(patchIndex()).toBeLessThan(undoIndex);
  });

  it('undoIgnoresASecondClickWhileTheDrawerSaves', async () => {
    let release!: () => void;
    server.patchGate = new Promise((resolve) => (release = resolve));
    await imported();
    await userEvent.click(screen.getByRole('button', { name: 'Undo this import' }));
    await editInDrawer();
    const undoButton = screen.getByRole('button', { name: 'Undo import' });
    await userEvent.click(undoButton);
    await waitFor(() => expect(patchIndex()).toBeGreaterThan(-1));
    expect(undoButton).toBeDisabled();
    await userEvent.click(undoButton);

    release();

    expect(await screen.findByText('Import undone')).toBeInTheDocument();
    expect(posts().filter((c) => c.url === `${API}/imp1/undo`)).toHaveLength(1);
  });

  it('aFailedDrawerSaveKeepsTheResultAndDoesNotUndo', async () => {
    server.patchOk = false;
    await imported();
    await userEvent.click(screen.getByRole('button', { name: 'Undo this import' }));
    await editInDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(screen.getByText('Imported trip-pair')).toBeVisible();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(calls.some((c) => c.url === `${API}/imp1/undo`)).toBe(false);
  });

  it('restoreCallsRoute', async () => {
    await imported();
    expect(screen.getByText('Deleted in Splitwise, so removed here')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Restored')).toBeInTheDocument();
    expect(posts().filter((c) => c.url === `${API}/imp1/rows/r9/restore`)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('errorMessageShown', async () => {
    server.known = true;
    server.postError = 'No column named "Me" in this export. The people in it are: Person A.';
    await pickFile();
    expect(await screen.findByRole('alert')).toHaveTextContent(server.postError);
    expect(screen.getByText('Import a Splitwise export')).toBeVisible();
  });

  it('firstImportShowsTheReadersErrorForAWrongName', async () => {
    render(<SplitwiseImportCard />);
    const name = await screen.findByDisplayValue('Me');
    await userEvent.clear(name);
    await userEvent.type(name, 'Nobody');
    const file = exportFile();
    await userEvent.upload(screen.getByLabelText('Splitwise export file'), file);
    expect(
      await screen.findByText(
        'No column named "Nobody" in this export. The people in it are: Me, Person A.'
      )
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});
