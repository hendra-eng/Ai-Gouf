// Core Financial Data Model
// All values in IDR (Indonesian Rupiah), in millions unless noted

export const COMPANY = {
  name: '',
  shortName: '',
  industry: '',
  currency: 'IDR',
  period: '',
  fiscalYear: '',
  taxId: '',
};

// Core P&L Values (in millions IDR)
export const PL_CORE = {
  revenue: 0,
  cogs: 0,
  grossProfit: 0,
  operatingExpenses: 0,
  ebitda: 0,
  da: 0,
  ebit: 0,
  interestExpense: 0,
  ebt: 0,
  incomeTax: 0,
  netProfit: 0,
};

// Margins
export const MARGINS = {
  grossMargin: 0,
  ebitdaMargin: 0,
  ebitMargin: 0,
  netMargin: 0,
};

// Balance Sheet Values (in millions IDR)
export const BS_CORE = {
  totalAssets: 0,
  totalLiabilities: 0,
  totalEquity: 0,
  cash: 0,
  bank: 0,
  accountsReceivable: 0,
  inventory: 0,
  prepaidExpenses: 0,
  otherCurrentAssets: 0,
  property: 0,
  equipment: 0,
  vehicles: 0,
  computerEquipment: 0,
  intangibleAssets: 0,
  otherNonCurrentAssets: 0,
  accountsPayable: 0,
  taxPayable: 0,
  accruedExpenses: 0,
  payrollLiabilities: 0,
  shortTermDebt: 0,
  otherCurrentLiabilities: 0,
  longTermDebt: 0,
  leaseLiabilities: 0,
  otherLongTermLiabilities: 0,
  paidInCapital: 0,
  additionalPaidInCapital: 0,
  retainedEarnings: 0,
  currentYearProfit: 0,
  otherEquity: 0,
};

// Cash Flow Values (in millions IDR)
export const CF_CORE = {
  beginningCash: 0,
  customerCollections: 0,
  supplierPayments: 0,
  payrollPayments: 0,
  taxPayments: 0,
  operatingExpensesCF: 0,
  otherOperatingCF: 0,
  netOperatingCF: 0,
  assetPurchases: 0,
  assetSales: 0,
  equipmentPurchases: 0,
  investments: 0,
  otherInvestingCF: 0,
  netInvestingCF: 0,
  debtProceeds: 0,
  debtRepayment: 0,
  capitalInjection: 0,
  dividendPayments: 0,
  leasePayments: 0,
  otherFinancingCF: 0,
  netFinancingCF: 0,
  netChange: 0,
  endingCash: 0,
};

// Monthly P&L Data
export const MONTHLY_PL = [
  { month: 'Jan', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
  { month: 'Feb', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
  { month: 'Mar', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
  { month: 'Apr', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
  { month: 'May', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
  { month: 'Jun', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
  { month: 'Jul', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
  { month: 'Aug', revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, da: 0, ebit: 0, interest: 0, tax: 0, netProfit: 0 },
];

// Revenue Breakdown
export const REVENUE_BY_CATEGORY = [
  { name: 'Software Development', value: 0, pct: 0 },
  { name: 'IT Consulting', value: 0, pct: 0 },
  { name: 'Managed Services', value: 0, pct: 0 },
  { name: 'Cloud Solutions', value: 0, pct: 0 },
  { name: 'Training & Support', value: 0, pct: 0 },
];

export const REVENUE_BY_CUSTOMER = [
  { name: 'Bank Mandiri', value: 0, pct: 0 },
  { name: 'Telkom Indonesia', value: 0, pct: 0 },
  { name: 'Pertamina', value: 0, pct: 0 },
  { name: 'BRI', value: 0, pct: 0 },
  { name: 'PLN', value: 0, pct: 0 },
  { name: 'Others', value: 0, pct: 0 },
];

// Expense Breakdown
export const EXPENSE_BREAKDOWN = [
  { name: 'Payroll', value: 0, pct: 0 },
  { name: 'Marketing', value: 0, pct: 0 },
  { name: 'Software & Technology', value: 0, pct: 0 },
  { name: 'Office & Administration', value: 0, pct: 0 },
  { name: 'Professional Services', value: 0, pct: 0 },
  { name: 'Travel', value: 0, pct: 0 },
  { name: 'Utilities', value: 0, pct: 0 },
  { name: 'Other', value: 0, pct: 0 },
];

// Budget vs Actual (current period)
export const BUDGET_VS_ACTUAL = [
  { item: 'Revenue', budget: 0, actual: 0, variance: 0, variancePct: 0 },
  { item: 'COGS', budget: 0, actual: 0, variance: 0, variancePct: 0 },
  { item: 'Gross Profit', budget: 0, actual: 0, variance: 0, variancePct: 0 },
  { item: 'Operating Expenses', budget: 0, actual: 0, variance: 0, variancePct: 0 },
  { item: 'EBITDA', budget: 0, actual: 0, variance: 0, variancePct: 0 },
  { item: 'Net Profit', budget: 0, actual: 0, variance: 0, variancePct: 0 },
];

// Full-year Budget P&L structure (in millions IDR)
export const BUDGET = {
  revenue: 0,
  cogs: 0,
  grossProfit: 0,
  operatingExpenses: 0,
  ebitda: 0,
  netProfit: 0,
};

// Full-year Forecast P&L structure (in millions IDR)
export const FORECAST = {
  revenue: 0,
  cogs: 0,
  grossProfit: 0,
  operatingExpenses: 0,
  ebitda: 0,
  netProfit: 0,
};

// Balance Sheet Monthly Trend
export const BS_MONTHLY_TREND = [
  { month: 'Jan', assets: 0, liabilities: 0, equity: 0 },
  { month: 'Feb', assets: 0, liabilities: 0, equity: 0 },
  { month: 'Mar', assets: 0, liabilities: 0, equity: 0 },
  { month: 'Apr', assets: 0, liabilities: 0, equity: 0 },
  { month: 'May', assets: 0, liabilities: 0, equity: 0 },
  { month: 'Jun', assets: 0, liabilities: 0, equity: 0 },
  { month: 'Jul', assets: 0, liabilities: 0, equity: 0 },
  { month: 'Aug', assets: 0, liabilities: 0, equity: 0 },
];

// Cash Flow Monthly
export const CF_MONTHLY = [
  { month: 'Jan', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
  { month: 'Feb', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
  { month: 'Mar', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
  { month: 'Apr', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
  { month: 'May', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
  { month: 'Jun', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
  { month: 'Jul', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
  { month: 'Aug', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0 },
];

// Cash Flow Forecast
export const CF_FORECAST = [
  { month: 'Sep 2026', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0, isForecast: true },
  { month: 'Oct 2026', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0, isForecast: true },
  { month: 'Nov 2026', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0, isForecast: true },
  { month: 'Dec 2026', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0, isForecast: true },
  { month: 'Jan 2027', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0, isForecast: true },
  { month: 'Feb 2027', beginCash: 0, operatingCF: 0, investingCF: 0, financingCF: 0, netChange: 0, endCash: 0, isForecast: true },
];

// AI Insights
export const PL_AI_INSIGHTS: any[] = [];

export const BS_AI_INSIGHTS: any[] = [];

export const CF_AI_INSIGHTS: any[] = [];

// Combined financials object used across Budget, Analytics, Liquidity & Solvency components
export const FINANCIALS = {
  ...PL_CORE,
  ...BS_CORE,
  totalDebt: BS_CORE.shortTermDebt + BS_CORE.longTermDebt,
};

// Utility: Format currency (values expected in millions IDR)
// Canonical IDR structure: T (Triliun) > M (Milyar) > Jt (Juta) > Rb (Ribu).
export function formatIDR(value: number, compact = true): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (compact) {
    if (abs >= 1000000) return `${sign}Rp ${(abs / 1000000).toFixed(2).replace('.', ',')}T`;
    if (abs >= 1000) return `${sign}Rp ${(abs / 1000).toFixed(2).replace('.', ',')}M`;
    if (abs >= 1) return `${sign}Rp ${abs.toFixed(0)}Jt`;
    return `${sign}Rp ${(abs * 1000).toFixed(0)}Rb`;
  }
  return `${sign}Rp ${abs.toLocaleString('id-ID')}`;
}

export function formatPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

// Utility: Budget vs Actual variance (values in millions IDR)
export function calcVariance(actual: number, budget: number) {
  const diff = actual - budget;
  const pct = budget !== 0 ? (diff / budget) * 100 : 0;
  return { diff, pct };
}

// Utility: Percentage of total
export function calcPct(value: number, total: number): number {
  return total !== 0 ? (value / total) * 100 : 0;
}

// ============================================================
// Additional exports merged from kodingan 2 (no naming conflicts)
// Note: kodingan 2 used raw-rupiah scale for its Balance Sheet
// totals (totalAssets/totalLiabilities/equity), which did not
// match BS_CORE above — those were intentionally NOT merged.
// Use BS_CORE as the single source of truth for balance sheet figures.
// ============================================================

// Recent transactions feed (for Transactions / Dashboard widgets)
export const RECENT_TRANSACTIONS: any[] = [];

// Simplified monthly summary (revenue/expenses/profit/cash) — separate from
// MONTHLY_PL above, which has full P&L line items. Values in raw IDR.
export const MONTHLY_SUMMARY = [
  { month: 'Jan', revenue: 0, expenses: 0, profit: 0, cash: 0 },
  { month: 'Feb', revenue: 0, expenses: 0, profit: 0, cash: 0 },
  { month: 'Mar', revenue: 0, expenses: 0, profit: 0, cash: 0 },
  { month: 'Apr', revenue: 0, expenses: 0, profit: 0, cash: 0 },
  { month: 'May', revenue: 0, expenses: 0, profit: 0, cash: 0 },
  { month: 'Jun', revenue: 0, expenses: 0, profit: 0, cash: 0 },
  { month: 'Jul', revenue: 0, expenses: 0, profit: 0, cash: 0 },
  { month: 'Aug', revenue: 0, expenses: 0, profit: 0, cash: 0 },
];

// ------------------------------------------------------------
// Backward-compat aliases for pages still importing old names
// from kodingan 2 (e.g. src/app/ai-analytics/page.tsx). Keeps
// those pages working without editing every page.tsx by hand.
// ------------------------------------------------------------
export const monthlyData = MONTHLY_SUMMARY;
export const PERIOD = COMPANY.period;