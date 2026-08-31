'use client';
import React from 'react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface Dimension { label: string; score: number; }
interface Props { dimensions: Dimension[]; }

export default function HealthRadarInner({ dimensions }: Props) {
  const data = dimensions.map((d) => ({ subject: d.label, score: d.score, fullMark: 100 }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12, fontWeight: 500 }}
        />
        <Tooltip
          formatter={(value: number) => [`${value}/100`, 'Score']}
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            fontSize: '12px',
            color: 'var(--foreground)',
          }}
        />
        <Radar
          name="Financial Health"
          dataKey="score"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={{ fill: 'var(--primary)', r: 4, strokeWidth: 0 }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
