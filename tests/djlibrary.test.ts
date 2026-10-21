import { afterAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const require = createRequire(import.meta.url)
const dj = require('../electron/djlibrary.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-dj-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('nomes de tom', () => {
  it.each([
    ['Fm', 5, 'minor', '4A'],
    ['F#m', 6, 'minor', '11A'],
    ['Bb', 10, 'major', '6B'],
    ['C', 0, 'major', '8B'],
    ['4A', 5, 'minor', '4A'],
    ['8B', 0, 'major', '8B'],
    ['1d', 0, 'major', '8B'],
    ['1m', 9, 'minor', '8A'],
  ])('%s', (text, key, mode, camelot) => expect(dj.parseKeyName(text)).toMatchObject({ key, mode, camelot }))
  it('Traktor e Engine', () => {
    expect(dj.traktorKey(5)).toMatchObject({ key: 5, mode: 'major' })
    expect(dj.traktorKey(17)).toMatchObject({ key: 5, mode: 'minor' })
    expect(dj.engineKey(17)).toMatchObject({ key: 5, mode: 'minor', camelot: '4A' })
    expect(dj.engineKey(1)).toMatchObject({ key: 9, mode: 'minor' })
  })
})

describe('rekordbox (XML)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <COLLECTION Entries="2">
    <TRACK TrackID="11" Name="Run &amp; Go" Artist="Teste" TotalTime="215" AverageBpm="128.00" Tonality="Fm" Location="file://localhost/C:/M%C3%BAsicas/run%20go.mp3">
      <TEMPO Inizio="0.120" Bpm="128.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="Drop" Type="0" Start="64.500" Num="0" Red="40" Green="226" Blue="20"/>
      <POSITION_MARK Name="" Type="0" Start="32.000" Num="-1"/>
    </TRACK>
    <TRACK TrackID="12" Name="Outra" Artist="B" TotalTime="180" AverageBpm="124.00" Tonality="8A" Location="file://localhost/D:/x.mp3"/>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Name="Festa" Type="1" KeyType="0" Entries="2">
        <TRACK Key="12"/>
        <TRACK Key="11"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>`
  it('faixas, grade, tom, cues e playlists', () => {
    const lib = dj.parseRekordbox(xml)
    expect(lib.tracks).toHaveLength(2)
    const t = lib.tracks[0]
    expect(t).toMatchObject({ title: 'Run & Go', bpm: 128, duration: 215, grid: { bpm: 128, offset: 0.12 } })
    expect(t.path).toBe(path.join('C:/Músicas/run go.mp3'))
    expect(t.key).toMatchObject({ camelot: '4A' })
    expect(t.cues.find((c: { num: number | null }) => c.num === 0)).toMatchObject({ name: 'Drop', time: 64.5, color: 'rgb(40,226,20)' })
    expect(lib.tracks[1].key).toMatchObject({ key: 9, mode: 'minor' })
    expect(lib.playlists).toEqual([{ name: 'Festa', trackIds: ['rb-12', 'rb-11'] }])
  })
})

describe('Traktor (NML)', () => {
  const nml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Faixa" ARTIST="DJ"><LOCATION DIR="/:Users/:eu/:Music/:" FILE="faixa.mp3" VOLUME="C:" VOLUMEID="x"></LOCATION>
<INFO PLAYTIME="200" PLAYTIME_FLOAT="200.5" KEY="9m"></INFO><TEMPO BPM="126.000000" BPM_QUALITY="100"></TEMPO>
<MUSICAL_KEY VALUE="21"></MUSICAL_KEY>
<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="85.5" LEN="0" REPEATS="-1" HOTCUE="-1"></CUE_V2>
<CUE_V2 NAME="Intro" DISPL_ORDER="0" TYPE="0" START="15000" LEN="0" REPEATS="-1" HOTCUE="0"></CUE_V2>
<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="5" START="30000" LEN="7500" REPEATS="-1" HOTCUE="1"></CUE_V2>
</ENTRY></COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1"><NODE TYPE="PLAYLIST" NAME="Sexta"><PLAYLIST ENTRIES="1" TYPE="LIST"><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="C:/:Users/:eu/:Music/:faixa.mp3"></PRIMARYKEY></ENTRY></PLAYLIST></NODE></SUBNODES></NODE></PLAYLISTS></NML>`
  it('caminho, BPM, tom, grade, hot cues, loop e playlist', () => {
    const lib = dj.parseTraktor(nml)
    const t = lib.tracks[0]
    expect(t.path).toBe(path.normalize('C:/Users/eu/Music/faixa.mp3'))
    expect(t).toMatchObject({ title: 'Faixa', bpm: 126, duration: 200.5, grid: { bpm: 126, offset: 0.0855 } })
    expect(t.key).toMatchObject({ key: 9, mode: 'minor' })
    expect(t.cues).toEqual([
      { name: 'Intro', time: 15, num: 0, color: null, loop: null },
      { name: '', time: 30, num: 1, color: null, loop: 7.5 },
    ])
    expect(lib.playlists).toEqual([{ name: 'Sexta', trackIds: ['tk-0'] }])
  })
})

/** MP3 mínimo só com a tag ID3v2.4 (TIT2, TBPM, TKEY e GEOB "Serato Markers2"). */
function writeSeratoMp3(file: string) {
  const frame = (id: string, data: Buffer) => {
    const h = Buffer.alloc(10)
    h.write(id, 0, 'latin1')
    const n = data.length
    h[4] = (n >> 21) & 0x7f
    h[5] = (n >> 14) & 0x7f
    h[6] = (n >> 7) & 0x7f
    h[7] = n & 0x7f
    return Buffer.concat([h, data])
  }
  const text = (s: string) => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')])
  const cue = (idx: number, ms: number, rgb: number[], name: string) => {
    const d = Buffer.alloc(12)
    d[1] = idx
    d.writeUInt32BE(ms, 2)
    d[7] = rgb[0]
    d[8] = rgb[1]
    d[9] = rgb[2]
    const body = Buffer.concat([d, Buffer.from(name, 'utf8'), Buffer.from([0])])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    return Buffer.concat([Buffer.from('CUE\0', 'latin1'), len, body])
  }
  const markers = Buffer.concat([Buffer.from([1, 1]), cue(0, 12345, [204, 0, 0], 'Verso'), cue(3, 90000, [0, 0, 204], ''), Buffer.from([0])])
  const b64 = markers.toString('base64').replace(/=+$/, '')
  const geobData = Buffer.concat([Buffer.from([0]), Buffer.from('application/octet-stream\0\0Serato Markers2\0', 'latin1'), Buffer.from([1, 1]), Buffer.from(b64, 'latin1')])
  const frames = Buffer.concat([frame('TIT2', text('Minha faixa')), frame('TBPM', text('125')), frame('TKEY', text('Am')), frame('GEOB', geobData)])
  const head = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])
  const n = frames.length
  head[6] = (n >> 21) & 0x7f
  head[7] = (n >> 14) & 0x7f
  head[8] = (n >> 7) & 0x7f
  head[9] = n & 0x7f
  fs.writeFileSync(file, Buffer.concat([head, frames, Buffer.alloc(64)]))
}

describe('Serato (tags no MP3)', () => {
  it('título, BPM, tom e hot cues com cor', () => {
    const folder = path.join(dir, 'serato')
    fs.mkdirSync(folder)
    writeSeratoMp3(path.join(folder, 'a.mp3'))
    fs.writeFileSync(path.join(folder, 'sem-tag.mp3'), Buffer.alloc(100))
    const lib = dj.scanSerato(folder)
    expect(lib.tracks).toHaveLength(1)
    const t = lib.tracks[0]
    expect(t).toMatchObject({ title: 'Minha faixa', bpm: 125, grid: { bpm: 125, offset: 0 } })
    expect(t.key).toMatchObject({ key: 9, mode: 'minor' })
    expect(t.cues).toEqual([
      { name: 'Verso', time: 12.345, num: 0, color: 'rgb(204,0,0)', loop: null },
      { name: '', time: 90, num: 3, color: 'rgb(0,0,204)', loop: null },
    ])
  })
})

describe('Engine DJ (SQLite)', () => {
  it('faixas, tom, grade, quick cues e playlists', async () => {
    const initSqlJs = require('sql.js')
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run('CREATE TABLE Track (id INTEGER PRIMARY KEY, path TEXT, title TEXT, artist TEXT, length INTEGER, bpm INTEGER, bpmAnalyzed REAL, key INTEGER, trackData BLOB, beatData BLOB, quickCues BLOB)')
    db.run('CREATE TABLE Playlist (id INTEGER PRIMARY KEY, title TEXT)')
    db.run('CREATE TABLE PlaylistEntity (id INTEGER PRIMARY KEY, listId INTEGER, trackId INTEGER)')
    const q = (buf: Buffer) => {
      const size = Buffer.alloc(4)
      size.writeUInt32BE(buf.length)
      return Buffer.concat([size, zlib.deflateSync(buf)])
    }
    const td = Buffer.alloc(8)
    td.writeDoubleBE(44100, 0)
    const cues = [Buffer.alloc(8)]
    cues[0].writeBigInt64BE(2n)
    const cue = (label: string, samples: number) => {
      const b = Buffer.alloc(1 + label.length + 12)
      b[0] = label.length
      b.write(label, 1, 'utf8')
      b.writeDoubleBE(samples, 1 + label.length)
      b[1 + label.length + 8] = 255
      b[1 + label.length + 9] = 10
      b[1 + label.length + 10] = 20
      b[1 + label.length + 11] = 30
      return b
    }
    cues.push(cue('Drop', 44100 * 60), cue('', -1))
    const bd = Buffer.alloc(41)
    bd.writeDoubleBE(44100, 0)
    bd.writeDoubleBE(44100 * 200, 8)
    bd[16] = 1
    bd.writeBigInt64BE(2n, 17)
    bd.writeDoubleBE(44100 * 0.5, 25)
    bd.writeBigInt64BE(0n, 33)
    db.run('INSERT INTO Track VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['../Music/x.mp3', 'X', 'Y', 200, 128, 128, 17, q(td), q(bd), q(Buffer.concat(cues))])
    db.run("INSERT INTO Playlist VALUES (1, 'Aquecimento')")
    db.run('INSERT INTO PlaylistEntity VALUES (1, 1, 1)')
    const libDir = path.join(dir, 'Engine Library', 'Database2')
    fs.mkdirSync(libDir, { recursive: true })
    fs.writeFileSync(path.join(libDir, 'm.db'), Buffer.from(db.export()))
    db.close()

    const lib = await dj.parseEngine(path.join(libDir, 'm.db'))
    const t = lib.tracks[0]
    expect(t.path).toBe(path.resolve(dir, 'Engine Library', '../Music/x.mp3'))
    expect(t).toMatchObject({ title: 'X', artist: 'Y', bpm: 128, duration: 200 })
    expect(t.key).toMatchObject({ camelot: '4A' })
    // A grade é guardada como a primeira batida (0,5 s menos uma batida de 0,46875 s).
    expect(t.grid.offset).toBeCloseTo(0.5 - 60 / 128)
    expect(t.cues).toEqual([{ name: 'Drop', time: 60, num: 0, color: 'rgb(10,20,30)', loop: null }])
    expect(lib.playlists).toEqual([{ name: 'Aquecimento', trackIds: ['en-1'] }])
  })
})
