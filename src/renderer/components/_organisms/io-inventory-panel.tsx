import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules/modal'
import { openPLCStoreBase, useOpenPLCStore } from '@root/renderer/store'
import {
  beginIoObservation,
  cancelIoObservation,
  clearIoObservation,
  finishIoObservation,
  getIoObservation,
} from '@root/renderer/utils/io-observation'
import { compareIoModule, ioChannels, type IoInventory, moduleName } from '@root/types/PLC/io-inventory'
import { useEffect, useRef, useState } from 'react'

const button = 'rounded-md bg-brand px-3 py-2 text-xs text-white disabled:opacity-50'
export function IoInventoryPanel() {
  const project = useOpenPLCStore((s) => s.project)
  const config = useOpenPLCStore((s) => s.deviceDefinitions.configuration)
  const setLayout = useOpenPLCStore((s) => s.deviceActions.setIoLayout)
  const editors = useOpenPLCStore((s) => s.editors)
  const editor = useOpenPLCStore((s) => s.editor)
  const initialHost =
    config.runtimeIpAddress ||
    config.communicationPort ||
    config.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.ipAddress
  const [host, setHost] = useState(initialHost)
  const [snapshot, setSnapshot] = useState<IoInventory>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [confirm, setConfirm] = useState(false)
  const [selected, setSelected] = useState(1)
  const epoch = useRef(0)
  const observationId = useRef(0)
  useEffect(() => {
    epoch.current++
    const cached = getIoObservation()
    const matching =
      cached?.projectPath === project.meta.path &&
      cached.board === config.deviceBoard &&
      cached.configuredHost === initialHost &&
      cached.requestedHost === initialHost
    setSnapshot(matching ? cached.inventory : undefined)
    setError(
      matching && cached.state !== 'success' ? 'Last read was not completed successfully; read hardware again.' : '',
    )
    setBusy(false)
    setConfirm(false)
    setHost(initialHost)
    return () => {
      epoch.current++
      cancelIoObservation(observationId.current)
    }
  }, [project.meta.path, config.deviceBoard, initialHost])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const fresh = !!snapshot && snapshot.host === host && now - snapshot.readAt < 30000 && !error && snapshot.verified
  const scan = async () => {
    const generation = ++epoch.current
    const scanId = beginIoObservation({
      projectPath: project.meta.path,
      board: config.deviceBoard,
      configuredHost: initialHost,
      requestedHost: host,
      inventory: snapshot,
    })
    observationId.current = scanId
    setBusy(true)
    setError('')
    try {
      const result = await window.bridge.readIoInventory(host)
      if (generation !== epoch.current) return
      if (result.success) {
        finishIoObservation(scanId, result.inventory)
        setSnapshot(result.inventory)
        setNow(Date.now())
      } else {
        finishIoObservation(scanId)
        setError(result.error)
      }
    } catch (e) {
      if (generation === epoch.current) {
        finishIoObservation(scanId)
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (generation === epoch.current) setBusy(false)
    }
  }
  const expected = config.ioLayout?.find((m) => m.slot === selected)
  const detected = snapshot?.modules.find((m) => m.slot === selected)
  const addresses = new Set(
    [...ioChannels(selected, expected?.type ?? 0), ...ioChannels(selected, detected?.type ?? 0)]
      .flatMap((c) => [c.input, c.output])
      .filter(Boolean),
  )
  const references: string[] = []
  for (const variable of project.data.configuration.resource.globalVariables)
    if (addresses.has(variable.location)) references.push(`Global: ${variable.name} (${variable.location})`)
  for (const pou of project.data.pous) {
    for (const v of pou.data.variables)
      if (addresses.has(v.location)) references.push(`${pou.data.name}: ${v.name} (${v.location})`)
    const active = [...editors, editor].filter((e) => e.meta.name === pou.data.name).at(-1)
    const pending =
      active && (active.type === 'plc-textual' || active.type === 'plc-graphical') && active.variable.display === 'code'
        ? active.variable.code
        : undefined
    const text = (pending ?? pou.data.variablesText ?? '') + '\n' + JSON.stringify(pou.data.body)
    const hits = [...new Set(text.match(/%[IQ](?:X\d+\.\d+|W\d+)\b/gi) ?? [])].filter((a) =>
      addresses.has(a.toUpperCase()),
    )
    if (hits.length) references.push(`${pou.data.name}: possible source/diagram references ${hits.join(', ')}`)
  }
  const adopt = () => {
    if (!fresh || !snapshot || busy || snapshot.modules.some((m) => m.type !== 0 && !m.communicationOk)) return
    if (openPLCStoreBase.getState().project.meta.path !== project.meta.path) return
    setLayout(snapshot.modules.map(({ slot, type, ident, registerCount }) => ({ slot, type, ident, registerCount })))
    setConfirm(false)
  }
  return (
    <section
      className='flex shrink-0 flex-col gap-3 pb-6 text-xs text-neutral-950 dark:text-neutral-100'
      aria-label='IO modules'
    >
      <h3 className='text-lg font-medium'>IO modules — project / generator</h3>
      <p>Physical slots 1–7. Channel numbers start at 1; IEC bit numbers start at 0.</p>
      <div className='flex flex-wrap items-center gap-2'>
        <label>
          Generator IP{' '}
          <input
            aria-label='IO generator IP'
            className='ml-2 w-36 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700'
            value={host}
            disabled={busy}
            onChange={(e) => {
              epoch.current++
              clearIoObservation(project.meta.path)
              setHost(e.target.value)
              setSnapshot(undefined)
              setError('')
            }}
          />
        </label>
        <button className={button} disabled={busy || !host} onClick={() => void scan()}>
          {busy ? 'Reading…' : 'Read hardware'}
        </button>
        <button
          className={button}
          disabled={!fresh || busy || snapshot?.modules.some((m) => m.type !== 0 && !m.communicationOk)}
          onClick={() => setConfirm(true)}
        >
          Use detected layout…
        </button>
      </div>
      <p role='status'>
        {error
          ? `Read failed: ${error}. Previous data is not current.`
          : snapshot
            ? `Read ${new Date(snapshot.readAt).toLocaleTimeString()} from ${snapshot.host}${!snapshot.verified ? ' — all metadata is zero: empty hardware and unsupported firmware cannot be distinguished.' : !fresh ? ' — snapshot expired; read hardware again.' : ' — verified inventory format v1.'}`
            : 'No hardware read yet. The project layout remains available offline.'}
      </p>
      <div className='overflow-x-auto'>
        <table className='w-full border-collapse text-left'>
          <thead>
            <tr className='border-b border-neutral-400'>
              <th className='p-2'>Slot</th>
              <th>Project</th>
              <th>Detected</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 7 }, (_, i) => i + 1).map((slot) => {
              const want = config.ioLayout?.find((m) => m.slot === slot)
              const actual = snapshot?.modules.find((m) => m.slot === slot)
              const status = compareIoModule(want, actual, fresh)
              return (
                <tr
                  key={slot}
                  className={`border-b border-neutral-200 dark:border-neutral-800 ${selected === slot ? 'bg-brand/10' : ''}`}
                >
                  <td className='p-2'>
                    <button className='underline' onClick={() => setSelected(slot)} aria-label={`Show slot ${slot}`}>
                      {slot}
                    </button>
                  </td>
                  <td>{want ? moduleName(want.type) : 'Not configured'}</td>
                  <td>{actual ? moduleName(actual.type) : 'Unknown'}</td>
                  <td
                    className={
                      status === 'Match'
                        ? 'text-green-600'
                        : status === 'Not verified' || status === 'Not configured'
                          ? 'text-neutral-500'
                          : 'text-red-500'
                    }
                  >
                    {status}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className='rounded border border-neutral-200 p-3 dark:border-neutral-700'>
        <h4 className='mb-2 font-semibold'>Slot {selected} — channels and affected references</h4>
        <p>
          Project:{' '}
          {expected ? `ident 0x${expected.ident.toString(16)}, ${expected.registerCount} registers` : 'not configured'}{' '}
          · Detected:{' '}
          {detected ? `ident 0x${detected.ident.toString(16)}, ${detected.registerCount} registers` : 'unknown'}
        </p>
        <p className='my-2'>Module ident identifies the model, not a serial number.</p>
        {[
          { label: 'Project addresses', module: expected },
          ...(detected && detected.type !== expected?.type ? [{ label: 'Detected addresses', module: detected }] : []),
        ].map(
          (group) =>
            group.module &&
            group.module.type !== 0 && (
              <div key={group.label} className='mt-2'>
                <p className='font-semibold'>{group.label}</p>
                <div className='flex flex-wrap gap-x-4 gap-y-1'>
                  {ioChannels(selected, group.module.type).map((c) => (
                    <span key={c.channel}>
                      Ch {c.channel}: {[c.input, c.output].filter(Boolean).join(' / ')}
                    </span>
                  ))}
                </div>
              </div>
            ),
        )}
        <ul className='mt-3 list-inside list-disc'>
          {references.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {!references.length && (
          <p className='mt-2'>No matching references found in the checked variables and POU sources.</p>
        )}
        <p className='mt-2 text-neutral-500'>
          Reference preview only. Changing the project layout does not rewrite PLC addresses. Source hits may include
          comments; pending global declaration code is not analysed here.
        </p>
      </div>
      <p className='text-neutral-500'>
        Read-only inventory; no output writes or PLC mode changes. Firmware scans the cards at startup; this button
        reads that inventory and does not initiate a hot-plug scan.
      </p>
      <Modal open={confirm} onOpenChange={setConfirm}>
        <ModalContent className='h-fit max-h-[85vh] w-[520px] overflow-auto'>
          <ModalTitle>Use detected IO layout?</ModalTitle>
          <p className='text-sm'>
            Replace the project's expected module layout with the seven detected slots. PLC code and variable addresses
            stay unchanged. Save the project to persist the layout.
          </p>
          <p className='text-sm'>
            Review any missing or different modules and their affected references before continuing.
          </p>
          <div className='flex justify-end gap-2'>
            <button className={button} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button className={button} disabled={!fresh || busy} onClick={adopt}>
              Use layout
            </button>
          </div>
        </ModalContent>
      </Modal>
    </section>
  )
}
