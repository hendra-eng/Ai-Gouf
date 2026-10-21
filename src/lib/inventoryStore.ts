'use client';

// Inventory -- terhubung ke backend modules/assets_and_equity/inventory_v1.py
// (/api/v1/asset/inventory/...). Stok & nilai dihitung backend dari kartu stok
// (rata-rata bergerak); jurnal INV dibaca GL/FS sebagai sumber "inventory".

import { createV1Api, useV1Data } from '@/lib/v1Api';

export const INVENTORY_EVENT = 'gouf-inventory-changed';
const api = createV1Api('/api/v1/asset/inventory', INVENTORY_EVENT);

export const useInvData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) =>
  useV1Data(INVENTORY_EVENT, key, fn, awal);

// ============================================================
// TIPE
// ============================================================

export type DocType = 'opening' | 'receipt' | 'issue' | 'adjustment' | 'transfer';
export type DocStatus = 'draft' | 'posted' | 'void';
export type StockStatus = 'active' | 'low_stock' | 'out_of_stock' | 'inactive';
export type AdjustmentReason = 'stock_count' | 'damaged' | 'expired' | 'lost' | 'production_variance' | 'system_correction' | 'other';
export type MovementType = 'opening' | 'purchase' | 'receipt' | 'sales' | 'issue' | 'adjustment' | 'transfer';
export type InvReportType = 'stock_summary' | 'stock_card' | 'stock_aging' | 'valuation' | 'category_summary' | 'movement' | 'adjustment' | 'transfer' | 'low_stock';

export interface AccountRef { id: string; code: string; name: string }
export interface CoaAccount extends AccountRef { classification: string | null; sub: string | null; standard_code: string | null; is_active: boolean }

export interface Warehouse { id: string; code: string; name: string; address: string | null; is_active: boolean }

export interface InvCategory {
  id: string; name: string; description: string | null; item_count: number;
  inventory_account: AccountRef | null; cogs_account: AccountRef | null; adjustment_account: AccountRef | null;
}

export interface Item {
  id: string; code: string; name: string; barcode: string | null; category_id: string | null; category: string | null; unit: string;
  min_stock: number; reorder_qty: number | null; default_warehouse_id: string | null; purchase_price: number | null; sale_price: number | null;
  description: string | null; status: 'active' | 'inactive'; stock_status: StockStatus; qty: number; avg_cost: number; value: number;
  stock_by_warehouse: { warehouse_id: string; warehouse: string; qty: number }[];
}

export interface Movement {
  id: string; date: string; reference_no: string; type: MovementType; is_reversal: boolean; document_id: string;
  item_id: string; item_code: string | null; item_name: string | null; unit: string | null; warehouse_id: string; warehouse: string | null;
  source: string | null; qty_in: number; qty_out: number; unit_cost: number; value_in: number; value_out: number; balance: number | null;
}

export interface ItemDetail extends Item { movements: Movement[] }

export interface DocLine {
  id: string; line_no: number; item_id: string; item_code: string | null; item_name: string | null; unit: string | null;
  quantity: number; system_qty: number | null; counted_qty: number | null; unit_cost: number | null; amount: number | null;
  source_line_id: string | null; notes: string | null;
}

export interface JournalLine { line_no: number; account_code: string; account_name: string; description: string | null; debit: number; credit: number }

export interface InvJournal {
  id: string; journal_no: string; journal_type: 'receipt' | 'issue' | 'adjustment'; journal_date: string; document_id: string | null;
  reference: string | null; description: string | null; amount: number; status: 'posted' | 'reversed'; posted_by_name: string | null;
  posted_at: string | null; reversal_date: string | null; reversal_reason: string | null; lines?: JournalLine[];
}

export interface StockDoc {
  id: string; doc_no: string; doc_type: DocType; doc_date: string; warehouse_id: string; warehouse: string | null;
  to_warehouse_id: string | null; to_warehouse: string | null; reason: AdjustmentReason | null; source_type: 'purchase' | 'sales' | null;
  source_id: string | null; source_ref: string | null; notes: string | null; post_journal: boolean; offset_account: AccountRef | null;
  offset_coa_id: string | null; total_qty: number; total_value: number; status: DocStatus; journal_id: string | null;
  created_by_name: string | null; created_at: string; posted_by_name: string | null; posted_at: string | null;
  void_date: string | null; void_reason: string | null; voided_by_name: string | null;
  item_code?: string | null; item_name?: string | null; lines?: DocLine[]; journal?: InvJournal;
}

export interface InvOverview {
  as_of: string;
  kpi: { total_items: number; total_value: number; low_stock: number; out_of_stock: number; warehouses: number; categories: number };
  trend: { month: string; value: number; qty: number }[];
  by_category: { category: string; value: number; qty: number; items: number }[];
  top_items: Item[];
  low_stock_items: Item[];
}

export interface SourceDoc {
  id: string; number: string; date: string; party: string | null; total: number; open_qty: number;
  lines: { line_id: string; item_code: string | null; description: string; unit: string | null; quantity: number; processed_qty: number;
    open_qty: number; unit_cost: number | null; matched_item_id: string | null }[];
}

export interface InvReport {
  report_type: InvReportType; period: { from: string; to: string }; client_name: string;
  rows: Record<string, unknown>[];
  item?: { code: string; name: string; unit: string };
  summary?: { total_value: number; total_sku: number; categories: number; warehouses: number };
}

export interface DocLineInput { item_id: string; quantity: number; counted_qty?: number | null; unit_cost?: number | null; source_line_id?: string | null; notes?: string | null }
export interface DocInput {
  doc_type: DocType; doc_date: string; warehouse_id: string; to_warehouse_id?: string | null; reason?: AdjustmentReason | null;
  source_type?: 'purchase' | 'sales' | null; source_id?: string | null; source_ref?: string | null; notes?: string | null;
  post_journal: boolean; offset_coa_id?: string | null; lines: DocLineInput[]; post_now: boolean;
}
export interface ItemInput {
  code?: string | null; name: string; barcode?: string | null; category_id?: string | null; unit: string; min_stock: number; reorder_qty?: number | null;
  default_warehouse_id?: string | null; purchase_price?: number | null; sale_price?: number | null; description?: string | null; status: 'active' | 'inactive';
}

// ============================================================
// API
// ============================================================

const c = (clientId: string) => ({ client_id: clientId });

export const fetchInvAccounts = (clientId: string, s?: AbortSignal) => api.get<CoaAccount[]>('/accounts', c(clientId), s);
export const fetchWarehouses = (clientId: string, s?: AbortSignal) => api.get<Warehouse[]>('/warehouses', c(clientId), s);
export const saveWarehouse = (clientId: string, body: { code?: string | null; name: string; address?: string | null; is_active: boolean }, id?: string) =>
  api.send<Warehouse>(id ? 'PUT' : 'POST', id ? `/warehouses/${id}` : '/warehouses', { client_id: clientId, ...body });
export const deleteWarehouse = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/warehouses/${id}`, undefined, c(clientId));
export const fetchInvCategories = (clientId: string, s?: AbortSignal) => api.get<InvCategory[]>('/categories', c(clientId), s);
export const saveInvCategory = (clientId: string, body: { name: string; description?: string | null; inventory_coa_id: string | null; cogs_coa_id: string | null; adjustment_coa_id: string | null }, id?: string) =>
  api.send<InvCategory>(id ? 'PUT' : 'POST', id ? `/categories/${id}` : '/categories', { client_id: clientId, ...body });
export const deleteInvCategory = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/categories/${id}`, undefined, c(clientId));
export const seedInvCategories = (clientId: string) => api.send<{ created: string[] }>('POST', '/categories/seed-from-coa', c(clientId));

export const fetchItems = (clientId: string, asOf: string, s?: AbortSignal) =>
  api.get<{ as_of: string; items: Item[]; next_code: string }>('/items', { ...c(clientId), as_of: asOf }, s);
export const fetchItem = (clientId: string, id: string, asOf: string, s?: AbortSignal) => api.get<ItemDetail>(`/items/${id}`, { ...c(clientId), as_of: asOf }, s);
export const saveItem = (clientId: string, body: ItemInput, id?: string) =>
  api.send<Item>(id ? 'PUT' : 'POST', id ? `/items/${id}` : '/items', { client_id: clientId, ...body });
export const deleteItem = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/items/${id}`, undefined, c(clientId));
export const importItems = (clientId: string, rows: Record<string, unknown>[], updateExisting: boolean) =>
  api.send<{ created: number; updated: number; skipped: number; categories_created: string[] }>('POST', '/items/import', { client_id: clientId, rows, update_existing: updateExisting });

export const fetchInvOverview = (clientId: string, asOf: string, s?: AbortSignal) => api.get<InvOverview>('/overview', { ...c(clientId), as_of: asOf }, s);
export const fetchMovements = (clientId: string, f: { date_from?: string; date_to?: string; item_id?: string; warehouse_id?: string; type?: string }, s?: AbortSignal) =>
  api.get<{ movements: Movement[]; totals: { qty_in: number; qty_out: number; value_in: number; value_out: number } }>('/movements', { ...c(clientId), ...f }, s);

export const fetchDocuments = (clientId: string, f: { doc_type?: DocType; date_from?: string; date_to?: string; status?: DocStatus }, s?: AbortSignal) =>
  api.get<StockDoc[]>('/documents', { ...c(clientId), ...f }, s);
export const fetchDocument = (clientId: string, id: string, s?: AbortSignal) => api.get<StockDoc>(`/documents/${id}`, c(clientId), s);
export const saveDocument = (clientId: string, body: DocInput, id?: string) =>
  api.send<StockDoc>(id ? 'PUT' : 'POST', id ? `/documents/${id}` : '/documents', { client_id: clientId, ...body });
export const deleteDocument = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/documents/${id}`, undefined, c(clientId));
export const postDocument = (clientId: string, id: string) => api.send<StockDoc>('POST', `/documents/${id}/post`, c(clientId));
export const voidDocument = (clientId: string, id: string, reason: string, voidDate?: string) =>
  api.send<StockDoc>('POST', `/documents/${id}/void`, { client_id: clientId, reason, void_date: voidDate || null });

export const fetchPurchaseSources = (clientId: string, s?: AbortSignal) => api.get<SourceDoc[]>('/sources/purchases', c(clientId), s);
export const fetchSalesSources = (clientId: string, s?: AbortSignal) => api.get<SourceDoc[]>('/sources/sales', c(clientId), s);

export const fetchInvReport = (clientId: string, type: InvReportType, f: { date_from: string; date_to: string; category_id?: string; warehouse_id?: string; item_id?: string }, s?: AbortSignal) =>
  api.get<InvReport>(`/reports/${type}`, { ...c(clientId), ...f }, s);

// ============================================================
// LABEL
// ============================================================

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  opening: 'Opening Balance', receipt: 'Goods Receipt', issue: 'Goods Issue', adjustment: 'Adjustment', transfer: 'Transfer',
};
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  opening: 'Opening', purchase: 'Purchase', receipt: 'Receipt', sales: 'Sales', issue: 'Issue', adjustment: 'Adjustment', transfer: 'Transfer',
};
export const MOVEMENT_STYLE: Record<MovementType, string> = {
  opening: 'bg-slate-100 text-slate-700', purchase: 'bg-emerald-50 text-emerald-700', receipt: 'bg-emerald-50 text-emerald-700',
  sales: 'bg-sky-50 text-sky-700', issue: 'bg-sky-50 text-sky-700', adjustment: 'bg-amber-50 text-amber-700', transfer: 'bg-violet-50 text-violet-700',
};
export const STOCK_STATUS_LABEL: Record<StockStatus, string> = { active: 'Active', low_stock: 'Low Stock', out_of_stock: 'Out of Stock', inactive: 'Inactive' };
export const STOCK_STATUS_STYLE: Record<StockStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700', low_stock: 'bg-amber-50 text-amber-700', out_of_stock: 'bg-rose-50 text-rose-700', inactive: 'bg-slate-100 text-slate-600',
};
export const DOC_STATUS_STYLE: Record<DocStatus, string> = { draft: 'bg-amber-50 text-amber-700', posted: 'bg-emerald-50 text-emerald-700', void: 'bg-rose-50 text-rose-700' };
export const DOC_STATUS_LABEL: Record<DocStatus, string> = { draft: 'Draft', posted: 'Posted', void: 'Void' };
export const REASON_LABEL: Record<AdjustmentReason, string> = {
  stock_count: 'Stock Count', damaged: 'Damaged Goods', expired: 'Expired', lost: 'Lost / Missing', production_variance: 'Production Variance',
  system_correction: 'System Correction', other: 'Other',
};
export const INV_REPORTS: { type: InvReportType; label: string; description: string }[] = [
  { type: 'stock_summary', label: 'Stock Summary', description: 'Opening, in, out and closing quantity with closing value per item.' },
  { type: 'stock_card', label: 'Stock Card', description: 'Running balance of one item: every movement with quantity and value.' },
  { type: 'stock_aging', label: 'Stock Aging', description: 'On-hand quantity by age since receipt (FIFO layers).' },
  { type: 'valuation', label: 'Inventory Valuation', description: 'Quantity, average cost and value per item and warehouse.' },
  { type: 'category_summary', label: 'Category Summary', description: 'Inventory value per category with composition chart.' },
  { type: 'movement', label: 'Movement Report', description: 'All stock movements in the period.' },
  { type: 'adjustment', label: 'Adjustment Report', description: 'Posted stock adjustments with reason and value.' },
  { type: 'transfer', label: 'Transfer Report', description: 'Posted transfers between warehouses.' },
  { type: 'low_stock', label: 'Low Stock Report', description: 'Items at or below minimum stock with suggested order quantity.' },
];

const fmtQty = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 });
export const qty = (n: number | null | undefined) => (n === null || n === undefined ? '—' : fmtQty.format(n));
