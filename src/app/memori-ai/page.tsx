import React from 'react';
import MemoriAIView from './MemoriAIView';

export const metadata = { title: 'Memori AI — Gouf Consulting' };

// Halaman untuk melihat, menambah, mengubah, dan menghapus "ingatan" AI
// (hasil belajar dari percakapan suara & Zafeb AI). Backend: backend/memori_ai.py
export default function MemoriAIPage() {
  return <MemoriAIView />;
}