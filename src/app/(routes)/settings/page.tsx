"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { ds } from "@/lib/design-system";
import { getCurrencyFlag } from "@/lib/currency";

type Account = { id: string; name: string; type: string; institution?: string | null; isActive?: boolean; currency?: string };
type AccountBalance = { id: string; balance: number };
type Category = { id: string; name: string; type: string; parentId?: string | null };
type Rule = { id: string; matchType: string; matchValue: string; priority: number; isEnabled: boolean; categoryId: string };
type Snapshot = { id: string; month: string; incomeTotal: number; spendingTotal: number; savingsRatePct: number };
type Budget = { id: string; month: string; categoryId: string; limitAmount: number; category?: Category; isOverride?: boolean };
type ExchangeRate = { id: string; fromCurrency: string; toCurrency: string; rate: number; updatedAt: string };
type UserSettings = { id: string; baseCurrency: string };

// Strip emojis for sorting purposes
const stripEmojis = (str: string) => str.replace(/[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '').trim();

const sortByName = (a: { name: string }, b: { name: string }) => 
  stripEmojis(a.name).localeCompare(stripEmojis(b.name));

// Format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'general';
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBalances, setAccountBalances] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [defaultBudgets, setDefaultBudgets] = useState<Budget[]>([]);
  const [budgetViewMonth, setBudgetViewMonth] = useState<string>(""); // empty = "All months" (defaults)
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [newExchangeRate, setNewExchangeRate] = useState({ fromCurrency: "CAD", toCurrency: "USD", rate: "" });
  
  // Monthly report state
  const [reportMonth, setReportMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [reportData, setReportData] = useState<any>(null);
  const [trailing12Months, setTrailing12Months] = useState<any[]>([]);
  const [trailing12EndMonth, setTrailing12EndMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [backfillForm, setBackfillForm] = useState({ year: '2024', month: '01', income: '', spending: '' });

  const [newAccount, setNewAccount] = useState({ name: "", type: "checking", institution: "", currency: "USD" });
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [modalAccount, setModalAccount] = useState<Account | null>(null);
  const [accountTransactionCount, setAccountTransactionCount] = useState(0);
  const [modalAccountBalance, setModalAccountBalance] = useState(0);
  const [reconcileTarget, setReconcileTarget] = useState("");
  const [newCategory, setNewCategory] = useState({ name: "", type: "expense", parentId: "" });
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newGroup, setNewGroup] = useState({ name: "", type: "expense" });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCategory, setModalCategory] = useState<Category | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<any[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [modalRule, setModalRule] = useState<Rule | null>(null);
  const [newRule, setNewRule] = useState({ matchType: "merchantContains", matchValue: "", categoryId: "", priority: 100 });
  const [budgetForm, setBudgetForm] = useState({ categoryId: "", limitAmount: "" });
  const [showArchived, setShowArchived] = useState(false);
  const [importState, setImportState] = useState({
    accountId: "",
    csvText: "",
    columns: [] as string[],
    mapping: { date: "", amount: "", merchant: "", note: "" },
    invertAmounts: false,
    status: "",
    summary: null as any
  });

  useEffect(() => {
    refresh();
  }, []);

  // Fetch budgets based on view mode
  useEffect(() => {
    const fetchBudgets = async () => {
      // Always fetch defaults
      const defaultsRes = await fetch("/api/budgets/defaults");
      const defaultsData = await defaultsRes.json();
      setDefaultBudgets(defaultsData.budgets ?? []);
      
      if (budgetViewMonth) {
        // Viewing a specific month - fetch merged budgets
        const monthRes = await fetch(`/api/budgets/${budgetViewMonth}`);
        const monthData = await monthRes.json();
        setBudgets(monthData.budgets ?? []);
      } else {
        // Viewing "All months" - show defaults
        setBudgets(defaultsData.budgets ?? []);
      }
    };
    fetchBudgets();
  }, [budgetViewMonth]);

  const refresh = async () => {
    const [acc, cat, r, rep, bal, rates, settings] = await Promise.all([
      fetch("/api/accounts").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/rules").then((r) => r.json()),
      fetch("/api/reports/monthly").then((r) => r.json()),
      fetch("/api/accounts/balances").then((r) => r.json()),
      fetch("/api/exchange-rates").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json())
    ]);
    setAccounts(acc.accounts ?? []);
    setCategories(cat.categories ?? []);
    setRules(r.rules ?? []);
    setSnapshots(rep.snapshots ?? []);
    setExchangeRates(rates.rates ?? []);
    setUserSettings(settings.settings ?? null);
    
    // Build balance map
    const balanceMap = new Map<string, number>();
    (bal.accounts ?? []).forEach((a: AccountBalance) => {
      balanceMap.set(a.id, a.balance);
    });
    setAccountBalances(balanceMap);
    
    // Refresh budgets based on current view
    const defaultsRes = await fetch("/api/budgets/defaults");
    const defaultsData = await defaultsRes.json();
    setDefaultBudgets(defaultsData.budgets ?? []);
    
    if (budgetViewMonth) {
      const monthRes = await fetch(`/api/budgets/${budgetViewMonth}`);
      const monthData = await monthRes.json();
      setBudgets(monthData.budgets ?? []);
    } else {
      setBudgets(defaultsData.budgets ?? []);
    }
  };

  const createAccount = async () => {
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAccount)
    });
    setNewAccount({ name: "", type: "checking", institution: "", currency: "USD" });
    refresh();
  };

  const openAccountModal = async (account: Account) => {
    setModalAccount(account);
    setAccountModalOpen(true);
    setReconcileTarget("");
    
    // Get transaction count and balance for this account
    try {
      const response = await fetch(`/api/transactions?account=${account.id}`);
      const data = await response.json();
      setAccountTransactionCount(data.transactions?.length || 0);
      
      // Calculate balance from transactions
      const balance = (data.transactions || []).reduce((sum: number, tx: any) => sum + tx.amount, 0);
      setModalAccountBalance(balance);
    } catch (error) {
      setAccountTransactionCount(0);
      setModalAccountBalance(0);
    }
  };

  const closeAccountModal = () => {
    setAccountModalOpen(false);
    setModalAccount(null);
    setAccountTransactionCount(0);
    setModalAccountBalance(0);
    setReconcileTarget("");
  };

  const updateModalAccount = async () => {
    if (!modalAccount) return;
    await fetch(`/api/accounts/${modalAccount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: modalAccount.name,
        type: modalAccount.type,
        institution: modalAccount.institution,
        currency: modalAccount.currency
      })
    });
    closeAccountModal();
    refresh();
  };

  const deleteAccount = async () => {
    if (!modalAccount) return;
    
    try {
      const response = await fetch(`/api/accounts/${modalAccount.id}`, {
        method: "DELETE"
      });
      
      if (!response.ok) {
        const error = await response.json();
        alert(error.error || "Failed to delete account");
        return;
      }
      
      closeAccountModal();
      refresh();
    } catch (error) {
      alert("Failed to delete account");
    }
  };

  const archiveAccount = async () => {
    if (!modalAccount) return;
    try {
      const response = await fetch(`/api/accounts/${modalAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false })
      });
      
      if (!response.ok) {
        alert("Failed to archive account");
        return;
      }
      
      closeAccountModal();
      refresh();
    } catch (error) {
      alert("Failed to archive account");
    }
  };

  const restoreAccount = async () => {
    if (!modalAccount) return;
    try {
      const response = await fetch(`/api/accounts/${modalAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true })
      });
      
      if (!response.ok) {
        alert("Failed to restore account");
        return;
      }
      
      closeAccountModal();
      refresh();
    } catch (error) {
      alert("Failed to restore account");
    }
  };

  const reconcileBalance = async () => {
    if (!modalAccount || !reconcileTarget) return;
    
    const targetBalance = parseFloat(reconcileTarget);
    if (isNaN(targetBalance)) {
      alert("Please enter a valid number");
      return;
    }
    
    const difference = targetBalance - modalAccountBalance;
    if (Math.abs(difference) < 0.01) {
      alert("Balance is already correct!");
      return;
    }
    
    try {
      const response = await fetch("/api/transactions/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: modalAccount.id,
          amount: difference,
          note: `Balance adjustment: ${formatCurrency(modalAccountBalance)} → ${formatCurrency(targetBalance)}`
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        alert(error.error || "Failed to create adjustment");
        return;
      }
      
      // Update the modal balance and clear input
      setModalAccountBalance(targetBalance);
      setReconcileTarget("");
      setAccountTransactionCount(accountTransactionCount + 1);
      refresh();
    } catch (error) {
      alert("Failed to create adjustment");
    }
  };

  const createGroup = async () => {
    // Auto-determine type based on group name
    const inferGroupType = (name: string) => {
      const lowerName = name.toLowerCase();
      if (lowerName.includes('income') || lowerName.includes('salary') || lowerName.includes('earnings')) {
        return 'income';
      }
      if (lowerName.includes('transfer') || lowerName.includes('account')) {
        return 'transfer';
      }
      // Default to expense for most groups (Bills, Travel, Food, etc.)
      return 'expense';
    };

    const groupType = inferGroupType(newGroup.name);
    
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        name: newGroup.name, 
        type: groupType, 
        parentId: null 
      })
    });
    setNewGroup({ name: "", type: "expense" });
    refresh();
  };

  const createCategory = async () => {
    if (!newCategory.parentId) {
      alert("Please select a group for this category");
      return;
    }
    
    // Find the parent group and inherit its type
    const parentGroup = categories.find(c => c.id === newCategory.parentId);
    if (!parentGroup) {
      alert("Selected group not found");
      return;
    }
    
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newCategory.name,
        parentId: newCategory.parentId,
        type: parentGroup.type // Inherit type from parent group
      })
    });
    setNewCategory({ name: "", type: "expense", parentId: "" });
    refresh();
  };

  const updateCategory = async () => {
    if (!editingCategory) return;
    await fetch(`/api/categories/${editingCategory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editingCategory.name,
        type: editingCategory.type
      })
    });
    setEditingCategory(null);
    refresh();
  };

  const openCategoryModal = async (category: Category) => {
    setModalCategory(category);
    setModalOpen(true);
    setIsLoadingTransactions(true);
    
    try {
      // Fetch transactions for this category
      const response = await fetch(`/api/transactions?category=${category.id}`);
      const data = await response.json();
      setCategoryTransactions(data.transactions || []);
    } catch (error) {
      console.error("Failed to load transactions:", error);
      setCategoryTransactions([]);
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalCategory(null);
    setCategoryTransactions([]);
  };

  const unclassifyTransactions = async () => {
    if (!modalCategory) return;
    
    try {
      // Update all transactions in this category to have no category
      await Promise.all(
        categoryTransactions.map(tx =>
          fetch(`/api/transactions/${tx.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categoryId: null })
          })
        )
      );
      
      // Refresh the transaction list
      const response = await fetch(`/api/transactions?category=${modalCategory.id}`);
      const data = await response.json();
      setCategoryTransactions(data.transactions || []);
      
      refresh(); // Refresh the main data
    } catch (error) {
      alert("Failed to unclassify transactions");
    }
  };

  const deleteCategory = async () => {
    if (!modalCategory) return;
    
    try {
      const response = await fetch(`/api/categories/${modalCategory.id}`, {
        method: "DELETE"
      });
      
      if (!response.ok) {
        const error = await response.json();
        alert(error.error || "Failed to delete category");
        return;
      }
      
      closeModal();
      refresh();
    } catch (error) {
      alert("Failed to delete category");
    }
  };

  const updateModalCategory = async () => {
    if (!modalCategory) return;
    
    try {
      await fetch(`/api/categories/${modalCategory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: modalCategory.name,
          type: modalCategory.type
        })
      });
      
      closeModal();
      refresh();
    } catch (error) {
      alert("Failed to update category");
    }
  };

  const createRule = async () => {
    if (!newRule.categoryId) {
      alert("Please select a category for this rule");
      return;
    }
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRule)
    });
    setNewRule({ matchType: "merchantContains", matchValue: "", categoryId: "", priority: 100 });
    refresh();
  };

  const openRuleModal = (rule: Rule) => {
    setModalRule(rule);
    setRuleModalOpen(true);
  };

  const closeRuleModal = () => {
    setRuleModalOpen(false);
    setModalRule(null);
  };

  const updateRule = async () => {
    if (!modalRule) return;
    
    try {
      await fetch(`/api/rules/${modalRule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchType: modalRule.matchType,
          matchValue: modalRule.matchValue,
          categoryId: modalRule.categoryId,
          priority: modalRule.priority,
          isEnabled: modalRule.isEnabled
        })
      });
      
      closeRuleModal();
      refresh();
    } catch (error) {
      alert("Failed to update rule");
    }
  };

  const deleteRule = async () => {
    if (!modalRule) return;
    
    try {
      const response = await fetch(`/api/rules/${modalRule.id}`, {
        method: "DELETE"
      });
      
      if (!response.ok) {
        alert("Failed to delete rule");
        return;
      }
      
      closeRuleModal();
      refresh();
    } catch (error) {
      alert("Failed to delete rule");
    }
  };

  const closeMonth = async () => {
    await fetch("/api/reports/close-month", { method: "POST" });
    refresh();
  };

  const saveBudget = async () => {
    if (!budgetForm.categoryId || !budgetForm.limitAmount) return;
    
    if (budgetViewMonth) {
      // Save as month-specific override
      await fetch(`/api/budgets/${budgetViewMonth}/${budgetForm.categoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitAmount: Number(budgetForm.limitAmount) })
      });
    } else {
      // Save as default
      await fetch("/api/budgets/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          categoryId: budgetForm.categoryId,
          limitAmount: Number(budgetForm.limitAmount) 
        })
      });
    }
    setBudgetForm({ categoryId: "", limitAmount: "" });
    refresh();
  };

  const deleteBudget = async (categoryId: string) => {
    if (budgetViewMonth) {
      // Delete month-specific override
      await fetch(`/api/budgets/${budgetViewMonth}/${categoryId}`, {
        method: "DELETE"
      });
    } else {
      // Delete default
      await fetch(`/api/budgets/defaults?categoryId=${categoryId}`, {
        method: "DELETE"
      });
    }
    refresh();
  };

  const removeOverride = async (categoryId: string) => {
    // Remove just the override, keeping the default
    await fetch(`/api/budgets/${budgetViewMonth}/${categoryId}`, {
      method: "DELETE"
    });
    refresh();
  };

  const onFileSelect = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const [headerLine] = text.split(/\r?\n/);
    const columns = (headerLine ?? "").split(",").map((c) => c.trim());
    setImportState((s) => ({
      ...s,
      csvText: text,
      columns,
      mapping: {
        date: columns.find((c) => /date/i.test(c)) ?? "",
        amount: columns.find((c) => /amount|amt/i.test(c)) ?? "",
        merchant: columns.find((c) => /merchant|description|payee|vendor/i.test(c)) ?? "",
        note: columns.find((c) => /memo|note|details/i.test(c)) ?? ""
      }
    }));
  };

  const importCsv = async () => {
    if (!importState.accountId || !importState.csvText) {
      setImportState((s) => ({ ...s, status: "Select an account and CSV file first." }));
      return;
    }
    const body = {
      csv: importState.csvText,
      mapping: {
        date: importState.mapping.date,
        amount: importState.mapping.amount,
        merchant: importState.mapping.merchant,
        note: importState.mapping.note || undefined
      },
      accountId: importState.accountId,
      invertAmounts: importState.invertAmounts
    };
    setImportState((s) => ({ ...s, status: "Uploading..." }));
    try {
      const res = await fetch("/api/import/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      
      const summary = [
        `✅ Imported ${data.created ?? 0} new transactions`,
        data.skipped > 0 ? `⏭️ Skipped ${data.skipped} duplicates` : null,
        data.autoCategorized > 0 ? `🏷️ Auto-categorized ${data.autoCategorized}` : null,
        data.uncategorized > 0 ? `❓ ${data.uncategorized} need categorization` : null,
        data.transfersDetected > 0 ? `🔄 Detected ${data.transfersDetected} transfers` : null,
      ].filter(Boolean).join(' • ');
      
      setImportState((s) => ({ ...s, status: summary, summary: data }));
      refresh();
    } catch (err: any) {
      setImportState((s) => ({ ...s, status: `Import failed: ${err?.message ?? "unknown error"}` }));
    }
  };

  const updateBaseCurrency = async (currency: string) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseCurrency: currency })
      });
      refresh();
    } catch (error) {
      alert("Failed to update base currency");
    }
  };

  const addExchangeRate = async () => {
    if (!newExchangeRate.rate || parseFloat(newExchangeRate.rate) <= 0) {
      alert("Please enter a valid exchange rate");
      return;
    }

    try {
      const response = await fetch("/api/exchange-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCurrency: newExchangeRate.fromCurrency,
          toCurrency: newExchangeRate.toCurrency,
          rate: parseFloat(newExchangeRate.rate)
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to add exchange rate: ${error.error || 'Unknown error'}`);
        return;
      }
      
      setNewExchangeRate({ fromCurrency: "CAD", toCurrency: "USD", rate: "" });
      refresh();
    } catch (error) {
      console.error("Failed to add exchange rate:", error);
      alert("Failed to add exchange rate");
    }
  };

  const deleteExchangeRate = async (id: string) => {
    try {
      await fetch(`/api/exchange-rates/${id}`, {
        method: "DELETE"
      });
      refresh();
    } catch (error) {
      alert("Failed to delete exchange rate");
    }
  };

  const loadMonthlyReport = async (month: string) => {
    try {
      const [year, m] = month.split('-');
      const startDate = `${year}-${m}-01`;
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
      const endDate = `${year}-${m}-${String(lastDay).padStart(2, '0')}`;
      
      // Load current month data
      const res = await fetch(`/api/analytics/dashboard?preset=custom&startDate=${startDate}&endDate=${endDate}`);
      const data = await res.json();
      setReportData(data);
    } catch (error) {
      console.error("Failed to load monthly report:", error);
    }
  };

  const loadTrailing12Months = async (endMonth: string) => {
    try {
      const trailingRes = await fetch(`/api/reports/trailing-12-months?month=${endMonth}`);
      const trailingData = await trailingRes.json();
      setTrailing12Months(trailingData.months || []);
    } catch (error) {
      console.error("Failed to load trailing 12 months:", error);
    }
  };

  const goToPrev12Months = () => {
    const [year, month] = trailing12EndMonth.split('-').map(Number);
    const d = new Date(year, month - 2); // Go back 1 month
    setTrailing12EndMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const goToNext12Months = () => {
    const [year, month] = trailing12EndMonth.split('-').map(Number);
    const d = new Date(year, month); // Go forward 1 month
    const now = new Date();
    if (d <= now) {
      setTrailing12EndMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  };

  const backfillSnapshot = async () => {
    if (!backfillForm.year || !backfillForm.month || !backfillForm.income || !backfillForm.spending) {
      alert("Please fill in all fields");
      return;
    }

    const month = `${backfillForm.year}-${backfillForm.month}`;

    try {
      const response = await fetch("/api/reports/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          income: parseFloat(backfillForm.income),
          spending: parseFloat(backfillForm.spending)
        })
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to create snapshot: ${error.error || 'Unknown error'}`);
        return;
      }

      setBackfillForm({ year: '2024', month: '01', income: '', spending: '' });
      loadTrailing12Months(trailing12EndMonth);
      alert("Historical data saved successfully!");
    } catch (error) {
      console.error("Failed to backfill snapshot:", error);
      alert("Failed to save historical data");
    }
  };

  useEffect(() => {
    if (tab === 'reports') {
      loadMonthlyReport(reportMonth);
    }
  }, [tab, reportMonth]);

  useEffect(() => {
    if (tab === 'reports') {
      loadTrailing12Months(trailing12EndMonth);
    }
  }, [tab, trailing12EndMonth]);

  return (
    <div className="space-y-4">
      {tab === "general" && (
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.primary}`}>General Settings</div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Currency Settings */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>💱 Currency</h4>
              
              {/* Base Currency */}
              <div className="space-y-3 mb-6">
                <label className={`block text-sm font-medium ${ds.text.primary}`}>Base Currency</label>
                <Select
                  value={userSettings?.baseCurrency || "USD"}
                  onChange={(e) => updateBaseCurrency(e.target.value)}
                  className="max-w-xs"
                >
                  <option value="USD">🇺🇸 USD - US Dollar</option>
                  <option value="CAD">🇨🇦 CAD - Canadian Dollar</option>
                  <option value="EUR">🇪🇺 EUR - Euro</option>
                  <option value="GBP">🇬🇧 GBP - British Pound</option>
                </Select>
                <div className={`text-xs ${ds.text.muted}`}>
                  All analytics and reports will be displayed in this currency
                </div>
              </div>

              {/* Exchange Rates */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className={`block text-sm font-medium ${ds.text.primary}`}>Exchange Rates</label>
                  <a
                    href="https://www.google.com/search?q=currency+converter"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs ${ds.text.muted} hover:${ds.text.secondary} underline`}
                  >
                    Check current rates →
                  </a>
                </div>

                {/* Exchange Rates Table */}
                <div className={`${ds.bg.primary} rounded-lg border ${ds.border.default} overflow-hidden`}>
                  {exchangeRates.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className={`${ds.bg.tertiary}`}>
                        <tr>
                          <th className={`px-4 py-3 text-left ${ds.text.secondary} font-semibold`}>From</th>
                          <th className={`px-4 py-3 text-center ${ds.text.secondary}`}>→</th>
                          <th className={`px-4 py-3 text-left ${ds.text.secondary} font-semibold`}>To</th>
                          <th className={`px-4 py-3 text-right ${ds.text.secondary} font-semibold`}>Exchange Rate</th>
                          <th className={`px-4 py-3 text-right ${ds.text.secondary} font-semibold`}>Last Updated</th>
                          <th className="w-20"></th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${ds.border.default}`}>
                        {exchangeRates.map((rate) => (
                          <tr key={rate.id} className={`hover:${ds.bg.secondary} transition-colors`}>
                            <td className={`px-4 py-3`}>
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{getCurrencyFlag(rate.fromCurrency)}</span>
                                <span className={`font-semibold ${ds.text.primary}`}>{rate.fromCurrency}</span>
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-center ${ds.text.muted}`}>
                              <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                            </td>
                            <td className={`px-4 py-3`}>
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{getCurrencyFlag(rate.toCurrency)}</span>
                                <span className={`font-semibold ${ds.text.primary}`}>{rate.toCurrency}</span>
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-right`}>
                              <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${ds.bg.tertiary}`}>
                                <span className={`font-mono font-bold text-base ${ds.text.primary}`}>
                                  {rate.rate.toFixed(4)}
                                </span>
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-right text-xs ${ds.text.muted}`}>
                              {new Date(rate.updatedAt).toLocaleDateString('en-US', { 
                                month: 'short', 
                                day: 'numeric', 
                                year: 'numeric' 
                              })}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => deleteExchangeRate(rate.id)}
                                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${ds.status.error.text} hover:${ds.status.error.bg}`}
                                title="Delete this exchange rate"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className={`p-8 text-center ${ds.bg.secondary}`}>
                      <div className="text-4xl mb-3">💱</div>
                      <div className={`font-medium ${ds.text.primary} mb-1`}>No exchange rates configured</div>
                      <div className={`text-sm ${ds.text.muted}`}>
                        Add your first exchange rate below to enable multi-currency support
                      </div>
                    </div>
                  )}
                </div>

                {/* Add Exchange Rate Form */}
                <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
                  <div className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Add New Exchange Rate</div>
                  <div className="grid grid-cols-4 gap-3">
                    <Select
                      value={newExchangeRate.fromCurrency}
                      onChange={(e) => setNewExchangeRate({ ...newExchangeRate, fromCurrency: e.target.value })}
                    >
                      <option value="CAD">🇨🇦 CAD</option>
                      <option value="EUR">🇪🇺 EUR</option>
                      <option value="GBP">🇬🇧 GBP</option>
                      <option value="JPY">🇯🇵 JPY</option>
                    </Select>
                    <Select
                      value={newExchangeRate.toCurrency}
                      onChange={(e) => setNewExchangeRate({ ...newExchangeRate, toCurrency: e.target.value })}
                    >
                      <option value="USD">🇺🇸 USD</option>
                      <option value="CAD">🇨🇦 CAD</option>
                      <option value="EUR">🇪🇺 EUR</option>
                      <option value="GBP">🇬🇧 GBP</option>
                    </Select>
                    <Input
                      type="number"
                      step="0.0001"
                      placeholder="0.7200"
                      value={newExchangeRate.rate}
                      onChange={(e) => setNewExchangeRate({ ...newExchangeRate, rate: e.target.value })}
                    />
                    <Button onClick={addExchangeRate} className="py-2 bg-blue-600 hover:bg-blue-700 text-white">
                      Add Rate
                    </Button>
                  </div>
                  <div className={`text-xs ${ds.text.muted} mt-2`}>
                    💡 Example: If 1 CAD = 0.72 USD, enter <span className="font-mono">0.72</span> for CAD → USD
                  </div>
                </div>
              </div>
            </div>

            {/* Appearance Settings */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Appearance</h4>
              <div className="space-y-3">
                <label className={`block text-sm font-medium ${ds.text.primary} mb-2`}>Theme</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => {
                      const { setTheme } = require('@/lib/theme');
                      setTheme('light');
                    }}
                    className={`p-4 border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors ${ds.bg.primary}`}
                  >
                    <div className="text-2xl mb-2">☀️</div>
                    <div className={`text-sm font-medium ${ds.text.primary}`}>Light</div>
                  </button>
                  <button
                    onClick={() => {
                      const { setTheme } = require('@/lib/theme');
                      setTheme('dark');
                    }}
                    className={`p-4 border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors ${ds.bg.primary}`}
                  >
                    <div className="text-2xl mb-2">🌙</div>
                    <div className={`text-sm font-medium ${ds.text.primary}`}>Dark</div>
                  </button>
                  <button
                    onClick={() => {
                      const { setTheme } = require('@/lib/theme');
                      setTheme('system');
                    }}
                    className={`p-4 border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors ${ds.bg.primary}`}
                  >
                    <div className="text-2xl mb-2">💻</div>
                    <div className={`text-sm font-medium ${ds.text.primary}`}>System</div>
                  </button>
                </div>
                <div className={`text-xs ${ds.text.muted} mt-2`}>
                  Choose your preferred theme or use system settings
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "accounts" && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Accounts</div>
            <label className={`flex items-center gap-2 text-sm ${ds.text.secondary}`}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded"
              />
              Show archived
            </label>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Input placeholder="Name" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} />
              <Select value={newAccount.type} onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}>
                <option value="cash">Cash</option>
                <option value="checking">Checking</option>
                <option value="credit">Credit</option>
                <option value="brokerage">Brokerage</option>
                <option value="retirement">Retirement</option>
                <option value="crypto">Crypto</option>
                <option value="loan">Loan</option>
                <option value="other">Other</option>
              </Select>
              <Select value={newAccount.currency} onChange={(e) => setNewAccount({ ...newAccount, currency: e.target.value })}>
                <option value="USD">USD 🇺🇸</option>
                <option value="CAD">CAD 🇨🇦</option>
                <option value="EUR">EUR 🇪🇺</option>
                <option value="GBP">GBP 🇬🇧</option>
              </Select>
              <Button onClick={createAccount} className="py-3">Add account</Button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {accounts
                .filter(a => showArchived || a.isActive !== false)
                .map((a) => {
                // Helper function to get account type icon and color
                const getAccountStyle = (type: string) => {
                  switch (type) {
                    case 'checking':
                      return { icon: '🏦', color: `${ds.status.info.bg} ${ds.status.info.border}`, textColor: ds.status.info.text };
                    case 'credit':
                      return { icon: '💳', color: `${ds.status.error.bg} ${ds.status.error.border}`, textColor: ds.status.error.text };
                    case 'brokerage':
                      return { icon: '📈', color: `${ds.status.success.bg} ${ds.status.success.border}`, textColor: ds.status.success.text };
                    case 'retirement':
                      return { icon: '🏖️', color: `${ds.status.purple.bg} ${ds.status.purple.border}`, textColor: ds.status.purple.text };
                    case 'crypto':
                      return { icon: '₿', color: 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800', textColor: 'text-orange-700 dark:text-orange-400' };
                    case 'cash':
                      return { icon: '💵', color: `${ds.status.success.bg} ${ds.status.success.border}`, textColor: ds.status.success.text };
                    case 'loan':
                      return { icon: '🏠', color: `${ds.status.warning.bg} ${ds.status.warning.border}`, textColor: ds.status.warning.text };
                    default:
                      return { icon: '🏛️', color: `${ds.bg.secondary} ${ds.border.default}`, textColor: ds.text.primary };
                  }
                };

                // Helper function to get bank logo/icon
                const getBankLogo = (institution: string | null | undefined) => {
                  if (!institution) return null;
                  const bank = institution.toLowerCase();
                  
                  if (bank.includes('chase')) return '🔷';
                  if (bank.includes('bank of america') || bank.includes('boa')) return '🔴';
                  if (bank.includes('wells fargo')) return '🟡';
                  if (bank.includes('citi')) return '🔵';
                  if (bank.includes('capital one')) return '🟠';
                  if (bank.includes('american express') || bank.includes('amex')) return '💙';
                  if (bank.includes('discover')) return '🟤';
                  if (bank.includes('goldman sachs')) return '⚫';
                  if (bank.includes('morgan')) return '🔷';
                  if (bank.includes('schwab')) return '🟦';
                  if (bank.includes('fidelity')) return '🟢';
                  if (bank.includes('vanguard')) return '🔶';
                  
                  return '🏛️';
                };

                // Helper function to get bank background image
                const getBankBackground = (institution: string | null | undefined) => {
                  if (!institution) return null;
                  const bank = institution.toLowerCase();
                  
                  if (bank.includes('chase')) return '/images/banks/chase_card_background.png';
                  if (bank.includes('bilt')) return '/images/banks/bilt_card_bg.png';
                  if (bank.includes('scotia')) return '/images/banks/scotiabank_card_bg.png';
                  if (bank.includes('splitwise')) return '/images/banks/splitwise_card_bg.png';
                  
                  return null;
                };

                const style = getAccountStyle(a.type);
                const bankBg = getBankBackground(a.institution);
                const isArchived = a.isActive === false;
                const balance = accountBalances.get(a.id) ?? 0;
                
                // Render card with or without bank background
                if (bankBg) {
                  return (
                    <div 
                      key={a.id} 
                      className={`relative rounded-xl overflow-hidden shadow-md hover:shadow-lg transition-all cursor-pointer ${isArchived ? 'opacity-60' : ''}`}
                      style={{ 
                        backgroundImage: `url(${bankBg})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        aspectRatio: '1.8 / 1'
                      }}
                      onClick={() => openAccountModal(a)}
                    >
                      {/* Lighter gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-transparent to-transparent" />
                      
                      <div className="relative h-full p-4 flex flex-col justify-between">
                        {/* Top section - Account name and type */}
                        <div>
                          <h3 className="font-bold text-xl text-white drop-shadow-lg">
                            {a.name}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-white font-medium backdrop-blur-sm">
                              {a.type.charAt(0).toUpperCase() + a.type.slice(1)}
                            </span>
                            {isArchived && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/50 text-white font-medium backdrop-blur-sm">
                                Archived
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Bottom section - Balance prominent, Institution smaller */}
                        <div>
                          <div className={`text-2xl font-bold drop-shadow-lg ${balance >= 0 ? 'text-white' : 'text-red-300'}`}>
                            {formatCurrency(balance)}
                          </div>
                          <div className="text-white/70 text-xs font-medium mt-0.5">
                            {a.institution}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Default card without background image
                return (
                  <div 
                    key={a.id} 
                    className={`rounded-xl border-2 ${style.color} ${isArchived ? `opacity-60 ${ds.bg.secondary}` : ds.bg.primary} p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer`}
                    onClick={() => openAccountModal(a)}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{style.icon}</div>
                          <div>
                            <h3 className={`font-semibold text-lg ${ds.text.primary} leading-tight`}>
                              {a.name}
                              {isArchived && <span className={`text-sm ${ds.text.muted} ml-2`}>(Archived)</span>}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={`text-xs px-2 py-1 ${style.textColor} bg-transparent border-current`}>
                                {a.type.charAt(0).toUpperCase() + a.type.slice(1)}
                              </Badge>
                              {isArchived && (
                                <Badge className={`text-xs px-2 py-1 ${ds.text.muted} bg-transparent border-current`}>
                                  Archived
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className={`text-xl font-bold ${balance >= 0 ? ds.text.primary : 'text-red-600'}`}>
                          {formatCurrency(balance)}
                        </div>
                      </div>
                      {a.institution && (
                        <div className={`flex items-center gap-2 text-base ${ds.text.secondary} font-medium`}>
                          <span className="text-lg">{getBankLogo(a.institution)}</span>
                          {a.institution}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "categories" && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Category Groups & Categories</div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add New Group */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Add New Group</h4>
              <div className="grid gap-3 md:grid-cols-2">
                <Input 
                  placeholder="Group name (e.g., Income, Expenses, Bills, Travel)" 
                  value={newGroup.name} 
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} 
                />
                <Button onClick={createGroup} className="py-3">Add Group</Button>
              </div>
              <div className={`text-xs ${ds.text.muted} mt-2`}>
                <strong>Examples:</strong> Income, Monthly Bills, Groceries & Dining, Travel, Entertainment, Utilities
              </div>
            </div>

            {/* Add New Category */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Add New Category</h4>
              <div className="grid gap-3 md:grid-cols-3">
                <Input 
                  placeholder="Category name (e.g., Groceries, Rent)" 
                  value={newCategory.name} 
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} 
                />
                <Select 
                  value={newCategory.parentId} 
                  onChange={(e) => setNewCategory({ ...newCategory, parentId: e.target.value })}
                >
                  <option value="">Select group...</option>
                  {categories.filter(c => !c.parentId).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.type})
                    </option>
                  ))}
                </Select>
                <Button onClick={createCategory} className="py-3">Add Category</Button>
              </div>
              <div className={`text-xs ${ds.status.info.text} mt-2`}>
                Categories automatically inherit the type from their parent group
              </div>
            </div>
            
            {/* Display Groups and Categories */}
            <div className="space-y-8">
              {categories
                .filter(c => !c.parentId) // Only show top-level groups
                .sort(sortByName)
                .map((group) => {
                  const groupCategories = categories
                    .filter(c => c.parentId === group.id)
                    .sort(sortByName);
                  
                  // Helper function to get group styling
                  const getGroupStyle = (type: string) => {
                    switch (type) {
                      case 'expense':
                        return { icon: '💸', textColor: ds.status.error.text, bgColor: ds.status.error.bg, borderColor: ds.status.error.border };
                      case 'income':
                        return { icon: '💰', textColor: ds.status.success.text, bgColor: ds.status.success.bg, borderColor: ds.status.success.border };
                      case 'transfer':
                        return { icon: '🔄', textColor: ds.status.info.text, bgColor: ds.status.info.bg, borderColor: ds.status.info.border };
                      default:
                        return { icon: '📁', textColor: ds.text.primary, bgColor: ds.bg.secondary, borderColor: ds.border.default };
                    }
                  };

                  const groupStyle = getGroupStyle(group.type);

                  return (
                    <div key={group.id} className="space-y-3">
                      {/* Group Header - Clean and Simple */}
                      <div 
                        className={`flex items-center gap-3 pb-3 border-b-2 ${ds.border.default} cursor-pointer ${ds.bg.hover} -mx-2 px-2 rounded-t-lg transition-colors`}
                        onClick={() => openCategoryModal(group)}
                      >
                        <span className="text-2xl">{groupStyle.icon}</span>
                        <div>
                          <h3 className={`text-xl font-bold ${ds.text.primary}`}>{group.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-2 py-1 rounded-full ${groupStyle.bgColor} ${groupStyle.textColor} font-medium`}>
                              {group.type.charAt(0).toUpperCase() + group.type.slice(1)}
                            </span>
                            <span className={`text-sm ${ds.text.muted}`}>
                              {groupCategories.length} {groupCategories.length === 1 ? 'category' : 'categories'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Categories - Small Cards */}
                      {groupCategories.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                          {groupCategories.map((category) => (
                            <div key={category.id} className="group">
                              {editingCategory?.id === category.id ? (
                                <div className={`${ds.bg.primary} rounded-lg border-2 border-blue-300 dark:border-blue-600 p-3 shadow-sm`}>
                                  <Input
                                    value={editingCategory.name}
                                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                    placeholder="Category name"
                                    className="text-sm mb-2"
                                  />
                                  <div className="flex gap-1">
                                    <Button onClick={updateCategory} className="flex-1 text-xs py-1">
                                      Save
                                    </Button>
                                    <Button 
                                      onClick={() => setEditingCategory(null)} 
                                      className="flex-1 text-xs py-1"
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div 
                                  className={`${ds.bg.primary} rounded-lg border ${ds.border.default} p-3 shadow-sm hover:shadow-md ${ds.border.hover} transition-all cursor-pointer`}
                                  onClick={() => openCategoryModal(category)}
                                >
                                  <span className={`font-medium ${ds.text.primary} text-sm truncate`}>
                                    {category.name}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`text-center py-6 ${ds.text.muted} ${ds.bg.secondary} rounded-lg border-2 border-dashed ${ds.border.default}`}>
                          <div className="text-sm">No categories in this group yet</div>
                          <div className="text-xs mt-1">Add categories using the form above</div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {categories.filter(c => !c.parentId).length === 0 && (
              <div className={`text-center py-8 ${ds.text.muted}`}>
                <div className="text-4xl mb-2">📁</div>
                <div className="text-lg font-medium">No category groups yet</div>
                <div className="text-sm">Create your first group above to get started!</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Account Management Modal */}
      <Modal
        isOpen={accountModalOpen}
        onClose={closeAccountModal}
        title={modalAccount ? `Manage ${modalAccount.name}` : "Manage Account"}
      >
        {modalAccount && (
          <div className="space-y-6">
            {/* Edit Account */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Edit Details</h4>
              <div className="space-y-3">
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Name</label>
                  <Input
                    value={modalAccount.name}
                    onChange={(e) => setModalAccount({ ...modalAccount, name: e.target.value })}
                    placeholder="Account name"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Type</label>
                  <Select
                    value={modalAccount.type}
                    onChange={(e) => setModalAccount({ ...modalAccount, type: e.target.value })}
                    className="w-full"
                  >
                    <option value="cash">Cash</option>
                    <option value="checking">Checking</option>
                    <option value="credit">Credit</option>
                    <option value="brokerage">Brokerage</option>
                    <option value="retirement">Retirement</option>
                    <option value="crypto">Crypto</option>
                    <option value="loan">Loan</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Institution (optional)</label>
                  <Input
                    value={modalAccount.institution || ""}
                    onChange={(e) => setModalAccount({ ...modalAccount, institution: e.target.value })}
                    placeholder="e.g., Chase, Bank of America"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Currency</label>
                  <Select
                    value={modalAccount.currency || "USD"}
                    onChange={(e) => setModalAccount({ ...modalAccount, currency: e.target.value })}
                    className="w-full"
                  >
                    <option value="USD">USD 🇺🇸</option>
                    <option value="CAD">CAD 🇨🇦</option>
                    <option value="EUR">EUR 🇪🇺</option>
                    <option value="GBP">GBP 🇬🇧</option>
                  </Select>
                  {accountTransactionCount > 0 && (
                    <div className={`text-xs ${ds.text.muted} mt-1`}>
                      ⚠️ Changing currency won't convert existing transactions
                    </div>
                  )}
                </div>
                <Button onClick={updateModalAccount} className="w-full bg-blue-600 hover:bg-blue-700 py-3">
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Account Info */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Account Info</h4>
              <div className={`text-sm ${ds.text.secondary} space-y-1`}>
                <div><strong>Transactions:</strong> {accountTransactionCount}</div>
                <div><strong>Status:</strong> {modalAccount.isActive === false ? 'Archived' : 'Active'}</div>
                <div><strong>Current Balance:</strong> <span className={modalAccountBalance >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(modalAccountBalance)}</span></div>
              </div>
            </div>

            {/* Reconcile Balance */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.purple.text} mb-3`}>Reconcile Balance</h4>
              <div className={`text-sm ${ds.text.secondary} mb-3`}>
                Enter the actual balance from your bank statement to create an adjustment transaction.
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>Current</label>
                    <div className={`text-lg font-bold ${modalAccountBalance >= 0 ? ds.text.primary : 'text-red-600'}`}>
                      {formatCurrency(modalAccountBalance)}
                    </div>
                  </div>
                  <div className={ds.text.muted}>→</div>
                  <div className="flex-1">
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>Actual Balance</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={reconcileTarget}
                      onChange={(e) => setReconcileTarget(e.target.value)}
                      placeholder="0.00"
                      className="w-full"
                    />
                  </div>
                </div>
                {reconcileTarget && !isNaN(parseFloat(reconcileTarget)) && (
                  <div className={`${ds.bg.primary} rounded p-2 text-sm`}>
                    <span className={ds.text.secondary}>Adjustment needed: </span>
                    <span className={`font-semibold ${parseFloat(reconcileTarget) - modalAccountBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {parseFloat(reconcileTarget) - modalAccountBalance >= 0 ? '+' : ''}
                      {formatCurrency(parseFloat(reconcileTarget) - modalAccountBalance)}
                    </span>
                  </div>
                )}
                <Button 
                  onClick={reconcileBalance}
                  disabled={!reconcileTarget || isNaN(parseFloat(reconcileTarget)) || Math.abs(parseFloat(reconcileTarget) - modalAccountBalance) < 0.01}
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 disabled:cursor-not-allowed py-3"
                >
                  Create Adjustment
                </Button>
              </div>
            </div>

            {/* Archive/Restore */}
            {modalAccount.isActive !== false ? (
              <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
                <h4 className={`font-semibold ${ds.status.warning.text} mb-3`}>Archive Account</h4>
                <Button
                  onClick={archiveAccount}
                  className="w-full bg-yellow-600 text-white hover:bg-yellow-700 py-3"
                >
                  Archive Account
                </Button>
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  Archiving hides the account but preserves transaction history
                </div>
              </div>
            ) : (
              <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
                <h4 className={`font-semibold ${ds.status.success.text} mb-3`}>Restore Account</h4>
                <Button
                  onClick={restoreAccount}
                  className="w-full bg-green-600 text-white hover:bg-green-700 py-3"
                >
                  Restore Account
                </Button>
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  This will make the account active again
                </div>
              </div>
            )}

            {/* Delete Account */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.error.text} mb-3`}>Delete Account</h4>
              <Button
                onClick={deleteAccount}
                disabled={accountTransactionCount > 0}
                className={`w-full py-3 ${
                  accountTransactionCount > 0
                    ? '!bg-slate-300 dark:!bg-slate-700 !text-slate-500 dark:!text-slate-400 cursor-not-allowed'
                    : '!bg-red-600 !text-white hover:!bg-red-700'
                }`}
              >
                {accountTransactionCount > 0 
                  ? `Cannot Delete (${accountTransactionCount} transactions)` 
                  : "Delete Account"
                }
              </Button>
              {accountTransactionCount > 0 ? (
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  <strong>Blocked:</strong> Archive the account instead to preserve transaction history
                </div>
              ) : (
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  <strong>Warning:</strong> This action cannot be undone
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Category Management Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={modalCategory ? `Manage ${modalCategory.name}` : "Manage Category"}
      >
        {modalCategory && (
          <div className="space-y-6">
            {/* Edit Category */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>
                Edit Details
              </h4>
              <div className="space-y-3">
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Name</label>
                  <Input
                    value={modalCategory.name}
                    onChange={(e) => setModalCategory({ ...modalCategory, name: e.target.value })}
                    placeholder="Category name"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Type</label>
                  <div className={`px-3 py-2 ${ds.bg.secondary} rounded text-sm ${ds.text.secondary}`}>
                    {modalCategory.type.charAt(0).toUpperCase() + modalCategory.type.slice(1)} 
                    {modalCategory.parentId ? ' (inherited from group)' : ' Group (auto-determined)'}
                  </div>
                  <div className={`text-xs ${ds.text.muted} mt-1`}>
                    {modalCategory.parentId 
                      ? 'Category types are inherited from their parent group'
                      : 'Group types are automatically determined based on the group name'
                    }
                  </div>
                </div>
                <Button onClick={updateModalCategory} className="w-full bg-blue-600 hover:bg-blue-700 py-3">
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Transaction Management */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>
                Transactions ({categoryTransactions.length})
              </h4>
              
              {isLoadingTransactions ? (
                <div className={`text-center py-6 ${ds.text.muted}`}>
                  <div className="animate-pulse">Loading transactions...</div>
                </div>
              ) : categoryTransactions.length > 0 ? (
                <div className="space-y-4">
                  <div className={`${ds.bg.primary} rounded-lg border ${ds.border.default} max-h-48 overflow-y-auto`}>
                    {categoryTransactions.slice(0, 8).map((tx: any) => (
                      <div key={tx.id} className={`flex justify-between items-center p-3 border-b border-slate-200/50 dark:border-slate-700/50 last:border-b-0`}>
                        <div className="flex-1 min-w-0">
                          <div className={`font-medium ${ds.text.primary} truncate`}>{tx.merchant}</div>
                          <div className={`text-xs ${ds.text.muted}`}>{tx.date.split('T')[0]}</div>
                        </div>
                        <div className={`font-semibold ${ds.text.primary} ml-3`}>
                          ${Math.abs(tx.amount).toFixed(2)}
                        </div>
                      </div>
                    ))}
                    {categoryTransactions.length > 8 && (
                      <div className={`text-center py-2 text-sm ${ds.text.muted} ${ds.bg.secondary}`}>
                        ... and {categoryTransactions.length - 8} more transactions
                      </div>
                    )}
                  </div>
                  
                  <Button
                    onClick={unclassifyTransactions}
                    className="w-full bg-yellow-600 text-white hover:bg-yellow-700 py-3"
                  >
                    Unclassify All Transactions
                  </Button>
                  <div className={`text-sm ${ds.text.secondary} ${ds.status.warning.bg} p-3 rounded`}>
                    <strong>Note:</strong> This will remove the category from all {categoryTransactions.length} transactions, 
                    making them appear in the review queue again for re-categorization.
                  </div>
                </div>
              ) : (
                <div className={`text-center py-6 ${ds.text.muted} ${ds.bg.primary} rounded-lg border ${ds.border.default}`}>
                  <div className="text-2xl mb-2">📭</div>
                  <div>No transactions in this category</div>
                </div>
              )}
            </div>

            {/* Delete Category */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.error.text} mb-3`}>
                Danger Zone
              </h4>
              <Button
                onClick={deleteCategory}
                disabled={categoryTransactions.length > 0}
                className={`w-full bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed disabled:${ds.text.muted} py-3`}
              >
                {categoryTransactions.length > 0 
                  ? `Cannot Delete (${categoryTransactions.length} transactions)` 
                  : "Delete Category"
                }
              </Button>
              {categoryTransactions.length > 0 ? (
                <div className={`text-sm ${ds.text.secondary} mt-2 ${ds.status.error.bg} p-2 rounded`}>
                  <strong>Blocked:</strong> Unclassify all transactions first to enable deletion
                </div>
              ) : (
                <div className={`text-sm ${ds.text.secondary} mt-2`}>
                  <strong>Warning:</strong> This action cannot be undone
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Rule Management Modal */}
      <Modal
        isOpen={ruleModalOpen}
        onClose={closeRuleModal}
        title={modalRule ? `Manage Rule: ${modalRule.matchValue}` : "Manage Rule"}
      >
        {modalRule && (
          <div className="space-y-6">
            {/* Edit Rule */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>
                Edit Rule
              </h4>
              <div className="space-y-3">
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Match Type</label>
                  <Select
                    value={modalRule.matchType}
                    onChange={(e) => setModalRule({ ...modalRule, matchType: e.target.value })}
                    className="w-full"
                  >
                    <option value="merchantContains">Merchant contains</option>
                    <option value="merchantRegex">Merchant regex</option>
                    <option value="noteContains">Note contains</option>
                  </Select>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Match Value</label>
                  <Input
                    value={modalRule.matchValue}
                    onChange={(e) => setModalRule({ ...modalRule, matchValue: e.target.value })}
                    placeholder="What to match (e.g., 'Starbucks')"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Category</label>
                  <Select
                    value={modalRule.categoryId}
                    onChange={(e) => setModalRule({ ...modalRule, categoryId: e.target.value })}
                    className="w-full"
                  >
                    <option value="">Select category...</option>
                    {categories
                      .filter(c => !c.parentId) // Get all groups
                      .sort(sortByName)
                      .map((group) => {
                        const groupCategories = categories
                          .filter(c => c.parentId === group.id)
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
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Priority</label>
                    <Input
                      type="number"
                      value={modalRule.priority}
                      onChange={(e) => setModalRule({ ...modalRule, priority: Number(e.target.value) })}
                      placeholder="1-999"
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Status</label>
                    <Select
                      value={modalRule.isEnabled ? "enabled" : "disabled"}
                      onChange={(e) => setModalRule({ ...modalRule, isEnabled: e.target.value === "enabled" })}
                      className="w-full"
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </Select>
                  </div>
                </div>
                <Button onClick={updateRule} className="w-full bg-purple-600 hover:bg-purple-700 py-3">
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Rule Info */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>
                How This Rule Works
              </h4>
              <div className={`text-sm ${ds.text.secondary} space-y-2`}>
                <div>
                  <strong>When:</strong> A transaction's {modalRule.matchType.includes('merchant') ? 'merchant name' : 'note'} {modalRule.matchType.includes('regex') ? 'matches the pattern' : 'contains'} "{modalRule.matchValue}"
                </div>
                <div>
                  <strong>Then:</strong> Automatically categorize it as "{categories.find(c => c.id === modalRule.categoryId)?.name || 'Unknown'}"
                </div>
                <div>
                  <strong>Priority:</strong> {modalRule.priority} (lower numbers run first - if multiple rules match, only the first one applies)
                </div>
                <div>
                  <strong>Status:</strong> {modalRule.isEnabled ? 'Active - will process new transactions' : 'Disabled - will not process transactions'}
                </div>
              </div>
            </div>

            {/* Delete Rule */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.error.text} mb-3`}>
                Delete Rule
              </h4>
              <Button
                onClick={deleteRule}
                className="w-full bg-red-600 text-white hover:bg-red-700 py-3"
              >
                Delete Rule
              </Button>
              <div className={`text-sm ${ds.text.secondary} mt-2`}>
                <strong>Warning:</strong> This will not affect already categorized transactions
              </div>
            </div>
          </div>
        )}
      </Modal>

      {tab === "rules" && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Automation Rules</div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add New Rule */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>Add New Rule</h4>
              <div className={`text-xs ${ds.text.secondary} mb-3 ${ds.status.info.bg} p-2 rounded`}>
                <strong>Priority:</strong> Lower numbers run first. If multiple rules match a transaction, only the first matching rule (lowest priority number) is applied.
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <Select value={newRule.matchType} onChange={(e) => setNewRule({ ...newRule, matchType: e.target.value })}>
                  <option value="merchantContains">Merchant contains</option>
                  <option value="merchantRegex">Merchant regex</option>
                  <option value="noteContains">Note contains</option>
                </Select>
                <Input 
                  placeholder="Match value (e.g., 'Starbucks')" 
                  value={newRule.matchValue} 
                  onChange={(e) => setNewRule({ ...newRule, matchValue: e.target.value })} 
                />
                <Select 
                  value={newRule.categoryId} 
                  onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })}
                >
                  <option value="">Select category...</option>
                  {categories
                    .filter(c => !c.parentId) // Get all groups
                    .sort(sortByName)
                    .map((group) => {
                      const groupCategories = categories
                        .filter(c => c.parentId === group.id)
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
                <Input
                  placeholder="Priority (1-999)"
                  type="number"
                  value={newRule.priority}
                  onChange={(e) => setNewRule({ ...newRule, priority: Number(e.target.value) })}
                />
                <Button onClick={createRule} className="py-3">Add Rule</Button>
              </div>
            </div>

            {/* Rules List */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {rules.map((rule) => {
                const category = categories.find(c => c.id === rule.categoryId);
                const group = category ? categories.find(g => g.id === category.parentId) : null;
                
                const getMatchTypeStyle = (type: string) => {
                  switch (type) {
                    case 'merchantContains':
                      return { icon: '🏪', textColor: ds.status.info.text };
                    case 'merchantRegex':
                      return { icon: '🔍', textColor: ds.status.success.text };
                    case 'noteContains':
                      return { icon: '📝', textColor: ds.status.warning.text };
                    default:
                      return { icon: '⚙️', textColor: ds.text.primary };
                  }
                };

                const style = getMatchTypeStyle(rule.matchType);

                return (
                  <div 
                    key={rule.id} 
                    className={`rounded-xl border ${ds.border.default} ${ds.bg.primary} p-4 shadow-sm hover:shadow-md ${ds.border.hover} transition-all cursor-pointer`}
                    onClick={() => openRuleModal(rule)}
                  >
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{style.icon}</span>
                        <Badge className={`text-xs px-2 py-1 ${style.textColor} bg-transparent border-current`}>
                          {rule.matchType.replace('merchantContains', 'Merchant').replace('merchantRegex', 'Regex').replace('noteContains', 'Note')}
                        </Badge>
                      </div>

                      {/* Rule Content */}
                      <div className="space-y-2">
                        <div className={`text-sm font-medium ${ds.text.primary} truncate`}>
                          "{rule.matchValue}"
                        </div>
                        <div className={`text-xs ${ds.text.secondary} truncate`}>
                          → {group?.name} → {category?.name || 'Unknown'}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between">
                        <Badge className={`text-xs px-2 py-1 ${ds.text.secondary} ${ds.bg.tertiary}`}>
                          #{rule.priority}
                        </Badge>
                        {!rule.isEnabled && (
                          <Badge className={`text-xs px-2 py-1 ${ds.status.error.text} ${ds.status.error.bg}`}>
                            Disabled
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {rules.length === 0 && (
              <div className={`text-center py-8 ${ds.text.muted}`}>
                <div className="text-4xl mb-2">🤖</div>
                <div className="text-lg font-medium">No automation rules yet</div>
                <div className="text-sm">Create rules to automatically categorize transactions</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "budgets" && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Monthly Budgets</div>
            <div className="flex items-center gap-2">
              <select
                value={budgetViewMonth}
                onChange={(e) => setBudgetViewMonth(e.target.value)}
                className={`rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary}`}
              >
                <option value="">All months (defaults)</option>
                {/* Generate last 12 months + next 2 months */}
                {Array.from({ length: 14 }, (_, i) => {
                  const d = new Date();
                  d.setMonth(d.getMonth() - 11 + i);
                  const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  return <option key={`month-${i}`} value={value}>{label}</option>;
                })}
              </select>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Context indicator */}
            <div className={`p-3 rounded-lg text-sm ${budgetViewMonth ? `${ds.status.warning.bg} border ${ds.status.warning.border} ${ds.status.warning.text}` : `${ds.status.success.bg} border ${ds.status.success.border} ${ds.status.success.text}`}`}>
              {budgetViewMonth ? (
                <>
                  <strong>Viewing {new Date(budgetViewMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}:</strong> Changes here only affect this month. 
                  Budgets with a badge are overrides for this month.
                </>
              ) : (
                <>
                  <strong>Viewing defaults:</strong> These budgets apply to every month unless overridden.
                </>
              )}
            </div>

            {/* Add/Edit Budget */}
            <div className={`${ds.bg.secondary} p-4 rounded-lg border ${ds.border.default}`}>
              <h4 className={`text-sm font-semibold ${ds.text.primary} mb-3`}>
                {budgetViewMonth ? `Set Override for ${new Date(budgetViewMonth + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : 'Set Default Budget'}
              </h4>
              <div className="grid gap-3 md:grid-cols-3">
                <Select 
                  value={budgetForm.categoryId} 
                  onChange={(e) => setBudgetForm({ ...budgetForm, categoryId: e.target.value })}
                >
                  <option value="">Select category...</option>
                  {categories
                    .filter(c => !c.parentId)
                    .sort(sortByName)
                    .map((group) => {
                      const groupCategories = categories
                        .filter(c => c.parentId === group.id)
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
                <Input
                  placeholder="Budget amount"
                  type="number"
                  value={budgetForm.limitAmount}
                  onChange={(e) => setBudgetForm({ ...budgetForm, limitAmount: e.target.value })}
                />
                <Button onClick={saveBudget} className={`py-3 ${budgetViewMonth ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}>
                  {budgetViewMonth 
                    ? (budgets.find(b => b.categoryId === budgetForm.categoryId && b.isOverride) ? 'Update Override' : 'Set Override')
                    : (budgets.find(b => b.categoryId === budgetForm.categoryId) ? 'Update Default' : 'Set Default')
                  }
                </Button>
              </div>
            </div>

            {/* Current Budgets */}
            {budgets.length > 0 ? (
              <div className="space-y-6">
                {/* Total Budget Summary */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-5 border border-green-200">
                  <div className="text-sm text-green-700 font-medium">
                    {budgetViewMonth 
                      ? `Total Budget for ${new Date(budgetViewMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
                      : 'Total Monthly Budget'
                    }
                  </div>
                  <div className="text-3xl font-bold text-green-800 mt-1">
                    {formatCurrency(budgets.reduce((sum, b) => sum + b.limitAmount, 0))}
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    {budgets.length} {budgets.length === 1 ? 'category' : 'categories'} budgeted
                  </div>
                </div>
                {/* Group budgets by their parent category group */}
                {categories
                  .filter(c => !c.parentId) // Get all groups
                  .sort(sortByName)
                  .map(group => {
                    // Find budgets that belong to categories in this group
                    const groupBudgets = budgets.filter(b => {
                      const category = categories.find(c => c.id === b.categoryId);
                      return category?.parentId === group.id;
                    }).sort((a, b) => {
                      const catA = categories.find(c => c.id === a.categoryId);
                      const catB = categories.find(c => c.id === b.categoryId);
                      return sortByName({ name: catA?.name ?? '' }, { name: catB?.name ?? '' });
                    });
                    
                    if (groupBudgets.length === 0) return null;
                    
                    const groupTotal = groupBudgets.reduce((sum, b) => sum + b.limitAmount, 0);
                    
                    return (
                      <div key={group.id} className="space-y-3">
                        <div className={`flex items-center justify-between border-b ${ds.border.default} pb-2`}>
                          <div className={`text-sm font-semibold ${ds.text.primary}`}>
                            {group.name}
                          </div>
                          <div className={`text-sm font-bold ${ds.text.secondary} ${ds.bg.tertiary} px-3 py-1 rounded-full`}>
                            {formatCurrency(groupTotal)}
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                          {groupBudgets.map((b) => {
                            const category = categories.find(c => c.id === b.categoryId);
                            const defaultBudget = defaultBudgets.find(db => db.categoryId === b.categoryId);
                            const isOverride = b.isOverride;
                            
                            return (
                              <div 
                                key={b.id} 
                                className={`${ds.bg.primary} rounded-lg border p-4 hover:shadow-md transition-shadow ${isOverride ? 'border-amber-300 dark:border-amber-600' : ds.border.default}`}
                              >
                                <div className="flex items-start justify-between">
                                  <div 
                                    className="flex-1 cursor-pointer"
                                    onClick={() => setBudgetForm({ categoryId: b.categoryId, limitAmount: String(b.limitAmount) })}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className={`font-semibold ${ds.text.primary}`}>{category?.name ?? 'Unknown'}</span>
                                      {isOverride && (
                                        <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded font-medium">
                                          Override
                                        </span>
                                      )}
                                    </div>
                                    {isOverride && defaultBudget && (
                                      <div className={`text-xs ${ds.text.muted} mt-1`}>
                                        Default: {formatCurrency(defaultBudget.limitAmount)}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className={`text-lg font-bold ${isOverride ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                                      {formatCurrency(b.limitAmount)}
                                    </div>
                                    {isOverride ? (
                                      <button
                                        onClick={() => removeOverride(b.categoryId)}
                                        className={`${ds.text.muted} hover:text-amber-600 dark:hover:text-amber-400 transition-colors p-1`}
                                        title="Remove override (revert to default)"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                        </svg>
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => deleteBudget(b.categoryId)}
                                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                        title="Remove budget"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className={`text-center py-8 ${ds.text.muted} ${ds.bg.secondary} rounded-lg border-2 border-dashed ${ds.border.default}`}>
                <div className="text-3xl mb-2">📊</div>
                <div className="font-medium">No budgets set{budgetViewMonth ? ' for this month' : ' yet'}</div>
                <div className="text-sm mt-1">Use the form above to set your first budget</div>
              </div>
            )}

            {/* Info */}
            <div className={`${ds.status.info.bg} p-4 rounded-lg border ${ds.status.info.border} text-sm ${ds.status.info.text}`}>
              <strong>How it works:</strong> Default budgets apply to every month. 
              Select a specific month from the dropdown to create overrides (e.g., bump up "Gifts" in December).
              Overrides only affect that one month.
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "reports" && (
        <div className="space-y-6">
          {/* 12 Month Savings Rate Report */}
          {trailing12Months.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className={`text-sm font-semibold ${ds.text.primary}`}>12 Month Savings Rate Report</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={goToPrev12Months}
                      className={`p-1.5 rounded-lg transition-colors ${ds.interactive.default}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className={`text-sm ${ds.text.secondary} min-w-[120px] text-center`}>
                      {trailing12Months[0]?.label} - {trailing12Months[trailing12Months.length - 1]?.label}
                    </span>
                    <button
                      onClick={goToNext12Months}
                      className={`p-1.5 rounded-lg transition-colors ${ds.interactive.default}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={`${ds.bg.tertiary}`}>
                      <tr>
                        <th className={`px-3 py-2 text-left ${ds.text.secondary} font-semibold sticky left-0 ${ds.bg.tertiary}`}>Metric</th>
                        {trailing12Months.map((m) => (
                          <th key={m.month} className={`px-3 py-2 text-right ${ds.text.secondary} font-semibold whitespace-nowrap ${m.month === reportMonth ? 'bg-blue-100 dark:bg-blue-900/30' : ''}`}>
                            {m.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${ds.border.default}`}>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}>Income</td>
                        {trailing12Months.map((m) => (
                          <td key={m.month} className={`px-3 py-2 text-right text-green-600 font-semibold ${m.month === reportMonth ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                            {formatCurrency(m.income)}
                          </td>
                        ))}
                      </tr>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}>Spending</td>
                        {trailing12Months.map((m) => (
                          <td key={m.month} className={`px-3 py-2 text-right text-red-600 font-semibold ${m.month === reportMonth ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                            {formatCurrency(m.spending)}
                          </td>
                        ))}
                      </tr>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}>Savings</td>
                        {trailing12Months.map((m) => (
                          <td key={m.month} className={`px-3 py-2 text-right font-semibold ${m.savings >= 0 ? 'text-green-600' : 'text-red-600'} ${m.month === reportMonth ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                            {formatCurrency(m.savings)}
                          </td>
                        ))}
                      </tr>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}>Savings Rate</td>
                        {trailing12Months.map((m) => (
                          <td key={m.month} className={`px-3 py-2 text-right font-bold ${m.savingsRate >= 0 ? 'text-green-600' : 'text-red-600'} ${m.month === reportMonth ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                            {(m.savingsRate * 100).toFixed(1)}%
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <div className={`${ds.text.muted}`}>Loading 12 month data...</div>
              </CardContent>
            </Card>
          )}

          {/* Month Selector for Detailed View */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className={`text-sm font-semibold ${ds.text.primary}`}>Monthly Detail</div>
                <select
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  className={`rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary}`}
                >
                  {Array.from({ length: 14 }, (_, i) => {
                    const d = new Date();
                    d.setMonth(d.getMonth() - 11 + i);
                    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    return <option key={`report-month-${i}`} value={value}>{label}</option>;
                  })}
                </select>
              </div>
            </CardHeader>
          </Card>

          {reportData && (
            <>
              <Card>
                <CardHeader>
                  <div className={`text-sm font-semibold ${ds.text.primary}`}>Summary</div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>Cash In</div>
                      <div className="text-2xl font-bold text-green-600">
                        {formatCurrency(reportData.netCashflow.income)}
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>Cash Out</div>
                      <div className="text-2xl font-bold text-red-600">
                        -{formatCurrency(reportData.netCashflow.spending)}
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>Savings Rate</div>
                      <div className={`text-2xl font-bold ${reportData.savingsRate.rate >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {(reportData.savingsRate.rate * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Category Breakdown by Group */}
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {(() => {
                  // Get all parent groups (groups without a parent)
                  const allGroups = categories.filter(c => !c.parentId);
                  
                  // Group categories by their parent group
                  const groupedCategories: Record<string, typeof reportData.spendByCategory> = {};
                  
                  // Initialize all groups with empty arrays
                  allGroups.forEach(group => {
                    groupedCategories[group.name] = [];
                  });
                  
                  // Add categories that have transactions
                  (reportData.allCategories || reportData.spendByCategory || []).forEach((cat: any) => {
                    const category = categories.find(c => c.name === cat.category);
                    const parentGroup = category?.parentId 
                      ? categories.find(c => c.id === category.parentId)
                      : null;
                    
                    const groupName = parentGroup?.name || 'Uncategorized';
                    if (!groupedCategories[groupName]) {
                      groupedCategories[groupName] = [];
                    }
                    groupedCategories[groupName].push(cat);
                  });

                  // Sort groups: Income first, then alphabetically
                  const sortedGroups = Object.entries(groupedCategories)
                    .filter(([, cats]) => cats.length > 0) // Only show groups with transactions
                    .sort(([a], [b]) => {
                      if (a.toLowerCase().includes('income')) return -1;
                      if (b.toLowerCase().includes('income')) return 1;
                      return a.localeCompare(b);
                    });

                  return sortedGroups.map(([groupName, cats]) => {
                    const groupTotal = cats.reduce((sum, c) => sum + c.amount, 0);
                    const isIncome = groupName.toLowerCase().includes('income');
                    
                    return (
                      <Card key={groupName}>
                        <CardHeader>
                          <div className="space-y-2">
                            <div className={`text-sm font-semibold ${ds.text.primary}`}>{groupName}</div>
                            <div className={`text-2xl font-bold ${isIncome ? 'text-green-600' : 'text-red-600'}`}>
                              {isIncome ? '' : '-'}{formatCurrency(Math.abs(groupTotal))}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {cats.length > 0 ? (
                            <div className="space-y-2">
                              {cats
                                .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                                .map((cat) => (
                                  <div key={cat.category} className="flex items-center justify-between text-sm">
                                    <span className={ds.text.secondary}>{cat.category}</span>
                                    <span className={`font-semibold ${cat.amount < 0 ? 'text-green-600' : cat.amount > 0 ? 'text-red-600' : ds.text.primary}`}>
                                      {formatCurrency(Math.abs(cat.amount))}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <div className={`text-sm ${ds.text.muted} text-center py-4`}>
                              No transactions this month
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  });
                })()}
              </div>
            </>
          )}

          {/* Backfill Historical Data */}
          <details className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}>
            <summary className={`cursor-pointer p-4 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}>
              📝 Backfill Historical Data (for months without transactions)
            </summary>
            <div className="px-4 pb-4">
              <div className={`text-sm ${ds.text.secondary} mb-4`}>
                Add summary data for months where you don't have individual transactions
              </div>
              <div className="grid grid-cols-5 gap-3">
                <Select
                  value={backfillForm.year}
                  onChange={(e) => setBackfillForm({ ...backfillForm, year: e.target.value })}
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - i;
                    return <option key={year} value={year}>{year}</option>;
                  })}
                </Select>
                <Select
                  value={backfillForm.month}
                  onChange={(e) => setBackfillForm({ ...backfillForm, month: e.target.value })}
                >
                  <option value="01">January</option>
                  <option value="02">February</option>
                  <option value="03">March</option>
                  <option value="04">April</option>
                  <option value="05">May</option>
                  <option value="06">June</option>
                  <option value="07">July</option>
                  <option value="08">August</option>
                  <option value="09">September</option>
                  <option value="10">October</option>
                  <option value="11">November</option>
                  <option value="12">December</option>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  value={backfillForm.income}
                  onChange={(e) => setBackfillForm({ ...backfillForm, income: e.target.value })}
                  placeholder="Income"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={backfillForm.spending}
                  onChange={(e) => setBackfillForm({ ...backfillForm, spending: e.target.value })}
                  placeholder="Spending"
                />
                <Button onClick={backfillSnapshot} className="bg-blue-600 hover:bg-blue-700 text-white">
                  Add Snapshot
                </Button>
              </div>
              <div className={`text-xs ${ds.text.muted} mt-2`}>
                💡 Savings and savings rate are calculated automatically. If transactions exist for a month, they take priority.
              </div>
            </div>
          </details>
        </div>
      )}

      {tab === "import" && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>CSV import (per account)</div>
          </CardHeader>
          <CardContent className={`space-y-4 text-sm ${ds.text.primary}`}>
            <div className="grid gap-3 md:grid-cols-3">
              <Select
                value={importState.accountId}
                onChange={(e) => setImportState((s) => ({ ...s, accountId: e.target.value }))}
              >
                <option value="">Select account</option>
                {accounts
                  .filter(a => a.isActive !== false) // Only show active accounts
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} {a.institution ? `(${a.institution})` : ''} {a.currency && a.currency !== 'USD' ? `- ${a.currency}` : ''}
                    </option>
                  ))}
              </Select>
              <label className="relative cursor-pointer">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
                  className="hidden"
                  id="csv-file-input"
                />
                <div className={`flex items-center justify-center gap-2 px-4 py-3 ${ds.bg.primary} border-2 ${ds.border.default} rounded-lg hover:border-blue-400 dark:hover:border-blue-500 ${ds.bg.hover} transition-colors`}>
                  <svg className={`w-5 h-5 ${ds.text.secondary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className={`text-sm font-medium ${ds.text.primary}`}>
                    {importState.csvText ? '✓ File selected' : 'Choose CSV file'}
                  </span>
                </div>
              </label>
              <Button 
                onClick={importCsv} 
                disabled={!importState.accountId || !importState.csvText}
                className="py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Upload & import
              </Button>
            </div>

            {importState.columns.length > 0 && (
              <div className={`rounded-lg border ${ds.border.default} ${ds.bg.secondary} p-3`}>
                <div className={`mb-3 text-xs font-semibold uppercase tracking-wide ${ds.text.muted}`}>
                  Map your CSV columns to transaction fields
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Transaction Date →
                    </label>
                    <Select
                      value={importState.mapping.date}
                      onChange={(e) => setImportState((s) => ({ ...s, mapping: { ...s.mapping, date: e.target.value } }))}
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`date-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Amount →
                    </label>
                    <Select
                      value={importState.mapping.amount}
                      onChange={(e) => setImportState((s) => ({ ...s, mapping: { ...s.mapping, amount: e.target.value } }))}
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`amount-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Merchant/Description →
                    </label>
                    <Select
                      value={importState.mapping.merchant}
                      onChange={(e) => setImportState((s) => ({ ...s, mapping: { ...s.mapping, merchant: e.target.value } }))}
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`merchant-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Note/Memo (optional) →
                    </label>
                    <Select
                      value={importState.mapping.note}
                      onChange={(e) => setImportState((s) => ({ ...s, mapping: { ...s.mapping, note: e.target.value } }))}
                    >
                      <option value="">Select CSV column...</option>
                      {importState.columns.map((c, idx) => (
                        <option key={`note-col-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                
                {/* Advanced Options */}
                <details className="mt-4">
                  <summary className={`cursor-pointer text-xs font-medium ${ds.text.secondary} hover:${ds.text.primary}`}>
                    ⚙️ Advanced Options
                  </summary>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={importState.invertAmounts}
                        onChange={(e) => setImportState((s) => ({ ...s, invertAmounts: e.target.checked }))}
                        className="rounded"
                      />
                      <span className={`text-xs ${ds.text.secondary}`}>
                        Invert amounts (flip positive/negative)
                      </span>
                    </label>
                    <div className={`text-xs ${ds.text.muted} pl-6`}>
                      Use this if your bank reports amounts backwards (e.g., expenses as positive, income as negative)
                    </div>
                  </div>
                </details>
                
                <div className={`mt-3 text-xs ${ds.text.muted}`}>
                  ✓ Auto-deduplicates by date+amount+merchant • Auto-categorizes • Detects transfers
                </div>
              </div>
            )}

            {importState.status && (
              <div className="space-y-3">
                <div className={`text-sm ${ds.text.primary} font-medium`}>{importState.status}</div>
                
                {importState.summary && (
                  <div className="space-y-2">
                    {/* Auto-Categorized Section */}
                    {importState.summary.autoCategorizedList && importState.summary.autoCategorizedList.length > 0 && (
                      <details className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}>
                        <summary className={`cursor-pointer p-3 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}>
                          🏷️ Auto-Categorized ({importState.summary.autoCategorized})
                        </summary>
                        <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                          {importState.summary.autoCategorizedList.map((t: any, i: number) => (
                            <div key={i} className={`flex items-center justify-between py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0`}>
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium ${ds.text.primary} truncate text-sm`}>{t.merchant}</div>
                                <div className={`text-xs ${ds.text.muted}`}>{t.date}</div>
                              </div>
                              <div className={`text-sm font-semibold ml-3 ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ${Math.abs(t.amount).toFixed(2)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    
                    {/* Duplicates Section */}
                    {importState.summary.duplicates && importState.summary.duplicates.length > 0 && (
                      <details className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}>
                        <summary className={`cursor-pointer p-3 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}>
                          ⏭️ Skipped Duplicates ({importState.summary.duplicates.length})
                        </summary>
                        <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                          {importState.summary.duplicates.map((t: any, i: number) => (
                            <div key={i} className={`flex items-center justify-between py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0`}>
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium ${ds.text.primary} truncate text-sm`}>{t.merchant}</div>
                                <div className={`text-xs ${ds.text.muted}`}>{t.date} • {t.reason}</div>
                              </div>
                              <div className={`text-sm font-semibold ml-3 ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ${Math.abs(t.amount).toFixed(2)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    
                    {/* Transfers Detected Section */}
                    {importState.summary.transfersDetected > 0 && (
                      <details className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}>
                        <summary className={`cursor-pointer p-3 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}>
                          🔄 Transfers Detected ({importState.summary.transfersDetected} pairs)
                        </summary>
                        <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
                          {importState.summary.crossAccountTransfers && importState.summary.crossAccountTransfers.map((t: any, i: number) => (
                            <div key={i} className={`py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0`}>
                              <div className={`text-xs ${ds.text.muted} mb-1`}>{t.date}</div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <div className={`text-sm ${ds.text.primary}`}>{t.account1}</div>
                                  <div className={`text-xs ${ds.text.secondary} truncate`}>{t.merchant1}</div>
                                </div>
                                <div className="text-sm font-semibold text-red-600">${Math.abs(t.amount1).toFixed(2)}</div>
                                <div className={`text-xs ${ds.text.muted}`}>↔</div>
                                <div className="flex-1">
                                  <div className={`text-sm ${ds.text.primary}`}>{t.account2}</div>
                                  <div className={`text-xs ${ds.text.secondary} truncate`}>{t.merchant2}</div>
                                </div>
                                <div className="text-sm font-semibold text-green-600">${Math.abs(t.amount2).toFixed(2)}</div>
                              </div>
                            </div>
                          ))}
                          {importState.summary.sameAccountTransfers && importState.summary.sameAccountTransfers.map((t: any, i: number) => (
                            <div key={`same-${i}`} className={`py-2 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0`}>
                              <div className={`text-xs ${ds.text.muted} mb-1`}>{t.date} • Same account</div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <div className={`text-xs ${ds.text.secondary} truncate`}>{t.merchant1}</div>
                                </div>
                                <div className="text-sm font-semibold text-red-600">${Math.abs(t.amount1).toFixed(2)}</div>
                                <div className={`text-xs ${ds.text.muted}`}>↔</div>
                                <div className="flex-1">
                                  <div className={`text-xs ${ds.text.secondary} truncate`}>{t.merchant2}</div>
                                </div>
                                <div className="text-sm font-semibold text-green-600">${Math.abs(t.amount2).toFixed(2)}</div>
                              </div>
                            </div>
                          ))}
                          <div className={`text-xs ${ds.text.muted} mt-2 pt-2 border-t ${ds.border.default}`}>
                            Transfers are automatically excluded from spending totals
                          </div>
                        </div>
                      </details>
                    )}
                    
                    {/* Uncategorized Section */}
                    {importState.summary.uncategorizedList && importState.summary.uncategorizedList.length > 0 && (
                      <details className={`${ds.status.warning.bg} rounded-lg border ${ds.status.warning.border}`}>
                        <summary className={`cursor-pointer p-3 font-medium text-sm ${ds.status.warning.text} hover:bg-yellow-100 dark:hover:bg-yellow-500/20`}>
                          ❓ Need Categorization ({importState.summary.uncategorized})
                        </summary>
                        <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                          {importState.summary.uncategorizedList.map((t: any, i: number) => (
                            <div key={i} className={`flex items-center justify-between py-2 border-b border-yellow-200/50 dark:border-yellow-500/20 last:border-0`}>
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium ${ds.text.primary} truncate text-sm`}>{t.merchant}</div>
                                <div className={`text-xs ${ds.text.muted}`}>{t.date}</div>
                              </div>
                              <div className={`text-sm font-semibold ml-3 ${t.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ${Math.abs(t.amount).toFixed(2)}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className={`px-3 pb-2 text-xs ${ds.status.warning.text}`}>
                          → Go to Transactions → Review Queue to categorize these
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
