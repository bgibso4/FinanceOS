const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const checking = await prisma.account.create({
    data: { name: "Checking", type: "checking", institution: "Local Bank" }
  });
  const credit = await prisma.account.create({
    data: { name: "Credit Card", type: "credit", institution: "Bank" }
  });

  const income = await prisma.category.create({ data: { name: "Income", type: "income" } });
  const groceries = await prisma.category.create({ data: { name: "Groceries", type: "expense" } });
  const transport = await prisma.category.create({ data: { name: "Transport", type: "expense" } });
  const shopping = await prisma.category.create({ data: { name: "Shopping", type: "expense" } });

  await prisma.rule.create({
    data: {
      matchType: "merchantContains",
      matchValue: "trader",
      categoryId: groceries.id,
      priority: 10
    }
  });

  const txData = [
    { merchant: "Payroll ACME", amount: 4200, categoryId: income.id, accountId: checking.id, note: "May paycheck" },
    { merchant: "Trader Joes", amount: -160, categoryId: groceries.id, accountId: checking.id },
    { merchant: "Safeway", amount: -120, categoryId: groceries.id, accountId: credit.id },
    { merchant: "Uber", amount: -48, categoryId: transport.id, accountId: credit.id },
    { merchant: "Amazon", amount: -230, categoryId: shopping.id, accountId: credit.id }
  ];

  for (let i = 0; i < txData.length; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i * 3);
    
    const merchant = txData[i].merchant;
    const merchantNormalized = merchant.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    
    await prisma.transaction.create({
      data: {
        date,
        merchant,
        merchantNormalized,
        amount: txData[i].amount,
        accountId: txData[i].accountId,
        categoryId: txData[i].categoryId,
        tags: "[]",
        note: txData[i].note ?? null,
        confidenceScore: 0.9
      }
    });
  }

  console.log("Seed data loaded");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
