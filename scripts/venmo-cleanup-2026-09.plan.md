# Venmo cleanup plan — Nov 1 2025 → Sep 26 2026 (PROPOSED, not applied)

Accounts: **V** = Venmo "Personal Profile" (Plaid), **C** = Chase "Checking", **L** = legacy hand-entered "Venmo".
Model: Venmo rows are the real income/expense. Every Checking "Venmo" row is a transfer.
A database backup is taken before any change.

## 1. Delete — October partial month (4 V rows)

2025-10-11 -140.00 Anthony "🏈" · 2025-10-17 -74.00 Somsubhro "Team HH" · 2025-10-20 -436.00 Amir "Davey send" · 2025-10-28 +14.65 Shan Lu "beer hall"

## 2. Bank-funded payments (22 pairs)

V payment → real expense, category + note from C twin (or L). C row → transfer, category cleared.
New V row "Top-up from Checking" +X on the V date, transfer, linked to the C row.

| V date     | Amount   | V payment                          | Category (source)         | Note                                       |
| ---------- | -------- | ---------------------------------- | ------------------------- | ------------------------------------------ |
| 2026-01-13 | -100.00  | Adrian "Dinner past two Saturdays" | 🍴Food and Drinks (C)     | Dinner for a couple Saturday Vibe sessions |
| 2026-01-20 | -1280.00 | Adrian "Whis"                      | 🏘️ Lodging (C)            | This is also LongHorns tables and Car…     |
| 2026-01-31 | -165.00  | Anthony "Bills"                    | 🍴Drinks and Food (C)     | Whistelr Buffalo Bills                     |
| 2026-01-31 | -65.00   | Ron Shimo "Haircut"                | 💆 Personal Care (C)      | Haircut                                    |
| 2026-02-05 | -79.00   | Somsubhro "Korean BBQ"             | 🍽️ Restaurants (C)        | Team K-BBQ                                 |
| 2026-02-12 | -100.00  | Billy "Din"                        | 🍴Drinks and Food (C)     | Paying Bill for food                       |
| 2026-02-21 | -47.00   | David Nisenbaum "Brunch"           | 🍽️ Restaurants (C)        | Brunch                                     |
| 2026-02-28 | -1045.88 | Amir "Costa"                       | 🗿 Other (C)              |                                            |
| 2026-03-11 | -75.00   | Ron Shimo "Haircut"                | 💆 Personal Care (C)      |                                            |
| 2026-04-06 | -75.00   | Ron Shimo "Haircut"                | 💆 Personal Care (C)      |                                            |
| 2026-04-11 | -90.00   | Anthony "Golf"                     | ⛳️ Green Fees (C)         | Silver Lake                                |
| 2026-04-11 | -15.00   | Adrian "Golf uber"                 | 🚙 Rideshare (C)          | Golf Uber                                  |
| 2026-05-03 | -129.00  | Billy "Din"                        | 🍽️ Restaurants (C)        | Squad dinner                               |
| 2026-05-04 | -130.00  | Anthony "Adrian's b day din"       | 🍽️ Restaurants (C)        | Adge B-Day din                             |
| 2026-05-30 | -123.00  | Anthony "Dinner before bottles"    | 🍽️ Restaurants (C)        | Dinner before bottles - Anth               |
| 2026-06-01 | -192.00  | Anthony "Golf tourney"             | 🏆 Tournament (C)         | Amazon Golf Tourny                         |
| 2026-06-13 | -55.00   | Ron Shimo "Haircut"                | 💆 Personal Care (C)      | Haircut                                    |
| 2026-07-13 | -55.00   | Ron Shimo "Haircut"                | 💆 Personal Care (C)      | Haircut                                    |
| 2026-07-31 | -158.00  | Somsubhro "Hh dinner"              | 🍽️ Restaurants (proposed) |                                            |
| 2026-08-12 | -260.00  | Adrian "Submercer"                 | 🍻 Alcohol & Bars (L)     | Submercer (Adrian)                         |
| 2026-08-15 | -25.00   | Salt Air Farm & Table              | 🛒 Groceries (L)          | Salt Air Farm - Honey                      |
| 2026-09-19 | -1931.00 | Anthony "Miami"                    | 🗿 Other (C)              |                                            |

## 3. Paid from Venmo balance (9 V rows) → real expense

| Date       | Amount    | Row                                      | Category (source)                                                 |
| ---------- | --------- | ---------------------------------------- | ----------------------------------------------------------------- |
| 2026-04-20 | -35.00    | Tea karlsson "3" OG Vanilla"             | 🎁 Gifts (L, note "Smaka Bakery"), un-flag transfer               |
| 2026-04-30 | -130.00   | Nadia "Meg in Miami"                     | ❗️Stuff I forgot to budget for (L), un-flag transfer              |
| 2026-05-05 | -75.00    | Ron Shimo "Haircut"                      | 💆 Personal Care                                                  |
| 2026-05-18 | -100.00   | Adrian "Golf"                            | ⛳️ Green Fees                                                     |
| 2026-06-06 | -20.00 ×3 | Billy / Adrian / Anthony "Dranks refund" | 🍻 Alcohol & Bars                                                 |
| 2026-08-09 | -165.72   | Amelia Xu "Oriana 🍸"                    | 🍽️ Restaurants (L, note "Orieana Squad Dinner"), un-flag transfer |
| 2026-08-31 | -55.00    | Ron Shimo "Haircut"                      | 💆 Personal Care                                                  |

## 4. Incoming payments (30 V rows) → reimbursement in the matching expense category

| Date             | Amount                         | Row                                         | Category (source)                                                   |
| ---------------- | ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------- |
| 2025-12-15       | +50.00                         | Daniela "Boots"                             | 👖 Clothing & Shoes (C note: "half was Ski Boots")                  |
| 2025-12-29       | +30.00                         | Adrian "Ride from airport"                  | 🚙 Rideshare                                                        |
| 2026-01-06       | +70.00                         | Anthony "Fantasy"                           | ❗️Stuff I forgot to budget for (C: "Mostly Anth's fantasy payment") |
| 2026-01-18       | +30 / +72 / +72                | Kait, Billy, Adrian dinner                  | 🍴Drinks and Food, Travel (C: "Brewhouse Payback" = 174)            |
| 2026-04-10/11    | +70 ×5                         | Fernando, Somsubhro, Shan, Jay, Luka        | 🍽️ Restaurants (C: "Team Payback for Din")                          |
| 2026-05-15       | +125.00                        | Sarah "Daddy Dom"                           | 🍿 Entertainment (L, note "Dom Dolla Tickets")                      |
| 2026-06-06       | +45 / +45 / +110 / +115 / +115 | Nick, Ron Sun, Adrian, Anthony, Billy       | 🍻 Alcohol & Bars (C cash-out +400)                                 |
| 2026-08-07       | +70 / +130 ×3                  | Lorenzo, Adrian, Anthony, Billy             | 🍽️ Restaurants (L "Printemps" +460)                                 |
| 2026-08-28       | +150.00                        | Rebecca Walden "Bag"                        | 🛍️ General Shopping ❓                                              |
| 2026-08-29       | +140.00                        | Anthony "Din with Zouks"                    | 🍽️ Restaurants                                                      |
| 2026-08-30       | +72.00                         | Anthony "Big d"                             | 🍽️ Restaurants ❓                                                   |
| 2026-09-01/02/08 | +35 ×4                         | Jai, Shan, Fernando, Somsubhro "Happy hour" | 🍻 Alcohol & Bars (Fernando: un-flag, unlink from CVS)              |
| 2026-09-14       | +150.00                        | Bhavy "Toronto Din"                         | 🍴Drinks and Food, Travel, un-flag transfer                         |
| 2026-09-19       | +145.00                        | Anthony "Toronto (car + din)"               | 🍴Drinks and Food, Travel ❓, un-flag transfer                      |

## 5. Cash-outs (7 pairs) → transfers, linked, C categories cleared

2025-12-27 120.65 · 2026-01-06 100.00 · 2026-01-20 174.00 · 2026-06-06 400.00 · 2026-08-09 294.28 (linked) · 2026-09-02 377.00 (linked) · 2026-09-19 220.00 (linked)

## 6. Delete Checking +350.00 (2026-04-10, "Team Payback for Din")

Hand-entered stand-in for the five +70 rows. Lowers the Checking balance by 350.

## 7. Legacy "Venmo" account

Delete all 9 rows; set account inactive.

## 8. Unrelated false transfer

Freedom Unlimited 2026-09-03 CVS -34.99: un-flag transfer, remove from Fernando's group.

## 9. Opening balance

V rows Nov 1 → today after the above = +179.35; actual = 145.00.
Add V "Balance Adjustment" -34.35 on 2025-11-01 (category Balance Adjustment, transfer).

## Follow-ups (code, not in this change)

- Auto-create "Top-up from Checking" + mark Checking "Venmo" rows as transfers on future syncs.
- Keyword matching is substring-based ("aldi" matches "Valdivia" → Groceries).
- Transfer detection paired a +35.00 Venmo receipt with a -34.99 CVS charge.
