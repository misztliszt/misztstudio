// Limpeza dos restos que o programa deixa em disco: só o que nunca é usado por um projeto
// (tarefas interrompidas e arquivos provisórios). Resultados que um projeto pode citar
// (stems prontos, áudio processado, quadros congelados, vídeos invertidos) nunca são apagados aqui.

const fs = require('node:fs')
const path = require('node:path')

const DAY = 24 * 60 * 60 * 1000

function ageOf(p, now) {
  try {
    return now - fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * @param {{ userData: string, tmp: string, now?: number }} opts
 * @returns {string[]} o que foi removido (para registro e testes)
 */
function cleanupCaches({ userData, tmp, now = Date.now() }) {
  const removed = []
  const rm = (p) => {
    try {
      fs.rmSync(p, { recursive: true, force: true })
      removed.push(p)
    } catch {
      // arquivo em uso: fica para a próxima vez
    }
  }

  // Remoção de fundo interrompida: as pastas de trabalho (quadros + máscaras) ficam GBs no disco.
  for (const name of listDir(path.join(userData, 'bgremove'))) {
    const p = path.join(userData, 'bgremove', name)
    if (ageOf(p, now) > DAY) rm(p)
  }

  // Separação de faixas que não terminou (sem stems.json): sobra o WAV de entrada, grande.
  for (const name of listDir(path.join(userData, 'stems'))) {
    const p = path.join(userData, 'stems', name)
    if (!fs.existsSync(path.join(p, 'stems.json')) && ageOf(p, now) > DAY && fs.statSync(p).isDirectory()) rm(p)
  }

  // Arquivos provisórios (.parcial / .part) de qualquer cache, com mais de um dia.
  for (const dir of [path.join(userData, 'processed-audio'), path.join(userData, 'reversed'), path.join(userData, 'bgremoved'), path.join(tmp, 'miszt-studio-proxies'), path.join(tmp, 'miszt-studio-thumbs')]) {
    for (const name of listDir(dir)) {
      if (/\.(parcial|part)(\.|$)/.test(name) && ageOf(path.join(dir, name), now) > DAY) rm(path.join(dir, name))
    }
  }

  // Miniaturas: são refeitas ao importar de novo; as de meses atrás só ocupam espaço.
  for (const name of listDir(path.join(tmp, 'miszt-studio-thumbs'))) {
    const p = path.join(tmp, 'miszt-studio-thumbs', name)
    if (ageOf(p, now) > 60 * DAY) rm(p)
  }
  return removed
}

module.exports = { cleanupCaches }
