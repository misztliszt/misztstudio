// Gravação de arquivos que não pode corromper o que já existe.

const fs = require('node:fs')

/**
 * Grava `data` em `target` sem nunca deixar o arquivo pela metade: escreve num provisório ao lado,
 * força o disco e só então troca o original (rename é atômico no mesmo volume).
 * Com `backup`, a versão anterior fica em `<arquivo>.bak`.
 */
function writeFileAtomic(target, data, { backup = false } = {}) {
  const tmp = `${target}.${process.pid}.tmp`
  let fd
  try {
    fd = fs.openSync(tmp, 'w')
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    if (backup && fs.existsSync(target)) {
      try {
        fs.copyFileSync(target, `${target}.bak`)
      } catch {
        // o backup é um extra: não impede o salvamento
      }
    }
    fs.renameSync(tmp, target)
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // já fechado
      }
    }
    fs.rmSync(tmp, { force: true })
    throw err
  }
}

module.exports = { writeFileAtomic }
