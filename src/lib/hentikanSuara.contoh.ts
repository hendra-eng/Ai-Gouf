// hentikanSuara.contoh.ts
// Contoh kalimat untuk menguji / mendokumentasikan bacaBerhenti() (lihat hentikanSuara.uji.ts).
// Tambah kalimat baru di sini kalau menemukan ucapan yang belum dikenali, lalu jalankan uji.

// ---------- Kalimat yang HARUS menghentikan Neo ----------
export const CONTOH_BERHENTI: Record<string, string[]> = {
  '[BARU] sudah tahu / dapat gambarannya': [
    'aku udah tau itu', 'udah tau itu neo', 'udah kebayang', 'udah dapet gambarannya', 'oke gambarannya udah dapet', 'intinya udah jelas',
    'oke noted', 'noted neo', 'gotcha', 'oke jelas neo', 'jelas neo', 'udah jelas kok', 'roger neo',
  ],
  '[BARU] mengambil giliran bicara': [
    'neo neo', 'neo dengerin dulu', 'dengerin aku dulu', 'neo aku mau ngomong', 'aku mau ngomong dulu', 'aku mau bicara sebentar',
    'biar aku bicara dulu', 'biar aku yang jelasin', 'giliranku', 'giliran aku neo', 'potong dulu ya', 'maaf neo aku potong', 'permisi neo', 'maaf neo', 'excuse me neo',
  ],
  '[BARU] jeda / tidak perlu lagi / jenuh': [
    'break dulu', 'istirahat dulu neo', 'gitu aja neo', 'gitu aja deh', 'udah nggak perlu', 'tidak perlu lagi neo', 'ga usah lagi neo',
    'bosen dengernya', 'ngantuk dengernya', 'pusing dengerinnya neo', 'jenuh banget nih',
  ],
  'stop': [
    'stop', 'stop neo', 'neo stop', 'stop dulu', 'stop dulu neo', 'stop dulu deh', 'stop stop', 'stop stop stop', 'stop disana',
    'stop di sini', 'stop disitu', 'stop sampai situ', 'stop sampai di sini', 'setop', 'setop neo', 'stop it', 'stop it neo',
    'stop talking', 'stop explaining', 'stop explaining neo', 'please stop', 'okay stop', 'oke stop', 'oke stop neo', 'eh stop',
    'stoop', 'stooop neo', 'sttop', 'stop ya', 'stop dong', 'stop deh', 'stop di situ aja', 'stop sampai disini saja', 'stop menjelaskan',
    'stop bicara', 'stop ngomong', 'stop ngomong neo', 'neo stop dulu ya',
  ],
  'berhenti': [
    'berhenti', 'berhenti neo', 'neo berhenti', 'berhenti dulu', 'berhenti dulu neo', 'berhenti ngomong', 'berhenti bicara',
    'berhenti menjelaskan', 'berhenti dong', 'berhenti deh', 'berhenti di situ', 'berhenti sampai situ', 'berhenti disini',
    'tolong berhenti', 'tolong berhenti neo', 'neo tolong berhenti', 'oke berhenti', 'oke berhenti neo', 'udah berhenti',
    'udah berhenti dulu', 'hentikan', 'hentikan neo', 'hentikan penjelasannya', 'hentikan dulu', 'tolong hentikan', 'neo hentikan',
    'hentiin', 'hentiin dong', 'brenti', 'brenti neo', 'berenti dulu', 'berhentilah neo', 'berhentilah', 'hentikanlah',
    'bisa berhenti sekarang neo', 'neo bisa berhenti sekarang', 'tolong hentikan penjelasannya sekarang', 'berhenti sebentar neo',
    'sudahi saja', 'sudahi penjelasannya', 'udahin aja', 'akhiri penjelasannya', 'akhiri aja neo',
  ],
  'cukup / sudah / udah': [
    'cukup', 'cukup neo', 'cukup cukup', 'cukup dulu', 'cukup sampai sini', 'cukup sampai situ', 'cukup segitu', 'cukup segitu aja',
    'cukup itu aja', 'cukup ya', 'cukup deh', 'cukup dong', 'cukup sekian', 'cukup penjelasannya', 'cukup penjelasannya neo',
    'penjelasannya cukup', 'cukup untuk sekarang', 'cukup untuk hari ini', 'udah cukup', 'sudah cukup', 'udah cukup neo',
    'sudah cukup neo', 'oke sudah cukup neo', 'oke udah cukup', 'oke udah itu aja cukup', 'oke udah itu aja', 'udah itu aja',
    'udah itu aja cukup', 'sudah itu saja', 'sudah itu saja cukup', 'udah cukup deh', 'udah cukup ya', 'udah cukup dong',
    'udah deh', 'udah dong', 'udah ya', 'udah neo', 'udah udah', 'udah udah neo', 'sudah sudah', 'sudah sudah neo', 'sudahlah',
    'sudahlah neo', 'udahlah', 'dahlah', 'dah cukup', 'dah udah', 'ya sudah', 'ya udah', 'yaudah', 'yaudah deh', 'yaudah cukup',
    'ya udah cukup', 'oke sudah', 'oke udah', 'oke deh udah', 'nah udah', 'eh udah cukup', 'sekian', 'sekian saja', 'sekian aja',
    'sekian dulu', 'itu aja', 'itu saja', 'itu dulu', 'itu dulu aja', 'itu cukup', 'segitu aja', 'segitu cukup', 'segitu dulu',
    'begitu saja', 'ini aja', 'ini cukup', 'oke itu saja cukup terima kasih neo', 'baik terima kasih sudah cukup', 'sudah cukup neo terima kasih',
    'oke cukup sampai di situ', 'oke neo cukup sampai di situ', 'cukup ya neo jangan lanjut lagi', 'udah cukup ya neo jangan lanjut lagi',
    'oke udah cukup itu aja penjelasannya', 'oke itu sudah cukup jelas', 'ok sampai sini dulu ya neo', 'oke sampai situ aja',
    'oke ok sampai sini aja ya', 'cukup cukup neo aku udah ngerti', 'cukup sampai disitu neo',
  ],
  'tunggu / sebentar / tahan': [
    'tunggu', 'tunggu dulu', 'tunggu sebentar', 'tunggu bentar', 'tunggu neo', 'tunggu tunggu', 'tunggu dulu neo', 'sebentar',
    'sebentar neo', 'sebentar sebentar', 'sebentar dulu', 'bentar', 'bentar bentar', 'bentar dulu', 'bentar neo', 'eh tunggu',
    'eh sebentar', 'eh bentar', 'eh eh tunggu', 'oke tunggu dulu', 'oke sebentar', 'tahan', 'tahan dulu', 'tahan dulu neo',
    'tahan sebentar', 'jeda', 'jeda dulu', 'jeda sebentar', 'jeda neo', 'pause', 'pause dulu', 'pause neo', 'wait', 'wait wait',
    'wait a second', 'wait a moment', 'wait neo', 'hold on', 'hold on neo', 'hold up', 'hang on', 'one sec', 'one second',
    'just a moment', 'just a second', 'tunggu sebentar aku mau tanya', 'berhenti dulu neo aku mau tanya yang lain',
    'stop neo aku mau bertanya hal lain', 'eh neo tunggu dulu sebentar',
  ],
  'kepanjangan / bertele-tele': [
    'kepanjangan', 'kepanjangan neo', 'kamu menjelaskannya kepanjangan', 'penjelasanmu kepanjangan', 'jawabannya kepanjangan',
    'kepanjangan banget', 'terlalu panjang', 'terlalu panjang neo', 'penjelasannya terlalu panjang', 'kamu terlalu panjang menjelaskannya',
    'panjang banget', 'panjang amat neo', 'panjang bener', 'kelamaan', 'kelamaan neo', 'kelamaan banget', 'kelamaan ngomongnya',
    'terlalu lama', 'lama banget', 'lama amat', 'bertele-tele', 'kamu bertele-tele', 'bertele tele banget', 'berbelit-belit',
    'muter-muter', 'ngelantur', 'kamu ngelantur', 'neo kamu melantur', 'kebanyakan ngomong', 'kebanyakan bicara', 'kebanyakan cerita',
    'kebanyakan penjelasan', 'terlalu banyak bicara', 'banyak omong', 'cerewet', 'bawel', 'kamu bawel', 'neo bawel banget', 'berisik',
    'berisik neo', 'kamu berisik', 'ngoceh terus', 'jangan ceramah', 'kayak ceramah aja', 'nggak kelar kelar', 'gak kelar-kelar',
    'too long', 'that is too long', 'you talk too much', 'youre talking too long', 'too much', 'too wordy', 'long-winded',
    'wah kepanjangan neo', 'waduh panjang banget penjelasannya', 'aduh neo kelamaan ngomongnya', 'neo kamu bicaranya terlalu panjang',
    'kamu terlalu banyak bicara neo', 'penjelasanmu bertele-tele', 'kamu bicaranya kebanyakan',
  ],
  'jangan dilanjutkan / tidak usah dijelaskan': [
    'jangan dilanjutkan', 'jangan lanjutkan', 'jangan dilanjut', 'jangan lanjut', 'jangan lanjutin', 'jangan dilanjutin',
    'jangan diteruskan', 'jangan diterusin', 'jangan teruskan', 'jangan terusin', 'jangan lanjut neo', 'neo jangan dilanjutkan',
    'tidak usah dilanjutkan', 'tidak usah dilanjut', 'gak usah dilanjut', 'ga usah dilanjutin', 'nggak usah dilanjutin',
    'nggak perlu dilanjutkan', 'tidak perlu dilanjutkan', 'tidak usah diteruskan', 'gak usah diterusin', 'gak usah dijelasin',
    'ga usah dijelasin', 'nggak usah dijelasin lagi', 'tidak usah dijelaskan', 'tidak perlu dijelaskan', 'tidak perlu dijelaskan lagi',
    'tidak perlu penjelasan lagi', 'ga perlu penjelasan', 'jangan dijelaskan lagi', 'jangan dijelasin lagi', 'jangan jelasin lagi',
    'jangan menjelaskan lagi', 'jangan jelaskan', 'jangan bicara lagi', 'jangan ngomong lagi', 'jangan ngomong terus',
    'jangan bicara terus', 'jangan berbicara', 'jangan cerita lagi', 'jangan bercerita lagi', 'ga usah ngomong', 'gak usah bicara',
    'gak usah ngomong lagi', 'nggak usah cerita', 'jangan bahas lagi', 'jangan dibahas', 'gak usah bahas', 'jangan dibaca',
    'tidak perlu dibaca semua', 'ga usah baca semua', 'jangan sebutin semua', 'tidak usah disebutkan', 'jangan panjang panjang',
    'jangan panjang-panjang', 'ga usah panjang panjang', 'jangan terlalu panjang', 'tidak usah terlalu panjang', 'jangan terlalu detail',
    'ga usah detail', 'tidak perlu rinci', 'tidak usah terlalu rinci', 'stop disana neo jangan dilanjutkan', 'neo sudah ya jangan dilanjutkan lagi',
    'ya udah gak usah diterusin', 'eh neo gak usah dijelasin semuanya', 'udah neo udah jangan diterusin', 'oke aku sudah paham tidak usah dijelaskan lagi',
    'lanjutkan nanti aja', 'lanjut nanti', 'lanjutin besok', 'diteruskan nanti', 'nanti aja', 'nanti dulu', 'nanti lagi', 'besok aja',
    'besok lagi', 'ntar aja', 'lain kali aja', 'kapan kapan aja',
  ],
  'sudah paham': [
    'aku sudah paham', 'saya sudah paham', 'aku udah paham neo', 'udah paham', 'sudah paham', 'udah paham kok', 'aku paham', 'saya paham',
    'saya mengerti', 'aku ngerti', 'aku ngerti kok', 'udah ngerti', 'sudah mengerti', 'udah ngerti neo', 'udah ngerti kok', 'sudah jelas',
    'udah jelas', 'udah jelas kok', 'udah jelas neo', 'sudah jelas terima kasih', 'cukup jelas', 'sudah sangat jelas', 'aku sudah tahu',
    'saya udah tau', 'udah tau', 'udah tau kok', 'aku udah tau neo', 'oke paham', 'oke paham neo', 'iya paham', 'iya iya paham',
    'paham paham', 'ngerti ngerti', 'oke ngerti', 'siap paham', 'paham kok', 'paham banget', 'oh paham', 'udah dapet', 'sudah dapat',
    'aku udah dapet kok', 'oke oke', 'iya iya', 'ya ya', 'i get it', 'i got it', 'got it', 'okay got it', 'i understand', 'i understood',
    'understood', 'i know', 'i know already', 'i get it already', 'i understand now', 'i get it thanks',
  ],
  'lupakan / tidak jadi': [
    'nggak jadi', 'gak jadi', 'ga jadi deh', 'tidak jadi', 'tidak jadi neo', 'nggak jadi deh neo', 'lupakan', 'lupakan saja', 'lupain aja',
    'lupain', 'abaikan', 'abaikan saja', 'never mind', 'nevermind', 'forget it', 'ignore that', 'skip aja', 'skip itu', 'skip this',
    'lewati', 'lewati itu', 'lewati saja', 'lewatin aja',
  ],
  'diam / mute': [
    'diam', 'diam neo', 'neo diam', 'diam dulu', 'diam dulu neo', 'diam deh', 'diam dong', 'diam aja', 'diamlah', 'diem', 'diem dulu',
    'diem neo', 'diem deh', 'diem lu', 'diam kamu', 'tutup mulut', 'tutup mulutmu', 'tutup mulut neo', 'matikan suara', 'matikan suaranya',
    'matiin suaranya', 'matikan suara neo', 'mute', 'mute neo', 'mute dulu', 'mute suaranya', 'shh', 'sst', 'sssst', 'shush', 'quiet',
    'quiet neo', 'be quiet', 'be quiet neo', 'silence', 'shut up', 'shut up neo',
  ],
  'bahasa Inggris': [
    'thats enough', "that's enough", 'that is enough', 'enough', 'enough neo', 'enough already', 'okay enough', "ok that's enough",
    'thats all', "that's all neo", "that's it", 'no more', 'no more please', "don't continue", 'do not continue', "don't go on",
    "don't explain", 'dont keep going', 'no need to continue', 'no need to explain', 'no need to say more', "don't say more",
    "i've heard enough", 'ok ok', 'okay okay',
  ],
};

// ---------- Kombinasi otomatis: awalan x inti x akhiran (disaring dengan langkah tetap supaya jumlahnya ratusan, bukan ribuan) ----------
const AWALAN = ['', 'oke ', 'ok ', 'eh ', 'nah ', 'baik ', 'tolong ', 'neo ', 'oke neo ', 'eh neo ', 'hei neo ', 'sip ', 'ya '];
const INTI = [
  'stop', 'berhenti', 'hentikan', 'cukup', 'sudah cukup', 'udah cukup', 'udah itu aja', 'diam', 'tunggu dulu', 'kepanjangan',
  'jangan dilanjutkan', 'aku sudah paham', 'udah jelas', 'gak usah dijelasin', 'stop disana', 'nggak jadi',
];
const AKHIRAN = ['', ' neo', ' dulu', ' deh', ' dong', ' ya', ' sekarang', ' please'];

export function buatKombinasi(): string[] {
  const hasil: string[] = [];
  let i = 0;
  for (const a of AWALAN) for (const c of INTI) for (const z of AKHIRAN) {
    if (i++ % 5 === 0) hasil.push(`${a}${c}${z}`.replace(/\s+/g, ' ').trim());
  }
  return hasil;
}

// ---------- Kalimat yang TIDAK boleh menghentikan Neo ----------
// [BARU] pasangan "kata mirip, maksud beda": TIDAK boleh dianggap berhenti oleh regex (urusan AI kalau perlu)
export const CONTOH_BUKAN_BERHENTI_BARU: string[] = [
  'makasih ya tapi aku belum paham yang tadi', 'terima kasih neo tolong jelaskan lagi', 'aku udah tau itu tapi lanjutkan bagian pajaknya',
  'jelas tidak jelas angkanya', 'neo tolong hitung total penjualan', 'maaf neo bisa diulang yang tadi', 'noted tolong lanjutkan',
  'aku mau tanya berapa total ppn bulan ini', 'saya mau bicara soal laporan pajak tahun lalu dengan pak budi',
];

export const CONTOH_BUKAN_BERHENTI: string[] = [
  // jangan berhenti / belum paham / minta lanjut
  'jangan berhenti', 'jangan berhenti neo', 'jangan stop', 'jangan diam', 'tidak usah berhenti', 'belum cukup', 'belum paham',
  'belum ngerti', 'kurang jelas', 'kurang paham', 'tidak paham', 'aku tidak mengerti', 'gak ngerti', 'nggak jelas', 'tidak jelas neo',
  'lanjutkan', 'lanjut', 'oke lanjutkan neo', 'teruskan', 'terusin dong', 'go on', 'continue', 'keep going', 'ulangi', 'ulangi lagi',
  'jelaskan lagi', 'jelasin lagi dong', 'sekali lagi', 'oke lanjut', 'please continue', 'tolong ulangi', 'i dont understand',
  // pertanyaan / perintah biasa yang kebetulan memuat kata "cukup", "sudah", "sampai sini", "tunggu"
  'berapa total penjualan bulan ini', 'apakah saldo kas cukup untuk bayar gaji', 'kenapa laba rugi turun', 'buka neraca',
  'pergi ke pembelian', 'ganti client', 'buka laporan arus kas', 'berapa hutang yang sudah jatuh tempo', 'apakah invoice sudah dibayar',
  'sudah berapa invoice yang lunas', 'berapa total sampai sini', 'jelaskan neraca', 'jelaskan laba rugi bulan ini secara detail',
  'tolong jelaskan lebih detail', 'kenapa stok barang berkurang', 'bagaimana cara menghitung pph 21', 'apa itu depresiasi',
  'berapa lama umur ekonomis aset ini', 'saldo bank belum cocok dengan buku', 'kas kecil tidak cukup', 'dana tidak cukup untuk bayar pajak',
  'tunggu pembayaran dari client', 'transaksi yang belum selesai', 'apakah kamu sudah paham', 'sudah paham belum', 'apa yang sudah dibayar bulan lalu',
  'kapan jatuh tempo pajak ini', 'siapa yang sudah approve jurnal ini',
  // ucapan ringan / pengakuan / perintah lain
  'halo neo', 'terima kasih neo', 'makasih', 'oke', 'oke neo', 'ya', 'iya', 'baik', 'bagus', 'lebih pelan', 'lebih cepat', 'bahasa inggris',
  'detailnya gimana', 'bisa lebih detail', 'lebih lengkap dong', 'tambahkan contoh', 'kasih contoh', 'coba jelaskan', 'mulai',
  'sebutkan semua transaksi bulan ini', 'apa yang terjadi', 'terus gimana', 'terus bagaimana hasilnya', 'lalu apa lagi', 'kok bisa begitu',
  'oh gitu', 'menarik', 'wah', 'begitu ya', 'laporan ini cukup bagus', 'tolong tampilkan semua jurnal', 'oke buka penjualan',
];

// ---------- Kalimat berhenti yang masih membawa permintaan baru (berhenti = true, murni = false) ----------
export const CONTOH_BERHENTI_TAPI_ADA_PERTANYAAN: string[] = [
  'stop neo sekarang jelaskan laba rugi bulan ini',
  'tunggu sebentar aku mau tanya soal pajak penghasilan',
  'berhenti dulu neo aku mau tanya yang lain',
  'cukup neo sekarang buka halaman neraca saja',
];

// ---------- Gema: Neo sedang mengucapkan kalimat ini, mic menangkap kata-kata yang sama -> JANGAN dianggap perintah ----------
export const CONTOH_GEMA: { neo: string; terdengar: string }[] = [
  { neo: 'Saldo kas sudah cukup untuk membayar gaji bulan ini.', terdengar: 'sudah cukup' },
  { neo: 'Penjelasannya cukup panjang, jadi aku bagi jadi beberapa bagian.', terdengar: 'cukup' },
  { neo: 'Mohon tunggu sebentar, aku ambil datanya.', terdengar: 'sebentar' },
  { neo: 'Pembayaran sudah diterima, tinggal dijurnal.', terdengar: 'sudah' },
  { neo: 'Kalau sudah paham, kita lanjut ke bagian berikutnya.', terdengar: 'sudah paham' },
];