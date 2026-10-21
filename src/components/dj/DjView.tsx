import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Circle, Disc3, FolderInput, Loader2, Music, Search, Square, Wand2 } from 'lucide-react'
import { segmentsToClips, type Deck, type DjMixer, type HotCue } from '../../dj'
import type { Action } from '../../store'
import { projectDuration, uid } from '../../store'
import type { DjLibrary, DjSource, DjTrack, Media, Project } from '../../types'
import { detectBeats } from '../../beats'
import { getPeaks } from '../../waveform'
import { formatTime } from '../../format'
import { useFeedback } from '../../ui/feedback'
import { compatible, shiftCamelot } from './harmonic'
import { DeckPanel } from './DeckPanel'
import { Knob } from './Knob'
import { Toggle } from '../controls'

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const SOURCES: { id: DjSource; label: string; hint: string }[] = [
  { id: 'rekordbox', label: 'rekordbox', hint: 'XML exportado (Arquivo → Exportar coleção em formato xml)' },
  { id: 'traktor', label: 'Traktor', hint: 'collection.nml' },
  { id: 'serato', label: 'Serato', hint: 'Pasta de músicas analisadas (tags nos MP3)' },
  { id: 'engine', label: 'Engine DJ', hint: 'Engine Library/Database2/m.db' },
]

interface Props {
  mixer: DjMixer
  project: Project
  dispatch: (a: Action) => void
  library: DjLibrary | null
  onLibrary: (lib: DjLibrary | null) => void
}

type Row = { id: string; title: string; artist: string | null; bpm: number | null; camelot: string | null; duration: number; cues: number; media?: Media; track?: DjTrack; missing?: boolean }

export function DjView({ mixer, project, dispatch, library, onLibrary }: Props) {
  const { toast, confirm } = useFeedback()
  const [A, B] = mixer.decks
  const [tab, setTab] = useState<'project' | 'library'>(library ? 'library' : 'project')
  const [query, setQuery] = useState('')
  const [playlist, setPlaylist] = useState<string>('')
  const [detected, setDetected] = useState<Partial<Record<DjSource, string>>>({})
  const [importing, setImporting] = useState<DjSource | null>(null)
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set())
  const [separating, setSeparating] = useState<Record<string, string>>({})
  const [xf, setXf] = useState(mixer.crossfader)
  const [masterVol, setMasterVol] = useState(1)
  const [, force] = useState(0)
  const [recResult, setRecResult] = useState<Awaited<ReturnType<DjMixer['stopRecording']>> | null>(null)
  const [recOpts, setRecOpts] = useState({ audio: true, clips: false })
  const [saving, setSaving] = useState(false)
  const meters = useRef<Record<string, HTMLDivElement | null>>({})
  const recTime = useRef<HTMLSpanElement>(null)
  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => {
    void window.api.djDetect().then(setDetected)
  }, [])

  // Medidores e relógio da gravação.
  useEffect(() => {
    let raf = 0
    const peak: Record<string, number> = {}
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const values: Record<string, number> = { A: A.level(), B: B.level(), M: mixer.level() }
      for (const [k, v] of Object.entries(values)) {
        peak[k] = Math.max(v, (peak[k] ?? 0) * 0.9)
        const el = meters.current[k]
        if (el) {
          el.style.height = `${Math.min(100, peak[k] * 100)}%`
          el.classList.toggle('clip', peak[k] > 0.98)
        }
      }
      if (recTime.current && mixer.recordingSince !== null) recTime.current.textContent = formatTime((performance.now() - mixer.recordingSince) / 1000, false)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [A, B, mixer])

  // ---------- Lista de faixas ----------
  const projectRows: Row[] = useMemo(
    () =>
      Object.values(project.media)
        .filter((m) => m.kind !== 'image' && m.hasAudio)
        .map((m) => ({ id: m.id, title: m.name.replace(/\.[^.]+$/, ''), artist: null, bpm: m.beats?.bpm ?? null, camelot: m.key?.camelot ?? null, duration: m.duration, cues: m.cues?.length ?? 0, media: m })),
    [project.media],
  )
  const libraryRows: Row[] = useMemo(() => {
    if (!library) return []
    const ids = playlist ? new Set(library.playlists.find((p) => p.name === playlist)?.trackIds ?? []) : null
    return library.tracks
      .filter((t) => !ids || ids.has(t.id))
      .map((t) => ({ id: t.id, title: t.title ?? t.path.split(/[\\/]/).pop()!, artist: t.artist, bpm: t.bpm, camelot: t.key?.camelot ?? null, duration: t.duration, cues: t.cues.filter((c) => c.num !== null).length, track: t, missing: !t.exists }))
  }, [library, playlist])
  const rows = (tab === 'project' ? projectRows : libraryRows).filter((r) => `${r.title} ${r.artist ?? ''}`.toLowerCase().includes(query.toLowerCase()))

  // Tom de referência para a mixagem harmônica: o deck que está tocando (ou o carregado).
  const ref = [A, B].find((d) => d.playing && d.track?.key) ?? [A, B].find((d) => d.track?.key)
  const refCamelot = ref?.track?.key ? shiftCamelot(ref.track.key, ref.pitchShift).camelot : null
  const refBpm = ref?.bpm ?? null

  // ---------- Carregar no deck ----------
  const analyze = async (m: Media) => {
    setAnalyzing((s) => new Set(s).add(m.id))
    try {
      const patch: Partial<Media> = {}
      if (!m.beats) {
        const peaks = await getPeaks(m)
        const grid = peaks ? detectBeats(peaks) : null
        if (grid) patch.beats = grid
      }
      if (!m.key) patch.key = await window.api.detectKey(m.path)
      if (Object.keys(patch).length) dispatch({ type: 'updateMedia', id: m.id, patch })
      return patch
    } catch (err) {
      toast.error('Não foi possível analisar', { detail: `${m.name}: ${errorText(err)}` })
      return {}
    } finally {
      setAnalyzing((s) => {
        const next = new Set(s)
        next.delete(m.id)
        return next
      })
    }
  }

  const loadMedia = async (deck: Deck, m: Media) => {
    if (deck.playing && !(await confirm({ title: `Trocar a faixa do deck ${deck.id}?`, message: 'Ele está tocando agora.', confirmLabel: 'Trocar' }))) return
    const cues: HotCue[] = []
    for (const c of m.cues ?? []) if (c.num !== null && c.num < 8) cues[c.num] = { time: c.time, name: c.name, color: c.color }
    await deck.load({ media: m, bpm: m.beats?.bpm ?? null, offset: m.beats?.offset ?? 0, key: m.key ?? null }, [{ url: m.url, name: 'mix' }], cues)
    // Sem grade ou tom: analisa em segundo plano e atualiza o deck.
    if (!m.beats || !m.key) {
      const patch = await analyze(m)
      if (deck.track?.media.id === m.id) {
        if (patch.beats) deck.track = { ...deck.track, bpm: patch.beats.bpm, offset: patch.beats.offset }
        if (patch.key) deck.track = { ...deck.track, key: patch.key }
        deck.onChange?.()
      }
    }
  }

  const loadRow = async (deck: Deck, row: Row) => {
    if (row.media) return loadMedia(deck, row.media)
    const t = row.track!
    if (!t.exists) {
      toast.error('Arquivo não encontrado', { detail: t.path })
      return
    }
    // Faixas da biblioteca entram na mídia do projeto (com BPM, grade, tom e hot cues).
    const existing = Object.values(projectRef.current.media).find((m) => m.path.toLowerCase() === t.path.toLowerCase())
    if (existing) return loadMedia(deck, existing)
    const [r] = await window.api.probePaths([t.path])
    if (!r?.ok) {
      toast.error('Não foi possível abrir a faixa', { detail: r && !r.ok ? r.error : t.path })
      return
    }
    const m: Media = { ...r.media, id: uid(), beats: t.grid ?? (t.bpm ? { bpm: t.bpm, offset: 0 } : null), key: t.key, cues: t.cues }
    dispatch({ type: 'addMedia', media: [m] })
    await loadMedia(deck, m)
  }

  const dropRow = (deck: Deck, id: string) => {
    const row = [...projectRows, ...libraryRows].find((r) => r.id === id)
    if (row) void loadRow(deck, row)
  }

  const importLibrary = async (source: DjSource) => {
    setImporting(source)
    try {
      const lib = await window.api.djLoad(source, source === 'rekordbox' ? null : (detected[source] ?? null))
      if (!lib) return
      onLibrary(lib)
      setTab('library')
      setPlaylist('')
      const missing = lib.tracks.filter((t) => !t.exists).length
      toast.success(`${lib.tracks.length} faixas importadas do ${SOURCES.find((s) => s.id === source)!.label}`, { detail: missing ? `${missing} arquivos não foram encontrados no disco.` : `${lib.playlists.length} playlists` })
    } catch (err) {
      toast.error('Não foi possível ler a biblioteca', { detail: errorText(err) })
    } finally {
      setImporting(null)
    }
  }

  // ---------- Stems ----------
  const separate = async (deck: Deck) => {
    const m = deck.track?.media
    if (!m) return
    const status = await window.api.stemsStatus()
    if (!status.installed) {
      toast.warning('Instale a separação de faixas primeiro', { detail: 'No editor: clique num clipe de áudio → Áudio → Separar voz e instrumentos. A instalação é feita uma vez.' })
      return
    }
    setSeparating((s) => ({ ...s, [deck.id]: 'Preparando…' }))
    const off = window.api.onStemsProgress((p) => setSeparating((s) => ({ ...s, [deck.id]: p.text ?? (p.progress !== undefined ? `Separando… ${Math.round(p.progress * 100)}%` : 'Separando…') })))
    try {
      const stems = await window.api.separateStems({ filePath: m.path, inPoint: 0, duration: m.duration, model: 'htdemucs', twoStems: false })
      const parts = stems.filter((s) => s.probe.ok).map((s) => ({ url: (s.probe as { ok: true; media: Media }).media.url, name: s.name }))
      if (!parts.length) throw new Error('A separação não gerou faixas')
      const t = deck.time
      const wasPlaying = deck.playing
      const cues = [...deck.hotcues]
      const track = deck.track!
      await deck.load(track, parts, cues.map((c) => c ?? undefined).filter(Boolean) as HotCue[])
      deck.hotcues = cues
      deck.seek(t)
      if (wasPlaying) deck.play()
      toast.success(`Stems prontos no deck ${deck.id}`, { detail: 'Use os knobs Voz, Bateria, Baixo e Outros.' })
    } catch (err) {
      toast.error('A separação falhou', { detail: errorText(err) })
    } finally {
      off()
      setSeparating((s) => {
        const next = { ...s }
        delete next[deck.id]
        return next
      })
    }
  }

  // ---------- Gravação do set ----------
  const toggleRecord = async () => {
    if (!mixer.recording) {
      mixer.startRecording()
      force((n) => n + 1)
      return
    }
    const r = await mixer.stopRecording()
    force((n) => n + 1)
    if (r && r.duration > 1) setRecResult(r)
  }

  const saveSet = async () => {
    if (!recResult) return
    setSaving(true)
    try {
      const start = projectDuration(projectRef.current)
      let audio: { label: string; media: Media } | null = null
      if (recOpts.audio) {
        const probe = await window.api.saveRecording(await recResult.audio.arrayBuffer())
        if (!probe.ok) throw new Error(probe.error)
        audio = { label: 'Set de DJ', media: { ...probe.media, id: uid(), name: `Set de DJ ${new Date().toLocaleDateString('pt-BR')}` } }
      }
      const decks = recOpts.clips ? recResult.decks.map((d) => ({ label: `Deck ${d.id}`, muted: recOpts.audio, clips: segmentsToClips(d.segments, d.gainLog, start) })) : []
      dispatch({ type: 'addDjSet', start, audio, decks })
      toast.success('Set adicionado à timeline', { detail: `${formatTime(recResult.duration, false)} a partir de ${formatTime(start, false)}${recOpts.clips && recOpts.audio ? ' · trilhas dos decks entram silenciadas' : ''}` })
      setRecResult(null)
    } catch (err) {
      toast.error('Não foi possível salvar o set', { detail: errorText(err) })
    } finally {
      setSaving(false)
    }
  }

  const strip = (deck: Deck) => (
    <div className="dj-strip">
      <span className="dj-strip-name">{deck.id}</span>
      {(['high', 'mid', 'low'] as const).map((band) => (
        <Knob key={band} label={band === 'high' ? 'Agudo' : band === 'mid' ? 'Médio' : 'Grave'} value={deck.eq[band]} min={-26} max={6} center={0} bipolar size={40} format={(v) => (v <= -24 ? 'corte' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)} onChange={(v) => (deck.setEq(band, v), force((n) => n + 1))} />
      ))}
      <Knob label="Filtro" value={deck.filter} min={-1} max={1} center={0} bipolar size={40} format={(v) => (Math.abs(v) < 0.02 ? 'desligado' : v < 0 ? 'passa-baixa' : 'passa-alta')} onChange={(v) => (deck.setFilter(v), force((n) => n + 1))} />
      <div className="dj-fader-row">
        <input className="dj-fader" type="range" min={0} max={1} step={0.005} value={deck.volume} onChange={(e) => (deck.setVolume(Number(e.target.value)), force((n) => n + 1))} />
        <div className="dj-meter">
          <div ref={(el) => (meters.current[deck.id] = el)} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="dj">
      <div className="dj-decks">
        <DeckPanel deck={A} other={B} onSeparate={separate} separating={separating.A ?? null} onDropRow={dropRow} />
        <div className="dj-mixer">
          <div className="dj-strips">
            {strip(A)}
            {strip(B)}
          </div>
          <div className="dj-xf">
            <span>A</span>
            <input type="range" min={-1} max={1} step={0.01} value={xf} onChange={(e) => (mixer.setCrossfader(Number(e.target.value)), setXf(Number(e.target.value)))} onDoubleClick={() => (mixer.setCrossfader(0), setXf(0))} />
            <span>B</span>
          </div>
          <div className="dj-master">
            <Knob label="Master" value={masterVol} min={0} max={1.5} center={1} size={40} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => (mixer.setMaster(v), setMasterVol(v))} />
            <div className="dj-meter wide">
              <div ref={(el) => (meters.current.M = el)} />
            </div>
            <button className={`btn ${mixer.recording ? 'danger' : ''} dj-rec`} onClick={() => void toggleRecord()}>
              {mixer.recording ? <Square size={13} fill="currentColor" /> : <Circle size={13} fill="#ff4d4d" color="#ff4d4d" />}
              {mixer.recording ? (
                <>
                  Parar <span ref={recTime}>0:00</span>
                </>
              ) : (
                'Gravar set'
              )}
            </button>
          </div>
        </div>
        <DeckPanel deck={B} other={A} onSeparate={separate} separating={separating.B ?? null} onDropRow={dropRow} />
      </div>

      <div className="dj-browser">
        <div className="dj-browser-bar">
          <div className="segmented small">
            <button className={tab === 'project' ? 'active' : ''} onClick={() => setTab('project')}>
              <Music size={13} /> Projeto ({projectRows.length})
            </button>
            <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
              <Disc3 size={13} /> Biblioteca de DJ{library ? ` (${library.tracks.length})` : ''}
            </button>
          </div>
          {tab === 'library' && library && library.playlists.length > 0 && (
            <select className="dj-select" value={playlist} onChange={(e) => setPlaylist(e.target.value)}>
              <option value="">Todas as faixas</option>
              {library.playlists.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.trackIds.length})
                </option>
              ))}
            </select>
          )}
          <div className="search grow">
            <Search size={14} />
            <input placeholder="Buscar faixa ou artista" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="dj-import">
            <FolderInput size={14} />
            {SOURCES.map((s) => (
              <button key={s.id} className={`chip ${detected[s.id] ? 'found' : ''}`} onClick={() => void importLibrary(s.id)} disabled={!!importing} data-tip={detected[s.id] ? `Encontrado: ${detected[s.id]}` : s.hint} data-tip-pos="top">
                {importing === s.id ? <Loader2 size={12} className="spin" /> : null} {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dj-table">
          <div className="dj-row head">
            <span>Faixa</span>
            <span>BPM</span>
            <span>Tom</span>
            <span>Duração</span>
            <span>Cues</span>
            <span />
          </div>
          {!rows.length && (
            <p className="dim dj-empty">
              {tab === 'project' ? 'Nenhuma música no projeto. Importe arquivos no editor, use a biblioteca livre ou importe sua biblioteca de DJ.' : library ? 'Nenhuma faixa encontrada.' : 'Importe a biblioteca do rekordbox, Traktor, Serato ou Engine DJ (botões acima).'}
            </p>
          )}
          {rows.map((r) => {
            const match = refCamelot && r.camelot ? compatible(refCamelot, r.camelot) : null
            const bpmClose = refBpm && r.bpm ? Math.abs(r.bpm - refBpm) / refBpm < 0.06 || Math.abs(r.bpm * 2 - refBpm) / refBpm < 0.06 || Math.abs(r.bpm / 2 - refBpm) / refBpm < 0.06 : null
            return (
              <div key={r.id} className={`dj-row ${r.missing ? 'missing' : ''}`} draggable={!r.missing} onDragStart={(e) => e.dataTransfer.setData('text/miszt-dj', r.id)}>
                <span className="dj-track">
                  <AudioLines size={14} />
                  <span className="ellipsis">
                    <strong>{r.title}</strong>
                    {r.artist && <em> · {r.artist}</em>}
                  </span>
                </span>
                <span className={bpmClose ? 'ok' : ''}>{r.bpm ? r.bpm.toFixed(1) : '—'}</span>
                <span>{r.camelot ? <span className={`camelot small ${match ? 'good' : match === false ? 'bad' : ''}`}>{r.camelot}</span> : '—'}</span>
                <span>{r.duration ? formatTime(r.duration, false) : '—'}</span>
                <span>{r.cues || '—'}</span>
                <span className="dj-actions">
                  {r.media && (!r.media.beats || !r.media.key) && (
                    <button className="icon-btn" onClick={() => void analyze(r.media!)} disabled={analyzing.has(r.id)} data-tip="Detectar BPM e tom">
                      {analyzing.has(r.id) ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
                    </button>
                  )}
                  <button className="chip deck-a-chip" onClick={() => void loadRow(A, r)} disabled={r.missing}>
                    A
                  </button>
                  <button className="chip deck-b-chip" onClick={() => void loadRow(B, r)} disabled={r.missing}>
                    B
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {recResult && (
        <div className="modal-backdrop">
          <div className="modal record-dialog">
            <div className="export-head">
              <span className="export-icon">
                <Disc3 size={20} />
              </span>
              <div>
                <h2>Set gravado · {formatTime(recResult.duration, false)}</h2>
                <span className="dim">Entra no fim da timeline do projeto</span>
              </div>
            </div>
            <div className="toggle-col">
              <Toggle checked={recOpts.audio} onChange={(v) => setRecOpts((o) => ({ ...o, audio: v }))} label="Áudio do set (exatamente como você ouviu, com EQ, filtro e stems)" />
              <Toggle checked={recOpts.clips} onChange={(v) => setRecOpts((o) => ({ ...o, clips: v }))} label="Clipes editáveis de cada deck (trechos, andamento e volume do fader)" />
            </div>
            {recOpts.audio && recOpts.clips && <p className="hint left">As trilhas Deck A e Deck B entram silenciadas, para o som não dobrar. Ative-as se apagar o áudio gravado.</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setRecResult(null)} disabled={saving}>
                Descartar
              </button>
              <button className="btn primary" onClick={() => void saveSet()} disabled={saving || (!recOpts.audio && !recOpts.clips)}>
                {saving ? 'Salvando…' : 'Adicionar à timeline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
