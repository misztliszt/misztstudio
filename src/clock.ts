import { useSyncExternalStore } from 'react'

/**
 * Posição do cursor da timeline fora do estado do React. Durante a reprodução ela muda
 * a cada quadro; só os componentes que precisam disso (cursor, timecode, barra) se
 * inscrevem, e o resto do app recebe atualizações espaçadas.
 */
class Clock {
  private t = 0
  private listeners = new Set<() => void>()

  get = () => this.t

  set(t: number) {
    if (t === this.t) return
    this.t = t
    for (const l of this.listeners) l()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
}

export const clock = new Clock()

export function useClockTime() {
  return useSyncExternalStore(clock.subscribe, clock.get)
}
