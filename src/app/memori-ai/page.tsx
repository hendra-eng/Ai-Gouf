import React from 'react';
import MemoriAIView from './MemoriAIView.tsx';

export const metadata = { title: 'Memori AI — Gouf Consulting' };

// Halaman untuk melihat, menambah, mengubah, dan menghapus "ingatan" AI
// (hasil belajar dari percakapan suara & Agent AI). Backend: backend/memori_ai.py
export default function MemoriAIPage() {
  return <MemoriAIView />;
}