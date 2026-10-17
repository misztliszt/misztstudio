export function formatTime(t: number, fraction = true) {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return fraction ? `${base}.${String(Math.floor((s % 1) * 10))}` : base
}
