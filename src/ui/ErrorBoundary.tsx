import { Component, type ReactNode } from 'react'

/** Mostra uma tela de recuperação em vez de uma janela em branco se a interface quebrar. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Algo deu errado</h1>
          <p>A interface encontrou um erro inesperado. O autosave guarda seu projeto a cada 20 segundos; ao reabrir, você poderá recuperá-lo.</p>
          <pre>{this.state.error.message}</pre>
          <button className="btn primary" onClick={() => location.reload()}>
            Recarregar o editor
          </button>
        </div>
      </div>
    )
  }
}
