import { redirect } from 'next/navigation';

// Halaman Zafeb AI sudah diganti bubble chat di pojok kanan bawah (components/ChatWidget.tsx).
// Link/bookmark lama ke /zafeb-ai dialihkan ke Overview.
export default function ZafebAIPage() {
  redirect('/');
}
