"use client";
import "./DeteksiKesalahanResults.css";

// Label & urutan tampil -- harus sinkron dengan
// modules/deteksi_kesalahan_pembelian.py::DAFTAR_PENGECEKAN
const LABEL_CHECK = {
  po_invoice: "🔗 Pencocokan PO ↔ Invoice",
  pph23_jasa: "🧾 Deteksi PPh 23 atas Jasa",
  harga_tidak_wajar: "💰 Deteksi Harga Tidak Wajar (Riwayat)",
  supplier_baru: "🆕 Deteksi Supplier Baru",
  validasi_tanggal: "📅 Validasi Tanggal",
  rekap_supplier: "📊 Rekap per Supplier",
  cross_check_ap_aging: "📑 Cross-check ke AP Aging",
};
const URUTAN_CHECK = [
  "po_invoice", "pph23_jasa", "harga_tidak_wajar", "supplier_baru",
  "validasi_tanggal", "rekap_supplier", "cross_check_ap_aging",
];

// Status yang dianggap "aman/hijau" vs "perlu perhatian/kuning-merah".
const STATUS_AMAN = new Set(["MATCHED", "OK", "OK_ADA_BUKTI_POTONG"]);

function formatNilai(v) {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number") {
    return Number.isInteger(v) ? v.toLocaleString("id-ID") : `Rp${v.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
  }
  return String(v);
}

function Ringkasan({ ringkasan }) {
  if (!ringkasan || Object.keys(ringkasan).length === 0) return null;
  const entries = Object.entries(ringkasan).filter(
    ([k, v]) => k !== "catatan" && typeof v !== "object"
  );
  return (
    <div className="dkp-ringkasan">
      {entries.map(([k, v]) => (
        <div key={k} className="dkp-ringkasan-item">
          <span className="dkp-ringkasan-label">{k.replaceAll("_", " ")}</span>
          <span className="dkp-ringkasan-value">{formatNilai(v)}</span>
        </div>
      ))}
      {ringkasan.catatan && <p className="dkp-catatan">ℹ️ {ringkasan.catatan}</p>}
    </div>
  );
}

function BarisHasil({ baris }) {
  const status = baris.status;
  const aman = status ? STATUS_AMAN.has(status) : null;
  // Field yang ditampilkan sbg judul baris -- ambil kombinasi yang paling relevan.
  const judul = [
    baris.nomor_invoice || baris.nomor_po || baris.nomor_dokumen,
    baris.nama_supplier,
    baris.nama_barang,
  ].filter(Boolean).join(" · ") || `Baris ${baris.baris ?? ""}`;

  const alasanList = Array.isArray(baris.alasan) ? baris.alasan : (baris.catatan ? [baris.catatan] : []);

  return (
    <div className={`dkp-baris ${aman === true ? "dkp-baris-ok" : aman === false ? "dkp-baris-warn" : ""}`}>
      <div className="dkp-baris-top">
        <span className="dkp-baris-judul">{judul}</span>
        {status && <span className={`dkp-badge ${aman ? "dkp-badge-ok" : "dkp-badge-warn"}`}>{status.replaceAll("_", " ")}</span>}
      </div>
      {alasanList.length > 0 && (
        <ul className="dkp-alasan-list">
          {alasanList.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
    </div>
  );
}

function TabelRekapSupplier({ hasil }) {
  if (!hasil || hasil.length === 0) return null;
  return (
    <div className="dkp-tabel-wrap">
      <table className="dkp-tabel">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Total Invoice</th>
            <th>Total PO</th>
            <th>Item Unik</th>
            <th>Perlu Review</th>
          </tr>
        </thead>
        <tbody>
          {hasil.map((s, i) => (
            <tr key={i}>
              <td>{s.nama_supplier}</td>
              <td>{formatNilai(s.total_nilai_invoice)}</td>
              <td>{formatNilai(s.total_nilai_po)}</td>
              <td>{s.jumlah_item_unik}</td>
              <td>{s.jumlah_perlu_review > 0 ? <span className="dkp-badge dkp-badge-warn">{s.jumlah_perlu_review}</span> : "0"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OneCheckCard({ kodeCheck, data }) {
  const hasil = data?.hasil || [];
  const ringkasan = data?.ringkasan || {};
  const isRekap = kodeCheck === "rekap_supplier";

  return (
    <div className="dkp-card">
      <div className="dkp-card-header">{LABEL_CHECK[kodeCheck] || kodeCheck}</div>
      <Ringkasan ringkasan={ringkasan} />

      {isRekap ? (
        <TabelRekapSupplier hasil={hasil} />
      ) : hasil.length > 0 ? (
        <div className="dkp-baris-list">
          {hasil.map((b, i) => <BarisHasil key={i} baris={b} />)}
        </div>
      ) : (
        <p className="dkp-kosong">Tidak ada temuan untuk dilaporkan. ✅</p>
      )}
    </div>
  );
}

/**
 * DeteksiKesalahanResults -- render hasil dari
 * POST /api/client/{id}/deteksi-kesalahan-pembelian
 * (bentuk: { [kode_check]: { hasil: [...], ringkasan: {...} } })
 */
export default function DeteksiKesalahanResults({ hasilPerCheck }) {
  if (!hasilPerCheck || Object.keys(hasilPerCheck).length === 0) return null;
  const kodeTerurut = URUTAN_CHECK.filter((k) => k in hasilPerCheck);

  return (
    <div className="dkp-results">
      {kodeTerurut.map((kode) => (
        <OneCheckCard key={kode} kodeCheck={kode} data={hasilPerCheck[kode]} />
      ))}
    </div>
  );
}