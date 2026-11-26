-- OPSIONAL: isi Due Date transaksi hasil import yang SUDAH dibuat. Jalankan SELECT dulu.
-- sudo -u postgres psql -d gouf -f backfill_due_date.sql
SELECT count(*) AS akan_diubah FROM financial_transaction_purchase_transactions
WHERE due_date IS NULL AND source_doc_type = 'Import' AND purchase_date IS NOT NULL
  AND payment_status <> 'non_cash' AND deleted_at IS NULL;
-- Hapus tanda -- kalau jumlahnya sesuai:
-- UPDATE financial_transaction_purchase_transactions SET due_date = purchase_date + 30
--  WHERE due_date IS NULL AND source_doc_type = 'Import' AND purchase_date IS NOT NULL
--    AND payment_status <> 'non_cash' AND deleted_at IS NULL;
