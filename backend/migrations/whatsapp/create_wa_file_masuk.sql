-- File yang masuk ke nomor WhatsApp pengguna (hanya metadata; Neo "sadar" ada file masuk).
create table if not exists wa_file_masuk (
    id            bigserial primary key,
    pemilik       text        not null,              -- = memori_ai.pemilik_dari_user(user) (username)
    pengirim      text,                              -- nomor pengirim
    nama_file     text,
    mime          text,
    ukuran_byte   bigint,
    pesan         text,                              -- caption / teks yang menyertai file
    wa_message_id text unique,                       -- id pesan dari WhatsApp (cegah dobel)
    diterima_at   timestamptz not null default now()
);
create index if not exists idx_wa_file_masuk_pemilik_waktu on wa_file_masuk (pemilik, diterima_at desc);
