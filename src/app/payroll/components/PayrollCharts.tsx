'use client';
import React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const fmtM = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}M` : v >= 1e6 ? `${Math.round(v / 1e6)}Jt` : `${Math.round(v / 1e3)}Rb`);
const fmtFull = (v: number) => `Rp ${Math.round(v).toLocaleString('id-ID')}`;

export function TrendChart({ data }: { data: { label: string; gross: number; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtM} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip formatter={(v: number) => fmtFull(v)} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="gross" name="Gaji bruto" fill="#0E2F26" radius={[4, 4, 0, 0]} />
        <Bar dataKey="cost" name="Total biaya perusahaan" fill="#22C55E" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DepartmentChart({ data }: { data: { name: string; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tickFormatter={fmtM} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={96} />
        <Tooltip formatter={(v: number) => fmtFull(v)} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        <Bar dataKey="cost" name="Biaya" fill="#0E2F26" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
