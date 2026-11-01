-- Neo bisa memproses file WhatsApp sampai Posted (Sales). Jalankan SETELAH create_wa_file_masuk.sql.
alter table wa_file_masuk add column if not exists url_file          text;          -- link file dari Fonnte
alter table wa_file_masuk add column if not exists path_lokal        text;          -- salinan file di server (backend/data/wa_files)
alter table wa_file_masuk add column if not exists status_proses     text;          -- null/baru, diproses, selesai, selesai_sebagian, perlu_template, gagal
alter table wa_file_masuk add column if not exists proses_mulai_at   timestamptz;
alter table wa_file_masuk add column if not exists proses_selesai_at timestamptz;
alter table wa_file_masuk add column if not exists client_id         text;          -- klien tujuan (management_clients.id)
alter table wa_file_masuk add column if not exists source_file_id    text;          -- id file di Source Data Sales (supaya proses ulang tidak upload dobel)
alter table wa_file_masuk add column if not exists hasil_proses      text;          -- ringkasan JSON
