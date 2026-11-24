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
          <p>A interface encontrou um erro inesperado. O salvamento automático guarda uma cópia do seu projeto; ao reabrir, você poderá recuperá-la.</p>
          <pre>{this.state.error.message}</pre>
          <button className="btn primary" onClick={() => location.reload()}>
            Recarregar o editor
          </button>
        </div>
      </div>
    )
  }
}
