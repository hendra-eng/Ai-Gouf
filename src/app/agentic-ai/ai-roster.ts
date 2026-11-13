// Daftar AI penghuni kantor (selain Neo, Atlas, Zeno) untuk bar profil di atas halaman Agentic AI.
// Berdiri sendiri (tanpa Three.js) supaya halaman tidak memuat scene 3D hanya untuk daftar ini.
// Nama, jenis hewan, dan warna harus sama dengan PET_LOOK di components/OfficeScene.tsx.
// Status semua AI penghuni: duduk di meja = 'bekerja' (lihat AgenticAIView).

export type AiPenghuni = {
  name: string; kind: string; room: string;
  fur: string; head: string; belly: string; dark: string; accent: string; inner: string;
};

export const AI_PENGHUNI: AiPenghuni[] = [
  { name: 'Nova', kind: 'kucing', room: 'Research', fur: '#3A3548', head: '#413B52', belly: '#6B6580', dark: '#1B1824', accent: '#F59E0B', inner: '#F4A9B8' },
  { name: 'Aria', kind: 'kelinci', room: 'Research', fur: '#F6E8EE', head: '#F8ECF1', belly: '#FFFFFF', dark: '#2A1A22', accent: '#EC6FA5', inner: '#F9A8C9' },
  { name: 'Echo', kind: 'panda', room: 'Research', fur: '#F4F4F1', head: '#F7F7F4', belly: '#FFFFFF', dark: '#22232B', accent: '#22C55E', inner: '#4B4D59' },
  { name: 'Axiom', kind: 'hantu', room: 'Asset', fur: '#8D6E4F', head: '#957554', belly: '#F0DFC2', dark: '#2B1F16', accent: '#2FA39A', inner: '#F4A93B' },
  { name: 'Byte', kind: 'penguin', room: 'Asset', fur: '#2A3552', head: '#2F3B5C', belly: '#FFFFFF', dark: '#11151F', accent: '#E5484D', inner: '#F5A524' },
  { name: 'Cipher', kind: 'beruang', room: 'Asset', fur: '#8A5A3C', head: '#93623F', belly: '#EBCBA3', dark: '#2B1B12', accent: '#D94F4F', inner: '#C98F6A' },
  { name: 'Delta', kind: 'kapibara', room: 'Asset', fur: '#B98B5E', head: '#C09266', belly: '#D9B88C', dark: '#2B1B12', accent: '#F28C28', inner: '#7A5233' },
  { name: 'Flux', kind: 'koala', room: 'Financial Statements', fur: '#9CA3AF', head: '#A5ACB8', belly: '#F1F2F5', dark: '#2B2F3A', accent: '#4CAF50', inner: '#EFE3E3' },
  { name: 'Gamma', kind: 'hamster', room: 'Financial Statements', fur: '#EBC28B', head: '#EFC890', belly: '#FFF6E8', dark: '#D49A55', accent: '#B9792E', inner: '#F6A5B5' },
  { name: 'Helix', kind: 'shiba', room: 'Financial Statements', fur: '#E0933F', head: '#E59B48', belly: '#FFF3E0', dark: '#4A2E1A', accent: '#D94F4F', inner: '#6A3F22' },
  { name: 'Ion', kind: 'domba', room: 'Financial Statements', fur: '#F8F4EC', head: '#4B4350', belly: '#FFFDF8', dark: '#1E1A22', accent: '#F28CB1', inner: '#F4A9B8' },
  { name: 'Juno', kind: 'bebek', room: 'Financial Statements', fur: '#FFD84D', head: '#FFDF5E', belly: '#FFF0A8', dark: '#2B2410', accent: '#4C8FBF', inner: '#FF9A2E' },
  { name: 'Kilo', kind: 'singa', room: 'Account Receivable', fur: '#E3A640', head: '#E8AE48', belly: '#FBE7BF', dark: '#9A5B22', accent: '#D94F4F', inner: '#F4A9B8' },
  { name: 'Lumen', kind: 'gajah', room: 'Account Receivable', fur: '#9BA6B5', head: '#A3AEBD', belly: '#E4E9EF', dark: '#2B2F3A', accent: '#5B9BD5', inner: '#F4B6C2' },
  { name: 'Matrix', kind: 'kodok', room: 'Account Receivable', fur: '#6FBF5F', head: '#78C766', belly: '#E6F4C8', dark: '#25401F', accent: '#F28CB1', inner: '#F58FA0' },
  { name: 'Nexus', kind: 'babi', room: 'Account Payable', fur: '#F6B1C0', head: '#F8B9C6', belly: '#FCD5DD', dark: '#7A3B4B', accent: '#F5C84C', inner: '#F18CA5' },
  { name: 'Omni', kind: 'sapi', room: 'Account Payable', fur: '#FAFAF7', head: '#FBFBF8', belly: '#FFFFFF', dark: '#2A2A30', accent: '#F5C84C', inner: '#F4A9B8' },
  { name: 'Pixel', kind: 'harimau', room: 'Planning', fur: '#F29A38', head: '#F5A340', belly: '#FFF1DC', dark: '#2B1B12', accent: '#2FA39A', inner: '#F4A9B8' },
  { name: 'Quark', kind: 'berangberang', room: 'Planning', fur: '#8B6A4F', head: '#94735A', belly: '#E8D3B8', dark: '#2B1B12', accent: '#4C8FBF', inner: '#6E513C' },
  { name: 'Radian', kind: 'landak', room: 'Planning', fur: '#D8B78E', head: '#E7CBA6', belly: '#FBEBD3', dark: '#6B4A33', accent: '#E5484D', inner: '#F4B6A0' },
  { name: 'Sigma', kind: 'monyet', room: 'Planning', fur: '#8A5F3E', head: '#93664A', belly: '#F0D5B0', dark: '#2B1B12', accent: '#F5C84C', inner: '#F4B6A0' },
  { name: 'Tensor', kind: 'kuda', room: 'Management', fur: '#F3EEFA', head: '#F6F1FC', belly: '#FFFFFF', dark: '#2B2140', accent: '#EC6FA5', inner: '#F9A8C9' },
  { name: 'Vector', kind: 'tupai', room: 'Management', fur: '#C9824A', head: '#D08B54', belly: '#FFF0DC', dark: '#3A2316', accent: '#8B5A2B', inner: '#F4B6A0' },
  { name: 'Orion', kind: 'rusa', room: 'Management', fur: '#C58B52', head: '#CC945C', belly: '#FBEBD3', dark: '#3A2316', accent: '#D94F4F', inner: '#F4B6A0' },
  { name: 'Theta', kind: 'alpaka', room: 'Management', fur: '#F1E4CF', head: '#F5E9D6', belly: '#FFF8EC', dark: '#3A2B22', accent: '#E5484D', inner: '#F4C6C6' },
  { name: 'Kappa', kind: 'axolotl', room: 'Management', fur: '#F8B7C9', head: '#FAC0D0', belly: '#FFE3EB', dark: '#5A2E3D', accent: '#F0658C', inner: '#F58FA0' },
  { name: 'Omega', kind: 'kura', room: 'Management', fur: '#7DBE6B', head: '#86C773', belly: '#F3E6B8', dark: '#2B3A22', accent: '#8B6B3A', inner: '#F58FA0' },
];