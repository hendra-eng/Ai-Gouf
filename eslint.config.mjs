// [BARU] Migrasi dari .eslintrc.json ke flat config -- ESLint v9 (yang
// terinstall di project ini, lihat package.json) tidak lagi membaca
// .eslintrc.json sama sekali, jadi sebelum ini `npx eslint` langsung error
// "couldn't find eslint.config.js". eslint.ignoreDuringBuilds:true di
// next.config.mjs bikin ini tidak kelihatan pas `npm run build`, tapi
// artinya lint sudah lama tidak pernah benar-benar berjalan.
//
// Dipakai FlatCompat (cara resmi Next.js utk migrasi bertahap) supaya
// preset "next" (eslint-config-next versi lama, belum expose flat config
// sendiri) tetap bisa dipakai apa adanya tanpa menulis ulang semua rule.
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next'),
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
