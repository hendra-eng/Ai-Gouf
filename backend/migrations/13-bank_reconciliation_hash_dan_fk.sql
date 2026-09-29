-- 13-bank_reconciliation_hash_dan_fk.sql
-- Sudah DITERAPKAN ke Supabase "database gouf" lewat MCP (migration:
--   bank_feed_mutation_hash_dan_index_rekonsiliasi,
--   purchase_exceptions_client_fk_ke_management_clients).
-- File ini hanya arsip supaya repo sinkron; aman dijalankan ulang (idempoten).

alter table public.bank_feed_mutation
  add column if not exists mutation_hash varchar(64),
  add column if not exists matched_at timestamptz;

create unique index if not exists uq_bank_feed_mutation_hash
  on public.bank_feed_mutation (client_id, bank_account, mutation_hash)
  where mutation_hash is not null;

create index if not exists idx_bank_feed_mutation_client_status
  on public.bank_feed_mutation (client_id, status, tanggal);

-- Semua tabel purchase/sales sudah FK client_id -> management_clients; hanya purchase_exceptions yang masih
-- ke management_users (tabel kosong saat diubah).
alter table public.financial_transaction_purchase_exceptions
  drop constraint if exists financial_transaction_purchase_exceptions_client_id_fkey;
alter table public.financial_transaction_purchase_exceptions
  add constraint financial_transaction_purchase_exceptions_client_id_fkey
  foreign key (client_id) references public.management_clients(id);
