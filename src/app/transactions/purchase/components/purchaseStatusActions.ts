import { toast } from 'sonner';
import { approvePurchaseTransactions, postPurchaseTransactions } from '@/lib/purchaseStore';

// Approve (draft -> approved) / Post (approved -> posted) + toast hasil.
// Dipakai tab Purchase Transaction (bulk) & Purchase Preview (1 transaksi).
// Return jumlah transaksi yang berhasil diproses.
export async function runPurchaseStatusAction(action: 'approve' | 'post', ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const verb = action === 'approve' ? 'approved' : 'posted';
  try {
    const hasil = action === 'approve' ? await approvePurchaseTransactions(ids) : await postPurchaseTransactions(ids);
    if (hasil.done.length > 0) {
      toast.success(`${hasil.done.length} transaction(s) ${verb}`, {
        description: action === 'post' ? 'They now appear in the Posted tab and the financial statements.' : 'Ready to be posted.',
      });
    }
    if (hasil.skipped.length > 0) {
      const contoh = hasil.skipped.slice(0, 5).map(s => `${s.purchase_no ?? '?'}: ${s.reason}`).join('\n');
      const sisa = hasil.skipped.length > 5 ? `\n…and ${hasil.skipped.length - 5} more.` : '';
      toast.warning(`${hasil.skipped.length} transaction(s) not ${verb}`, { description: contoh + sisa, duration: 12000 });
    }
    return hasil.done.length;
  } catch (err) {
    toast.error(`Failed to ${action} transactions`, { description: err instanceof Error ? err.message : undefined });
    return 0;
  }
}
