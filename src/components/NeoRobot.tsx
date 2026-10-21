'use client';
// NeoRobot — wajah/maskot AI voice "Neo": robot biru gelap (serasi dengan tema hijau aplikasi) berwajah layar.
// 4 keadaan: off (sistem mati), listen (mendengarkan), think (berpikir), speak (bicara, mulut bergerak).
// [BARU] Saat robot DITARIK (prop menyeret + gerak): badan menoleh sedikit, wajah & tangan tertinggal berlawanan arah tarikan,
// antena melengkung ditiup angin, dan wajah berubah jadi ekspresi kaget (mata besar, alis cemas, mulut bergelombang).
// Murni SVG + CSS (tanpa library/gambar). Dipakai oleh VoiceAssistant.tsx.

import React, { useEffect, useRef } from 'react';

export type NeoMode = 'off' | 'listen' | 'think' | 'speak';
// Kecepatan tarikan (piksel/frame, sudah dihaluskan) + waktu event gerak terakhir. Diisi oleh VoiceAssistant.
export type NeoGerak = { vx: number; vy: number; t: number };

const CSS = `
.neo-bob{animation:neo-bob 3.2s ease-in-out infinite}
@keyframes neo-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.neo-fb{transform-box:fill-box;transform-origin:center}
.neo-eye{transition:all .25s}
.neo-eye .neo-c,.neo-eye .neo-glow{fill:#6EE7B7;transition:fill .25s}
.neo-s-off .neo-eye{transform:scaleY(.08)}
.neo-s-off .neo-eye .neo-c,.neo-s-off .neo-eye .neo-glow{fill:#3B5A66}
.neo-s-off .neo-glow,.neo-s-off .neo-hl{opacity:0}
.neo-s-listen .neo-eye{transform:scale(1.1)}
.neo-s-think .neo-eye{transform:translate(6px,-5px)}
.neo-s-think .neo-eye .neo-c,.neo-s-think .neo-eye .neo-glow{fill:#FDE047}
.neo-s-speak .neo-eye{animation:neo-blink 4.5s infinite}
.neo-s-listen .neo-eye{animation:neo-blinkL 4.5s infinite}
@keyframes neo-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@keyframes neo-blinkL{0%,92%,100%{transform:scale(1.1)}95%{transform:scale(1.1,.08)}}
.neo-m{opacity:0;transition:opacity .15s}
.neo-s-off .neo-m-flat,.neo-s-listen .neo-m-smile,.neo-s-speak .neo-m-talk,.neo-s-think .neo-m-dots{opacity:1}
.neo-dot{animation:neo-dot 1s infinite}
.neo-dot:nth-child(2){animation-delay:.2s}.neo-dot:nth-child(3){animation-delay:.4s}
@keyframes neo-dot{0%,100%{opacity:.2}50%{opacity:1}}
.neo-ball,.neo-halo{transition:fill .25s;fill:#94A3B8}
.neo-s-listen .neo-ball,.neo-s-listen .neo-halo{fill:#F59E0B}.neo-s-think .neo-ball,.neo-s-think .neo-halo{fill:#FDE047}.neo-s-speak .neo-ball,.neo-s-speak .neo-halo{fill:#4ADE80}
.neo-ring{opacity:0;fill:none;stroke-width:2.5}
.neo-s-listen .neo-ring{stroke:#F59E0B;animation:neo-ring 1.4s infinite}
.neo-s-speak .neo-ring{stroke:#4ADE80;animation:neo-ring 1.4s infinite}
@keyframes neo-ring{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(3.2)}}
.neo-wave{opacity:0;fill:none;stroke:#22C55E;stroke-width:3;stroke-linecap:round}
.neo-s-listen .neo-wave{animation:neo-wv 1.2s infinite}
.neo-s-listen .neo-w2{animation-delay:.3s}
@keyframes neo-wv{0%{opacity:0}40%{opacity:.95}100%{opacity:0}}
.neo-led{transition:fill .25s;fill:#4ADE80}
.neo-s-off .neo-led{fill:#475569}.neo-s-think .neo-led{fill:#FDE047}
.neo-pod{transition:opacity .25s}.neo-s-off .neo-pod{opacity:.55}
.neo-hand{transition:transform .3s}
.neo-s-speak .neo-hr{animation:neo-gest 1.3s ease-in-out infinite}
.neo-s-speak .neo-hlf{animation:neo-gest 1.3s ease-in-out .5s infinite}
@keyframes neo-gest{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
.neo-s-think .neo-hr{transform:translate(-18px,-20px)}
.neo-s-think .neo-arm-r{opacity:0}
.neo-eyeW,.neo-mW{display:none}
.neo-drag .neo-eyeN,.neo-drag .neo-mN{display:none}
.neo-drag .neo-eyeW,.neo-drag .neo-mW{display:inline}
@media (prefers-reduced-motion:reduce){.neo-bob,.neo-eye,.neo-dot,.neo-ring,.neo-wave,.neo-hand{animation:none!important}}
`;

const klem = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const putar = (c: number, s: number) => `translate(${c} 0) scale(${s} 1) translate(${-c} 0)`;
const Z = 1.3; // skala gerak (satuan SVG) supaya terlihat sama kuatnya dengan ukuran robot di layar

export default function NeoRobot({
  mode,
  className = '',
  gerak,
  menyeret = false,
}: {
  mode: NeoMode;
  className?: string;
  gerak?: React.MutableRefObject<NeoGerak>;
  menyeret?: boolean;
}) {
  const mouthRef = useRef<SVGEllipseElement>(null);
  const tongueRef = useRef<SVGEllipseElement>(null);
  const modeRef = useRef<NeoMode>(mode);
  modeRef.current = mode;
  // elemen yang digerakkan langsung (tanpa re-render React) saat robot ditarik
  const shellRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const plRef = useRef<SVGGElement>(null);
  const prRef = useRef<SVGGElement>(null);
  const hlRef = useRef<SVGGElement>(null);
  const hrRef = useRef<SVGGElement>(null);
  const alRef = useRef<SVGLineElement>(null);
  const arRef = useRef<SVGLineElement>(null);
  const antRef = useRef<SVGPathElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const pp1Ref = useRef<SVGCircleElement>(null);
  const pp2Ref = useRef<SVGCircleElement>(null);
  const dragRef = useRef<SVGGElement>(null);
  const S = useRef({ ox: 0, oy: 0, ovx: 0, ovy: 0, bend: 0, bv: 0 });

  // Mulut bergerak acak (seperti mengucap) selama mode "speak".
  useEffect(() => {
    if (mode !== 'speak') return;
    const id = window.setInterval(() => {
      const m = mouthRef.current;
      const t = tongueRef.current;
      if (!m || !t) return;
      const o = Math.random();
      const ry = 2.5 + o * 10;
      m.setAttribute('ry', ry.toFixed(1));
      m.setAttribute('rx', (14 - o * 6).toFixed(1));
      t.setAttribute('ry', Math.min(ry - 2.5, 3.5).toFixed(1));
      t.setAttribute('cy', (101 + ry * 0.5).toFixed(1));
    }, 110);
    return () => window.clearInterval(id);
  }, [mode]);

  // Animasi tarik: hanya berjalan selama ditarik + sampai pegas kembali diam.
  useEffect(() => {
    const kurangGerak = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const set = (el: Element | null, k: string, v: string) => { if (el) el.setAttribute(k, v); };
    const tick = () => {
      const s = S.current;
      const g = gerak?.current;
      if (g && (!menyeret || performance.now() - g.t > 80)) { g.vx *= 0.8; g.vy *= 0.8; }
      const vx = g && !kurangGerak ? g.vx : 0;
      const vy = g && !kurangGerak ? g.vy : 0;
      const sp = Math.hypot(vx, vy);
      const tx = -klem(vx * 1.2 * Z, -14 * Z, 14 * Z);
      const ty = -klem(vy * 1.2 * Z, -10 * Z, 10 * Z);
      s.ovx = (s.ovx + (tx - s.ox) * 0.14) * 0.8; s.ox += s.ovx;
      s.ovy = (s.ovy + (ty - s.oy) * 0.14) * 0.8; s.oy += s.ovy;
      const bt = klem(-vx * 0.9 * Z, -18 * Z, 18 * Z);
      s.bv = (s.bv + (bt - s.bend) * 0.12) * 0.84; s.bend += s.bv;
      const { ox, oy, bend } = s;
      const turn = 1 - Math.abs(ox) * 0.011 / Z;
      set(shellRef.current, 'transform', `${putar(110, turn)} translate(${(ox * 0.35).toFixed(1)} ${(oy * 0.25).toFixed(1)})`);
      set(bodyRef.current, 'transform', `translate(${(ox * 0.15).toFixed(1)} 0)`);
      set(faceRef.current, 'transform', `translate(${(ox * 1.1).toFixed(1)} ${(oy * 0.7).toFixed(1)})`);
      set(plRef.current, 'transform', putar(21, 1 + (ox / Z) * 0.025));
      set(prRef.current, 'transform', putar(199, 1 - (ox / Z) * 0.025));
      const hx = ox * 1.9;
      const hy = oy * 1.5 - (menyeret && !kurangGerak ? 6 : 0);
      set(hlRef.current, 'transform', `translate(${hx.toFixed(1)} ${hy.toFixed(1)})`);
      set(hrRef.current, 'transform', `translate(${hx.toFixed(1)} ${hy.toFixed(1)})`);
      set(alRef.current, 'x2', String(58 + hx)); set(alRef.current, 'y2', String(172 + hy));
      set(arRef.current, 'x2', String(162 + hx)); set(arRef.current, 'y2', String(172 + hy));
      set(antRef.current, 'd', `M110 24 Q${(110 + bend * 0.3).toFixed(1)} 14 ${(110 + bend * 0.9).toFixed(1)} 8`);
      set(ballRef.current, 'transform', `translate(${(bend * 0.9).toFixed(1)} 0)`);
      const kaget = menyeret && !kurangGerak && sp > 1.5 && modeRef.current !== 'off';
      dragRef.current?.classList.toggle('neo-drag', kaget);
      const k = klem((ox / Z) * 0.35, -4, 4) * 1.2, kk = klem((oy / Z) * 0.35, -3, 3);
      set(pp1Ref.current, 'cx', String(88 + k)); set(pp2Ref.current, 'cx', String(132 + k));
      set(pp1Ref.current, 'cy', String(70 + kk)); set(pp2Ref.current, 'cy', String(70 + kk));
      const diam = !menyeret && sp < 0.05 && Math.abs(ox) < 0.05 && Math.abs(oy) < 0.05 && Math.abs(bend) < 0.05 && Math.abs(s.ovx) < 0.01 && Math.abs(s.bv) < 0.01;
      if (diam) {
        s.ox = s.oy = s.ovx = s.ovy = s.bend = s.bv = 0;
        ['shell','body','face','pl','pr','hl','hr'].forEach((n) => {
          const el = ({ shell: shellRef, body: bodyRef, face: faceRef, pl: plRef, pr: prRef, hl: hlRef, hr: hrRef } as Record<string, React.RefObject<SVGGElement | null>>)[n].current;
          if (el) el.removeAttribute('transform');
        });
        set(alRef.current, 'x2', '58'); set(alRef.current, 'y2', '172'); set(arRef.current, 'x2', '162'); set(arRef.current, 'y2', '172');
        set(antRef.current, 'd', 'M110 24 Q110 14 110 8'); ballRef.current?.removeAttribute('transform');
        dragRef.current?.classList.remove('neo-drag');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [menyeret, gerak]);

  const rim = { stroke: '#6FB3C7', strokeOpacity: 0.5, strokeWidth: 2 } as const;
  const mata = (cx: number) => (
    <g className="neo-eye neo-fb">
      <ellipse className="neo-glow" cx={cx} cy="70" rx="17" ry="22" opacity=".14" />
      <ellipse className="neo-c" cx={cx} cy="70" rx="11" ry="15" />
      <ellipse className="neo-hl" cx={cx - 4} cy="64" rx="3.5" ry="5" fill="#fff" opacity=".85" />
    </g>
  );

  return (
    <>
      <style>{CSS}</style>
      <svg viewBox="-14 -6 248 206" className={`neo-s-${mode} ${className}`} aria-hidden="true" focusable="false" style={{ overflow: 'visible' }}>
        <defs><clipPath id="neo-scr"><rect x="40" y="34" width="140" height="86" rx="43" /></clipPath></defs>
        <ellipse cx="110" cy="193" rx="58" ry="5.5" fill="#000" opacity=".13" />
        <g className="neo-bob">
          {/* badan */}
          <g ref={bodyRef}>
            <rect x="97" y="124" width="26" height="16" rx="6" fill="#0B2E3D" />
            <rect x="97" y="130" width="26" height="3" fill="#06202B" opacity=".6" />
            <ellipse cx="110" cy="170" rx="43" ry="27" fill="#0F3D4F" {...rim} strokeOpacity={0.45} />
            <ellipse cx="110" cy="165" rx="41" ry="24" fill="#1D5A6E" />
            <path d="M78 150 Q94 140 120 142" stroke="#fff" strokeWidth="5" strokeLinecap="round" fill="none" opacity=".28" />
            <rect x="88" y="156" width="44" height="22" rx="11" fill="#0B2E3D" stroke="#4ADE80" strokeOpacity=".35" strokeWidth="1.2" />
            <circle className="neo-led" cx="110" cy="167" r="9" opacity=".22" />
            <circle className="neo-led" cx="110" cy="167" r="5.5" />
            <circle cx="97" cy="167" r="2.3" fill="#6FB3C7" /><circle cx="123" cy="167" r="2.3" fill="#6FB3C7" />
          </g>
          {/* lengan + sendi bahu */}
          <line ref={alRef} className="neo-arm-l" x1="80" y1="158" x2="58" y2="172" stroke="#0F3D4F" strokeWidth="9" strokeLinecap="round" />
          <line ref={arRef} className="neo-arm-r" x1="140" y1="158" x2="162" y2="172" stroke="#0F3D4F" strokeWidth="9" strokeLinecap="round" />
          <circle cx="80" cy="158" r="7" fill="#1D5A6E" stroke="#6FB3C7" strokeOpacity=".5" strokeWidth="1.5" />
          <circle cx="140" cy="158" r="7" fill="#1D5A6E" stroke="#6FB3C7" strokeOpacity=".5" strokeWidth="1.5" />
          {/* kepala */}
          <g ref={shellRef}>
            <path ref={antRef} d="M110 24 Q110 14 110 8" stroke="#2B7A93" strokeWidth="5" strokeLinecap="round" fill="none" />
            <rect x="102" y="20" width="16" height="7" rx="3" fill="#0B2E3D" />
            <g ref={ballRef}>
              <circle className="neo-halo" cx="110" cy="8" r="13" opacity=".2" />
              <circle className="neo-ring neo-fb" cx="110" cy="8" r="9" />
              <circle className="neo-ball" cx="110" cy="8" r="9" />
              <circle cx="106" cy="4" r="3" fill="#fff" opacity=".75" />
            </g>
            <rect x="22" y="68" width="14" height="24" rx="6" fill="#0B2E3D" /><rect x="184" y="68" width="14" height="24" rx="6" fill="#0B2E3D" />
            <path className="neo-wave" d="M2 68 Q-6 80 2 92" />
            <path className="neo-wave neo-w2" d="M-10 60 Q-22 80 -10 100" />
            <path className="neo-wave" d="M218 68 Q226 80 218 92" />
            <path className="neo-wave neo-w2" d="M230 60 Q242 80 230 100" />
            <g className="neo-pod">
              <g ref={plRef}>
                <rect x="8" y="54" width="26" height="52" rx="13" fill="#0F7D4E" /><rect x="8" y="52" width="26" height="50" rx="13" fill="#34D399" />
                <rect x="14" y="60" width="5" height="18" rx="2.5" fill="#fff" opacity=".5" /><circle cx="21" cy="90" r="3" fill="#0F7D4E" opacity=".6" />
              </g>
              <g ref={prRef}>
                <rect x="186" y="54" width="26" height="52" rx="13" fill="#0F7D4E" /><rect x="186" y="52" width="26" height="50" rx="13" fill="#34D399" />
                <rect x="192" y="60" width="5" height="18" rx="2.5" fill="#fff" opacity=".5" /><circle cx="199" cy="90" r="3" fill="#0F7D4E" opacity=".6" />
              </g>
            </g>
            <rect x="28" y="28" width="164" height="112" rx="56" fill="#06202B" />
            <rect x="28" y="22" width="164" height="112" rx="56" fill="#0F3D4F" {...rim} />
            <rect x="30" y="22" width="160" height="104" rx="52" fill="#1D5A6E" />
            <path d="M52 38 Q100 24 152 31" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" opacity=".3" />
            <path d="M46 62 Q42 50 52 42" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".18" />
            <rect x="40" y="34" width="140" height="86" rx="43" fill="#050B14" stroke="#4ADE80" strokeOpacity=".35" strokeWidth="1.5" />
            <g clipPath="url(#neo-scr)" opacity=".07">
              {[48, 60, 72, 84, 96, 108].map((y) => <line key={y} x1="40" y1={y} x2="180" y2={y} stroke="#6EE7B7" strokeWidth="1" />)}
            </g>
            <path d="M58 52 Q68 42 92 40" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".15" />
            {/* wajah */}
            <g ref={faceRef}>
              <g ref={dragRef}>
                <g className="neo-eyeN">{mata(88)}{mata(132)}</g>
                <g className="neo-eyeW">
                  <ellipse cx="88" cy="70" rx="19" ry="26" fill="#6EE7B7" opacity=".14" /><ellipse cx="132" cy="70" rx="19" ry="26" fill="#6EE7B7" opacity=".14" />
                  <ellipse cx="88" cy="70" rx="13" ry="19" fill="#6EE7B7" /><ellipse cx="132" cy="70" rx="13" ry="19" fill="#6EE7B7" />
                  <circle ref={pp1Ref} cx="88" cy="70" r="5.5" fill="#050B14" /><circle ref={pp2Ref} cx="132" cy="70" r="5.5" fill="#050B14" />
                  <circle cx="85" cy="63" r="2.5" fill="#fff" /><circle cx="129" cy="63" r="2.5" fill="#fff" />
                  <line x1="76" y1="44" x2="98" y2="37" stroke="#6EE7B7" strokeWidth="4" strokeLinecap="round" />
                  <line x1="144" y1="44" x2="122" y2="37" stroke="#6EE7B7" strokeWidth="4" strokeLinecap="round" />
                </g>
                <g className="neo-mN">
                  <line className="neo-m neo-m-flat" x1="100" y1="99" x2="120" y2="99" stroke="#3B5A66" strokeWidth="5" strokeLinecap="round" />
                  <path className="neo-m neo-m-smile" d="M96 98 Q110 110 124 98" stroke="#6EE7B7" strokeWidth="5" strokeLinecap="round" fill="none" />
                  <g className="neo-m neo-m-dots"><circle className="neo-dot" cx="100" cy="99" r="4" fill="#FDE047" /><circle className="neo-dot" cx="110" cy="99" r="4" fill="#FDE047" /><circle className="neo-dot" cx="120" cy="99" r="4" fill="#FDE047" /></g>
                  <g className="neo-m neo-m-talk"><ellipse ref={mouthRef} cx="110" cy="99" rx="11" ry="5" fill="#08332C" stroke="#6EE7B7" strokeWidth="3.5" /><ellipse ref={tongueRef} cx="110" cy="101" rx="6" ry="2" fill="#F472B6" /></g>
                </g>
                <path className="neo-mW" d="M92 101 q4.5 -7 9 0 t9 0 t9 0 t9 0" stroke="#6EE7B7" strokeWidth="4.5" strokeLinecap="round" fill="none" />
              </g>
            </g>
          </g>
          {/* tangan */}
          <g ref={hlRef}>
            <g className="neo-hand neo-hlf">
              <circle cx="58" cy="175" r="13" fill="#06202B" /><circle cx="58" cy="172" r="13" fill="#1D5A6E" {...rim} strokeOpacity={0.55} />
              <circle cx="53" cy="167" r="3.5" fill="#fff" opacity=".5" /><rect x="62" y="166" width="5" height="9" rx="2.5" fill="#0F3D4F" />
            </g>
          </g>
          <g ref={hrRef}>
            <g className="neo-hand neo-hr">
              <circle cx="162" cy="175" r="13" fill="#06202B" /><circle cx="162" cy="172" r="13" fill="#1D5A6E" {...rim} strokeOpacity={0.55} />
              <circle cx="157" cy="167" r="3.5" fill="#fff" opacity=".5" /><rect x="153" y="166" width="5" height="9" rx="2.5" fill="#0F3D4F" />
            </g>
          </g>
        </g>
      </svg>
    </>
  );
}