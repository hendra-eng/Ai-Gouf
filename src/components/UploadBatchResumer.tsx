'use client';

// Melanjutkan batch upload (Sales / Purchase / Cash & Bank) yang terputus karena halaman di-refresh
// atau browser ditutup, plus memulihkan antrian review rekening koran. Dipasang SEKALI di AppLayout
// (bukan di halaman upload), jadi jalan di halaman mana pun user mendarat setelah refresh.
// Tidak merender apa pun.

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import { lanjutkanBatchTersimpan } from '@/lib/uploadBatch';
import { buatHandlerPurchase, buatHandlerSales } from '@/lib/uploadBatchHandlers';
import { buatHandlerBank, pulihkanAntrianReview } from '@/app/transactions/bank-cash/lib/bankUploadBatch';

export default function UploadBatchResumer() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!user?.id) return; // tunggu sesi login siap (request upload butuh token)
    void pulihkanAntrianReview();
    void lanjutkanBatchTersimpan((modul, clientId) => {
      if (modul === 'sales') return buatHandlerSales(clientId, (teks) => tRef.current(teks));
      if (modul === 'purchase') return buatHandlerPurchase(clientId);
      if (modul === 'bankcash') return buatHandlerBank(clientId);
      return null;
    });
  }, [user?.id]);

  return null;
}
