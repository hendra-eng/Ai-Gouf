// Backend integration point: replace with API calls to /api/clients

export type ClientStatus = 'Healthy' | 'Stable' | 'Attention Required' | 'Critical';
export type TaxStatus = 'Compliant' | 'Pending' | 'Overdue' | 'Under Review';
export type AccountingStatus = 'Up to Date' | 'Pending Review' | 'Needs Attention' | 'Behind';

export interface ClientFinancials {
  revenue: number;
  netProfit: number;
  cash: number;
  ar: number;
  ap: number;
  grossMargin: number;
  revenueGrowth: number;
  trendData: number[];
}

export interface ClientHealthScore {
  overall: number;
  liquidity: number;
  profitability: number;
  cashFlow: number;
  solvency: number;
  compliance: number;
}

export interface Client {
  id: string;
  companyName: string;
  industry: string;
  status: ClientStatus;
  taxStatus: TaxStatus;
  accountingStatus: AccountingStatus;
  assignedAccountant: string;
  financials: ClientFinancials;
  healthScore: ClientHealthScore;
  joinDate: string;
  lastActivity: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  npwp: string;
  address: string;
  aiInsight: string;
}

export const clients: Client[] = [];

export const clientActivityFeed: {
  id: string;
  clientId: string;
  action: string;
  type: string;
  user: string;
  date: string;
  time: string;
}[] = [];