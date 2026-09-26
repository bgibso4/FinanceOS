"""Venmo cleanup, Nov 2025 -> now. Dry-run by default; pass --apply to commit.

Everything runs in one SQLite transaction; any failed assertion rolls it all back.
"""
import sqlite3, sys, uuid, time, datetime as dt

APPLY = '--apply' in sys.argv
DB = '/Users/ben/projects/FinanceOS/prisma/dev.db'
NOW_MS = int(time.time() * 1000)
NOV1 = int(dt.datetime(2025, 11, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
ACTUAL_BALANCE = 145.00

con = sqlite3.connect(DB, isolation_level=None)
con.row_factory = sqlite3.Row
con.execute('PRAGMA foreign_keys = ON')
q = lambda sql, *a: con.execute(sql, a).fetchall()
log = []

def one(sql, *a):
    r = q(sql, *a)
    assert len(r) == 1, f'expected 1 row, got {len(r)}: {sql} {a}'
    return r[0]

acct = {n: one('select id from Account where name=?', n)['id']
        for n in ['Personal Profile', 'Checking', 'Venmo', 'Freedom Unlimited']}
V, C, L = acct['Personal Profile'], acct['Checking'], acct['Venmo']

_cats = {}
def cat(name):
    if name not in _cats:
        _cats[name] = one('select id from Category where name=?', name)['id']
    return _cats[name]

def day(d):  # rows are stored at UTC midnight-ish; match on the UTC calendar day
    return "date(t.date/1000,'unixepoch') = ?", d

def tx(account, d, amount, merchant_prefix=''):
    return one(f'''select t.* from "Transaction" t where t.accountId=? and date(t.date/1000,'unixepoch')=?
                   and abs(t.amount - ?) < 0.005 and t.merchant like ?''',
               account, d, amount, merchant_prefix + '%')

def upd(row, **f):
    sets = ', '.join(f'"{k}"=?' for k in f)
    con.execute(f'update "Transaction" set {sets} where id=?', (*f.values(), row['id']))

def insert(**f):
    base = dict(id=str(uuid.uuid4()), tags='[]', note=None, isTransfer=0, transferGroupId=None,
                confidenceScore=1.0, externalId=None, importHash=None, isOffset=0,
                linkedTransactionId=None, isSplitParent=0, parentTransactionId=None,
                categoryId=None, createdAt=NOW_MS)
    base.update(f)
    cols = ', '.join(f'"{k}"' for k in base)
    con.execute(f'insert into "Transaction" ({cols}) values ({",".join("?" * len(base))})',
                tuple(base.values()))
    return base['id']

def venmo_sum_since_nov():
    return round(q('select coalesce(sum(amount),0) s from "Transaction" where accountId=? and date>=? and isSplitParent=0', V, NOV1)[0]['s'], 2)

con.execute('BEGIN')
try:
    # --- 1. October partial month
    for d, a, m in [('2025-10-11', -140, 'Anthony Fekete'), ('2025-10-17', -74, 'Somsubhro'),
                    ('2025-10-20', -436, 'Amir'), ('2025-10-28', 14.65, 'Shan Lu')]:
        con.execute('delete from "Transaction" where id=?', (tx(V, d, a, m)['id'],))
    log.append('1. deleted 4 October Venmo rows')

    # Every Venmo person-payment is real money: clear Plaid's/detector's transfer flags first.
    con.execute('''update "Transaction" set isTransfer=0, transferGroupId=null
                   where accountId=? and merchant not like 'Standard transfer%' ''', (V,))

    # --- 2. Bank-funded payments: (V date, amount, V merchant prefix, C date, category, note)
    bank_funded = [
        ('2026-01-13', -100, 'Adrian Fekete "Dinner past', '2026-01-14', None, None),
        ('2026-01-20', -1280, 'Adrian Fekete "Whis', '2026-01-21', None, None),
        ('2026-01-31', -165, 'Anthony Fekete "Bills', '2026-02-02', None, None),
        ('2026-01-31', -65, 'Ron Shimo', '2026-02-02', None, None),
        ('2026-02-05', -79, 'Somsubhro', '2026-02-06', None, None),
        ('2026-02-12', -100, 'Billy Wagner', '2026-02-13', None, None),
        ('2026-02-21', -47, 'David Nisenbaum', '2026-02-23', None, None),
        ('2026-02-28', -1045.88, 'Amir', '2026-03-02', None, None),
        ('2026-03-11', -75, 'Ron Shimo', '2026-03-12', None, None),
        ('2026-04-06', -75, 'Ron Shimo', '2026-04-07', None, None),
        ('2026-04-11', -90, 'Anthony Fekete "Golf', '2026-04-11', None, None),
        ('2026-04-11', -15, 'Adrian Fekete "Golf uber', '2026-04-11', None, None),
        ('2026-05-03', -129, 'Billy Wagner', '2026-05-04', None, None),
        ('2026-05-04', -130, 'Anthony Fekete', '2026-05-05', None, None),
        ('2026-05-30', -123, 'Anthony Fekete', '2026-06-01', None, None),
        ('2026-06-01', -192, 'Anthony Fekete', '2026-06-02', None, None),
        ('2026-06-13', -55, 'Ron Shimo', '2026-06-15', None, None),
        ('2026-07-13', -55, 'Ron Shimo', '2026-07-14', None, None),
        ('2026-07-31', -158, 'Somsubhro', '2026-08-03', '🍽️ Restaurants', None),
        ('2026-08-12', -260, 'Adrian Fekete "Submercer', '2026-08-13', '🍻 Alcohol & Bars', 'Submercer (Adrian)'),
        ('2026-08-15', -25, 'Salt Air', '2026-08-17', '🛒 Groceries', 'Salt Air Farm - Honey'),
        ('2026-09-19', -1931, 'Anthony Fekete "Miami', '2026-09-21', None, None),
    ]
    topups = 0.0
    for vd, a, vm, cd, catname, note in bank_funded:
        v = tx(V, vd, a, vm)
        c = tx(C, cd, a, 'venmo')  # LIKE is case-insensitive: matches VENMO and Venmo
        category_id = cat(catname) if catname else c['categoryId']
        assert category_id, f'no category for {vd} {a}'
        upd(v, categoryId=category_id, note=note or c['note'] or v['note'], isTransfer=0,
            transferGroupId=None, confidenceScore=1.0)
        g = str(uuid.uuid4())
        upd(c, isTransfer=1, transferGroupId=g, categoryId=None)
        insert(date=v['date'], amount=-a, accountId=V, merchant='Top-up from Checking',
               merchantNormalized='top-up from checking', isTransfer=1, transferGroupId=g,
               note='Venmo pulled this payment from Checking')
        topups += -a
    assert round(topups, 2) == 6194.88, topups
    log.append(f'2. 22 bank-funded pairs: Venmo categorized, Checking -> transfer, +{topups:.2f} top-ups added')

    # --- 3 & 4. Venmo-balance payments and incoming payments: (date, amount, merchant prefix, category, note)
    D_AND_F = '🍴Drinks and Food'  # Travel
    rest = [
        ('2026-04-20', -35, 'Tea karlsson', '🎁 Gifts', 'Smaka Bakery'),
        ('2026-04-30', -130, 'Nadia', '❗️Stuff I forgot to budget for', None),
        ('2026-05-05', -75, 'Ron Shimo', '💆 Personal Care', None),
        ('2026-05-18', -100, 'Adrian Fekete "Golf', '⛳️ Green Fees', None),
        ('2026-06-06', -20, 'Billy Wagner "Dranks', '🍻 Alcohol & Bars', None),
        ('2026-06-06', -20, 'Adrian Fekete "Dranks', '🍻 Alcohol & Bars', None),
        ('2026-06-06', -20, 'Anthony Fekete "Dranks', '🍻 Alcohol & Bars', None),
        ('2026-08-09', -165.72, 'Amelia Xu', '🍽️ Restaurants', 'Orieana Squad Dinner'),
        ('2026-08-31', -55, 'Ron Shimo', '💆 Personal Care', None),
        ('2025-12-15', 50, 'Daniela', '👖 Clothing & Shoes', None),
        ('2025-12-29', 30, 'Adrian Fekete "Ride', '🚙 Rideshare (Uber/Lyft/etc.)', None),
        ('2026-01-06', 70, 'Anthony Fekete "Fantasy', '❗️Stuff I forgot to budget for', "Anth's fantasy payment"),
        ('2026-01-18', 30, 'Kait Clark', D_AND_F, 'Brewhouse payback'),
        ('2026-01-18', 72, 'Billy Wagner', D_AND_F, 'Brewhouse payback'),
        ('2026-01-18', 72, 'Adrian Fekete', D_AND_F, 'Brewhouse payback'),
        ('2026-04-10', 70, 'Fernando', '🍽️ Restaurants', 'Team payback for din'),
        ('2026-04-10', 70, 'Somsubhro', '🍽️ Restaurants', 'Team payback for din'),
        ('2026-04-10', 70, 'Shan Lu', '🍽️ Restaurants', 'Team payback for din'),
        ('2026-04-11', 70, 'Jay Park', '🍽️ Restaurants', 'Team payback for din'),
        ('2026-04-11', 70, 'Luka', '🍽️ Restaurants', 'Team payback for din'),
        ('2026-05-15', 125, 'Sarah Zugelder', '🍿 Entertainment', 'Dom Dolla Tickets'),
        ('2026-06-06', 45, 'Nick Hartley', '🍻 Alcohol & Bars', None),
        ('2026-06-06', 45, 'Ron Sun', '🍻 Alcohol & Bars', None),
        ('2026-06-06', 110, 'Adrian Fekete', '🍻 Alcohol & Bars', None),
        ('2026-06-06', 115, 'Anthony Fekete', '🍻 Alcohol & Bars', None),
        ('2026-06-06', 115, 'Billy Wagner', '🍻 Alcohol & Bars', None),
        ('2026-08-07', 70, 'Lorenzo', '🍽️ Restaurants', 'Printemps'),
        ('2026-08-07', 130, 'Adrian Fekete', '🍽️ Restaurants', 'Printemps'),
        ('2026-08-07', 130, 'Anthony Fekete', '🍽️ Restaurants', 'Printemps'),
        ('2026-08-07', 130, 'Billy Wagner', '🍽️ Restaurants', 'Printemps'),
        ('2026-08-28', 150, 'Rebecca Walden', '🛍️ General Shopping', None),
        ('2026-08-29', 140, 'Anthony Fekete', '🍽️ Restaurants', None),
        ('2026-08-30', 72, 'Anthony Fekete', '🍽️ Restaurants', None),
        ('2026-09-01', 35, 'Jai Bhatia', '🍻 Alcohol & Bars', None),
        ('2026-09-01', 35, 'Shan Lu', '🍻 Alcohol & Bars', None),
        ('2026-09-02', 35, 'Fernando', '🍻 Alcohol & Bars', None),
        ('2026-09-08', 35, 'Somsubhro', '🍻 Alcohol & Bars', None),
        ('2026-09-14', 150, 'Bhavy', D_AND_F, None),
        ('2026-09-19', 145, 'Anthony Fekete "Toronto', D_AND_F, 'Split pending: car + din'),
    ]
    for d, a, m, catname, note in rest:
        v = tx(V, d, a, m)
        upd(v, categoryId=cat(catname), note=note or v['note'], isTransfer=0, transferGroupId=None,
            confidenceScore=1.0)
    log.append(f'3/4. {len(rest)} Venmo-balance + incoming rows categorized')

    # --- 5. Cash-outs: Venmo "Standard transfer" <-> Checking deposit
    for vd, a, cd in [('2025-12-27', 120.65, '2025-12-29'), ('2026-01-06', 100, '2026-01-07'),
                      ('2026-01-20', 174, '2026-01-21'), ('2026-06-06', 400, '2026-06-08'),
                      ('2026-08-09', 294.28, '2026-08-10'), ('2026-09-02', 377, '2026-09-03'),
                      ('2026-09-19', 220, '2026-09-21')]:
        v = tx(V, vd, -a, 'Standard transfer')
        c = tx(C, cd, a, '')
        assert 'venmo' in c['merchant'].lower(), c['merchant']
        g = v['transferGroupId'] if v['transferGroupId'] and v['transferGroupId'] == c['transferGroupId'] else str(uuid.uuid4())
        upd(v, isTransfer=1, transferGroupId=g, categoryId=None)
        upd(c, isTransfer=1, transferGroupId=g, categoryId=None)
    log.append('5. 7 cash-outs linked as transfers')

    # --- 6. Hand-entered Checking +350 stand-in
    c350 = tx(C, '2026-04-10', 350, '')
    assert c350['note'] == 'Team Payback for Din' and c350['externalId'] is None
    con.execute('delete from "Transaction" where id=?', (c350['id'],))
    log.append('6. deleted Checking +350 stand-in')

    # --- 7. Legacy account
    n = con.execute('delete from "Transaction" where accountId=?', (L,)).rowcount
    assert n == 9, n
    con.execute('update Account set isActive=0 where id=?', (L,))
    log.append('7. deleted 9 legacy rows, legacy account inactive')

    # --- 8. CVS false transfer
    cvs = tx(acct['Freedom Unlimited'], '2026-09-03', -34.99, 'CVS')
    upd(cvs, isTransfer=0, transferGroupId=None)
    log.append('8. CVS -34.99 un-flagged')

    # --- 9. Opening balance
    s = venmo_sum_since_nov()
    assert s == 179.35, s
    adj = round(ACTUAL_BALANCE - s, 2)
    insert(date=NOV1, amount=adj, accountId=V, merchant='Balance Adjustment',
           merchantNormalized='balance adjustment', categoryId=cat('Balance Adjustment'), isTransfer=1,
           note='Opening balance so Venmo matches the real $145 on 2026-09-26')
    log.append(f'9. opening balance adjustment {adj:+.2f}')

    # --- Verification
    final = round(q('select sum(amount) s from "Transaction" where accountId=? and isSplitParent=0', V)[0]['s'], 2)
    assert final == ACTUAL_BALANCE, final
    dup = q('''select count(*) n from "Transaction" v join "Transaction" c
               on c.accountId=? and abs(c.amount - v.amount) < 0.005 and abs(c.date - v.date) <= 4*86400000
               where v.accountId=? and v.isTransfer=0 and c.isTransfer=0 and c.merchant like '%venmo%' and v.date>=?''', C, V, NOV1)[0]['n']
    assert dup == 0, f'{dup} Venmo payments still counted in Checking too'
    unc = q('select count(*) n from "Transaction" where accountId=? and isTransfer=0 and categoryId is null', V)[0]['n']
    assert unc == 0, f'{unc} uncategorized Venmo rows'
    bad = q('''select count(*) n from "Transaction" where transferGroupId is not null and isTransfer=1
               and transferGroupId in (select transferGroupId from "Transaction" group by transferGroupId having count(*)<>2)''')[0]['n']
    log.append(f'verify: Venmo balance {final:.2f}; 0 double-counted; 0 uncategorized; {bad} rows in non-pair transfer groups (pre-existing, informational)')

    if APPLY:
        con.execute('COMMIT'); log.append('COMMITTED')
    else:
        con.execute('ROLLBACK'); log.append('DRY RUN — rolled back, nothing changed')
except Exception:
    con.execute('ROLLBACK')
    print('\n'.join(log)); print('FAILED — rolled back'); raise
print('\n'.join(log))
