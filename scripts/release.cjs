// Publica a versão atual (package.json) como Release do GitHub, com o instalador e os
// arquivos que a atualização automática lê (latest.yml e .blockmap).
//
// Uso: npm run dist && npm run release
// Token: variável GH_TOKEN (ou GITHUB_TOKEN); sem ela, usa a credencial do GitHub já salva no Git.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const { owner, repo } = pkg.build.publish[0]
const version = pkg.version
const tag = `v${version}`
const dir = path.join(root, 'release')
const exe = `MisztStudio-Setup-${version}.exe`
const assets = [exe, `${exe}.blockmap`, 'latest.yml']

function fail(msg) {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

function token() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  // Credencial que o Git já usa para dar push (Git Credential Manager). Não é exibida.
  const r = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', cwd: root })
  const m = /^password=(.+)$/m.exec(r.stdout || '')
  return m ? m[1].trim() : null
}

/** Novidades da versão, tiradas do CHANGELOG.md (seção "## x.y.z"). */
function notes() {
  const file = path.join(root, 'CHANGELOG.md')
  if (!fs.existsSync(file)) return ''
  const text = fs.readFileSync(file, 'utf8')
  const start = text.indexOf(`## ${version}`)
  if (start < 0) return ''
  const rest = text.slice(start).split('\n').slice(1).join('\n')
  const end = rest.search(/^## /m)
  return (end < 0 ? rest : rest.slice(0, end)).trim()
}

async function api(url, init, auth) {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init && init.headers) } })
  if (!res.ok) fail(`GitHub respondeu ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return res.json()
}

;(async () => {
  for (const a of assets) if (!fs.existsSync(path.join(dir, a))) fail(`Falta ${a} em release/. Rode "npm run dist" antes.`)
  const yml = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')
  if (!yml.includes(`version: ${version}`)) fail('latest.yml é de outra versão. Rode "npm run dist" de novo.')
  const auth = token()
  if (!auth) fail('Nenhum token encontrado. Defina GH_TOKEN ou faça login no GitHub pelo Git.')

  const base = `https://api.github.com/repos/${owner}/${repo}`
  const existing = await fetch(`${base}/releases/tags/${tag}`, { headers: { Authorization: `Bearer ${auth}` } })
  if (existing.ok) fail(`A Release ${tag} já existe. Suba a versão no package.json.`)

  console.log(`Criando a Release ${tag}…`)
  const release = await api(`${base}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: `Miszt Studio ${version}`, body: notes() || `Miszt Studio ${version}`, draft: false, prerelease: false }),
  })

  for (const a of assets) {
    const file = path.join(dir, a)
    const size = fs.statSync(file).size
    process.stdout.write(`Enviando ${a} (${(size / 1048576).toFixed(1)} MB)… `)
    const url = release.upload_url.replace(/\{.*\}$/, `?name=${encodeURIComponent(a)}`)
    await api(url, { method: 'POST', headers: { 'Content-Type': a.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream', 'Content-Length': String(size) }, body: fs.readFileSync(file) })
    console.log('ok')
  }
  console.log(`\n✔ Publicada: ${release.html_url}`)
})().catch((err) => fail(err.message || String(err)))
