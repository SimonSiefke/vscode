import assert from 'node:assert/strict'
import { Worker, MessageChannel, parentPort, isMainThread } from 'node:worker_threads'
import { openSync, readSync, writeSync, writeFileSync, closeSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
const options = JSON.parse(process.env.IPC_OPT_BENCH_OPTIONS)
const load = (path) => import('file://' + options.root + '/out/' + path)
const [{ RPCProtocol: LegacyRPCProtocol, StructuredCloneRPCProtocol }, { RPCMessagePort }, { ProxyIdentifier }] = await Promise.all([
  load(options.module),
  load(options.portModule || 'vs/workbench/services/extensions/common/rpcMessagePort.js'),
  load('vs/workbench/services/extensions/common/proxyIdentifier.js'),
])
const RPCProtocol = StructuredCloneRPCProtocol || LegacyRPCProtocol
const [{ Event }, { VSBuffer }] = await Promise.all([load('vs/base/common/event.js'), load('vs/base/common/buffer.js')])
let sentPackets = 0
const createTransport = port => {
  if (StructuredCloneRPCProtocol) {
    const protocol = new RPCMessagePort(data => { sentPackets++; port.postMessage(data) }, options.batching)
    port.on('message', data => protocol.acceptMessage(data))
    return protocol
  }
  return { onMessage: Event.fromNodeEventEmitter(port, 'message', data => VSBuffer.wrap(data)), send: data => { sentPackets++; port.postMessage(data.buffer) } }
}
const collectGarbage = async () => {
  const session = new Session()
  session.connect()
  try {
    await session.post('HeapProfiler.collectGarbage')
  } finally {
    session.disconnect()
  }
}
const identifier = new ProxyIdentifier('instruction-benchmark')
if (!isMainThread) {
  let requests = 0
  parentPort.on('message', async (message) => {
    try {
      if (message.command === 'start') {
        assert.equal(identifier.nid, message.identifier)
        const port = message.port
        const protocol = createTransport(port)
        port.start()
        const rpc = new RPCProtocol(protocol)
        rpc.set(identifier, {
          $echo: (value) => {
            requests++
            return options.handler === 'resolved'
              ? Promise.resolve(value)
              : options.handler === 'deferred'
                ? new Promise((resolve) => setImmediate(() => resolve(value)))
                : value
          },
        })
        parentPort.postMessage({ ready: true, node: process.version, poolSize: Buffer.poolSize })
      } else if (message.command === 'gc') {
        await collectGarbage()
        parentPort.postMessage({ collected: true })
      } else if (message.command === 'stats') {
        parentPort.postMessage({ requests, sentPackets })
      }
    } catch (error) {
      parentPort.postMessage({ error: String(error.stack) })
    }
  })
} else {
  const pair = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url))
  const controlWorker = (message) =>
    new Promise((resolve, reject) => {
      worker.once('message', (result) => (result.error ? reject(new Error(result.error)) : resolve(result)))
      worker.once('error', reject)
      worker.postMessage(message)
    })
  const ready = new Promise((resolve, reject) => {
    worker.once('message', (result) => (result.error ? reject(new Error(result.error)) : resolve(result)))
    worker.once('error', reject)
  })
  worker.postMessage({ command: 'start', port: pair.port2, identifier: identifier.nid }, [pair.port2])
  const metadata = await ready
  const protocol = createTransport(pair.port1)
  pair.port1.start()
  const rpc = new RPCProtocol(protocol)
  const proxy = rpc.getProxy(identifier)
  const fixtures = {
    primitive: 42,
    'small-object': { command: 'open', options: { pinned: true }, ids: [1, 2, 3] },
    'settings-100': Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => ['setting' + i, { enabled: true, value: i, scopes: ['user', 'workspace'] }]),
    ),
    'text-4KiB': 'x'.repeat(4096),
    'text-64KiB': 'x'.repeat(65536),
    'text-escaped': '"quoted"\\path\r\n😊'.repeat(256),
  }
  assert.ok(Object.hasOwn(fixtures, options.fixture))
  const fixture = fixtures[options.fixture]
  const concurrency = options.concurrency || 1
  const pending = new Array(concurrency)
  let last
  const run = async (iterations) => {
    assert.equal(iterations % concurrency, 0)
    if (concurrency === 1) {
      for (let i = 0; i < iterations; i++) last = await proxy.$echo(fixture)
    } else {
      for (let i = 0; i < iterations; i += concurrency) {
        for (let j = 0; j < concurrency; j++) pending[j] = proxy.$echo(fixture)
        last = (await Promise.all(pending))[0]
      }
    }
  }
  let ctl, ack
  try {
    await run(options.warmup || 20000)
    assert.deepEqual(last, fixture)
    await controlWorker({ command: 'gc' })
    await collectGarbage()
    const before = await controlWorker({ command: 'stats' })
    ctl = openSync(process.env.PERF_CONTROL, 'w')
    ack = openSync(process.env.PERF_ACK, 'r')
    const buffer = Buffer.alloc(5)
    const gate = (command) => {
      writeSync(ctl, command + '\n')
      let length = 0
      while (length < 5) {
        const n = readSync(ack, buffer, length, 5 - length, null)
        if (!n) throw new Error('Perf acknowledgement closed')
        length += n
      }
      assert.equal(buffer.toString(), 'ack\n\0')
    }
    const sentBefore = sentPackets
    gate('enable')
    const startCpu = process.cpuUsage()
    const start = performance.now()
    await run(options.iterations)
    const elapsedMs = performance.now() - start
    const cpu = process.cpuUsage(startCpu)
    gate('disable')
    assert.deepEqual(last, fixture)
    const after = await controlWorker({ command: 'stats' })
    assert.equal(after.requests - before.requests, options.iterations)
    writeFileSync(
      process.env.OUTPUT,
      JSON.stringify(
        {
          options,
          node: process.version,
          poolSize: Buffer.poolSize,
          worker: metadata,
          measuredLogicalCalls: after.requests - before.requests,
          packets: sentPackets - sentBefore + after.sentPackets - before.sentPackets,
          elapsedMs,
          processCpuMicroseconds: cpu,
          hardwareCounting:
            'Enabled after warmup and full GC in both isolates; disabled before final result and request-count validation; includes both worker threads',
        },
        null,
        2,
      ),
    )
  } finally {
    if (ctl !== undefined) closeSync(ctl)
    if (ack !== undefined) closeSync(ack)
    rpc.dispose()
    pair.port1.close()
    await worker.terminate()
  }
}
