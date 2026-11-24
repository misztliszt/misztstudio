// Thread de processamento de áudio (ver dsp-tasks.cjs).
const { parentPort, workerData } = require('node:worker_threads')
const { TASKS } = require('./dsp-tasks.cjs')

try {
  TASKS[workerData.task](...workerData.args)
  parentPort.postMessage({ ok: true })
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) })
}
