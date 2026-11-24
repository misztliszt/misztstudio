export function formatTime(t: number, fraction = true) {
  // Trabalha em décimos inteiros: 2,3 % 1 dá 0,2999… em ponto flutuante e mostrava ".2".
  const tenths = Math.floor(Math.max(0, Number.isFinite(t) ? t : 0) * 10 + 1e-6)
  const whole = Math.floor(tenths / 10)
  const m = Math.floor(whole / 60)
  const sec = whole % 60
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return fraction ? `${base}.${tenths % 10}` : base
}
