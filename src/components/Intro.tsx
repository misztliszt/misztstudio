import { useEffect, useState } from 'react'
import iconUrl from '../../build/icon.svg?url'

/*
 * Introdução de abertura (~3,6 s):
 *   1. wireframe do editor se desenha sobre uma grade (blueprint);
 *   2. clipes deslizam na timeline e o cursor varre a tela;
 *   3. uma onda sonora atravessa o centro e se transforma no ícone (o guaxinim);
 *   4. "desenvolvido por MISZT" entra letra a letra; tudo some revelando o app.
 * Sempre toca inteira (não dá para pular). Com "reduzir movimento" do sistema os elementos
 * aparecem sem animação, mas a tela de crédito fica o mesmo tempo.
 */

const NAME = 'MISZT'
const TOTAL_MS = 3600
const EXIT_MS = 500

export function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    // Bloqueia atalhos do app enquanto a introdução está na tela.
    const block = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', block, true)
    const t1 = setTimeout(() => setLeaving(true), TOTAL_MS)
    const t2 = setTimeout(onDone, TOTAL_MS + EXIT_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('keydown', block, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`intro ${leaving ? 'leaving' : ''} ${reduced ? 'reduced' : ''}`} role="presentation">
      <svg className="intro-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {/* 1. Grade de blueprint */}
        <g className="intro-grid">
          {Array.from({ length: 17 }, (_, i) => (
            <line key={`v${i}`} pathLength={1} x1={i * 100} y1={0} x2={i * 100} y2={900} style={{ animationDelay: `${i * 18}ms` }} />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <line key={`h${i}`} pathLength={1} x1={0} y1={i * 100} x2={1600} y2={i * 100} style={{ animationDelay: `${120 + i * 18}ms` }} />
          ))}
        </g>

        {/* 1. Wireframe do editor */}
        <g className="intro-wire">
          <rect pathLength={1} x="140" y="120" width="300" height="380" rx="10" style={{ animationDelay: '150ms' }} />
          <rect pathLength={1} x="470" y="120" width="660" height="380" rx="10" style={{ animationDelay: '260ms' }} />
          <rect pathLength={1} x="1160" y="120" width="300" height="380" rx="10" style={{ animationDelay: '370ms' }} />
          <rect pathLength={1} x="140" y="540" width="1320" height="250" rx="10" style={{ animationDelay: '480ms' }} />
          {[0, 1, 2, 3].map((r) => (
            <line key={r} pathLength={1} x1="140" y1={600 + r * 48} x2="1460" y2={600 + r * 48} style={{ animationDelay: `${560 + r * 40}ms` }} />
          ))}
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <rect key={`m${r}`} pathLength={1} x={165 + (r % 2) * 135} y={150 + Math.floor(r / 2) * 110} width="115" height="80" rx="6" style={{ animationDelay: `${380 + r * 50}ms` }} />
          ))}
        </g>

        {/* 2. Clipes na timeline + cursor */}
        <g className="intro-clips">
          <rect x="240" y="608" width="360" height="34" rx="6" fill="#4f7cff" style={{ animationDelay: '700ms' }} />
          <rect x="620" y="608" width="230" height="34" rx="6" fill="#ec5c9b" style={{ animationDelay: '800ms' }} />
          <rect x="870" y="608" width="420" height="34" rx="6" fill="#4f7cff" style={{ animationDelay: '900ms' }} />
          <rect x="240" y="656" width="610" height="34" rx="6" fill="#a46bff" style={{ animationDelay: '950ms' }} />
          <rect x="240" y="704" width="1050" height="34" rx="6" fill="#1fbf8a" style={{ animationDelay: '1000ms' }} />
        </g>
        <g className="intro-playhead">
          <line x1="0" y1="560" x2="0" y2="780" />
          <path d="M-9 556 h18 v10 l-9 9 l-9 -9 z" />
        </g>

        {/* 3. Onda sonora que vira o ícone */}
        <path
          className="intro-wave"
          pathLength={1}
          d="M140 330 L520 330 L560 270 L600 400 L640 230 L680 430 L720 290 L760 380 L800 250 L840 410 L880 300 L920 360 L960 320 L1000 340 L1040 330 L1460 330"
        />
        <g className="intro-logo">
          <image href={iconUrl} x="722" y="222" width="156" height="156" />
        </g>
        <defs>
          <linearGradient id="intro-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2bd3c0" />
            <stop offset="1" stopColor="#3b7cf6" />
          </linearGradient>
        </defs>
      </svg>

      {/* 4. Crédito */}
      <div className="intro-credit">
        <span className="intro-product">Miszt Studio</span>
        <span className="intro-by">desenvolvido por</span>
        <span className="intro-name" aria-label={NAME}>
          {[...NAME].map((c, i) => (
            <span key={i} style={{ animationDelay: `${2250 + i * 85}ms` }}>
              {c}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
