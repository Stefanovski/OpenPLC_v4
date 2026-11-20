import { CodexState } from '../../../types/IPC/codex'
import { CodexContext } from '../../../types/IPC/codex-context'
import type { CodexDebugSnapshot } from '../../../types/IPC/codex-debug'
import { RpcObject } from './rpc'
import { CodexService, validateLoginUrl } from './service'

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const buildRequestId = '974e89b1-42c9-4a36-9731-6452a559fc04'

test.each(['edit', 'compile'])('active-debug schema preserves the existing %s capability', async (mode) => {
  const f = fixture(),
    context = contextAttachment()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  await f.service.send({
    projectPath: context.projectPath,
    text: mode === 'edit' ? 'Bitte ändern' : 'Bitte kompilieren',
    model: 'test-model',
    context,
    proposeChanges: true,
    buildRequestId,
    applyRequestId: buildRequestId,
    debugRequestId: buildRequestId,
  })
  const text =
    mode === 'edit'
      ? JSON.stringify({ ...JSON.parse(editReply()), action: 'none', debugCommand: null })
      : JSON.stringify({
          message: 'Compile',
          changes: [],
          instances: [],
          action: 'compile-and-fix',
          debugCommand: null,
        })
  f.notify('item/completed', { threadId: 'thread1', turnId: 'turn1', item: { type: 'agentMessage', id: 'a', text } })
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  const message = f.service.snapshot().messages.at(-1)!
  expect(message.debugAction).toBeUndefined()
  if (mode === 'edit') {
    expect(message.proposal?.base).toEqual(context)
    expect(message.applyRequestId).toBe(buildRequestId)
  } else {
    expect(message.buildAction).toMatchObject({ requestId: buildRequestId, base: context })
    expect(message.proposal).toBeUndefined()
  }
})

test.each(['complete', 'partial', 'cancel', 'failed', 'disabled-edit', 'compile', 'followup'])(
  'active debugger capability is host-bound and isolated: %s',
  async (mode) => {
    const f = fixture(),
      context = contextAttachment()
    await f.service.connect()
    f.service.selectProject(context.projectPath)
    await f.service.send({
      projectPath: context.projectPath,
      text: 'Read the PLC',
      model: 'test-model',
      context,
      ...(mode === 'followup' ? { debugFollowup: true } : { debugRequestId: buildRequestId }),
    })
    const turn = f.request.mock.calls.find(([m]) => m === 'turn/start')![1]!
    expect(JSON.stringify(turn.input)).toContain('HOST ACTIVE DEBUGGER RESULT')
    if (mode === 'followup') expect(turn.outputSchema).toBeNull()
    if (mode === 'cancel') await f.service.stop()
    const reply = {
      message: 'Read',
      changes: [],
      instances: [],
      action: 'debug',
      debugCommand: { operation: 'connect', variables: [], statementId: 0 },
    }
    const text =
      mode === 'disabled-edit'
        ? JSON.stringify({ ...JSON.parse(editReply()), action: 'none', debugCommand: null })
        : mode === 'compile'
          ? JSON.stringify({ ...reply, action: 'compile-and-fix', debugCommand: null })
          : JSON.stringify(reply)
    f.notify('item/completed', { threadId: 'thread1', turnId: 'turn1', item: { type: 'agentMessage', id: 'a', text } })
    expect(f.service.snapshot().messages.some((m) => m.debugAction)).toBe(false)
    if (mode !== 'partial')
      f.notify('turn/completed', {
        threadId: 'thread1',
        turn: { id: 'turn1', status: mode === 'failed' ? 'failed' : 'completed' },
      })
    expect(f.service.snapshot().messages.some((m) => m.debugAction)).toBe(mode === 'complete')
    expect(f.service.snapshot().messages.some((m) => m.buildAction || m.proposal || m.applyRequestId)).toBe(false)
    if (mode === 'complete')
      expect(f.service.snapshot().messages.at(-1)?.debugAction).toMatchObject({
        requestId: buildRequestId,
        base: context,
        command: reply.debugCommand,
      })
  },
)

test('debug follow-up cannot opt into any effectful capability', async () => {
  const f = fixture(),
    context = contextAttachment()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  for (const extra of [
    { proposeChanges: true },
    { buildRequestId },
    { applyRequestId: buildRequestId },
    { debugRequestId: buildRequestId },
    { scratchOnly: true },
  ])
    await expect(
      f.service.send({
        projectPath: context.projectPath,
        text: 'Analyze',
        model: 'test-model',
        context,
        debugFollowup: true,
        ...extra,
      }),
    ).rejects.toThrow()
})

test('direct edit capability is host-bound and emitted only after a complete validated turn', async () => {
  const f = fixture(),
    context = contextAttachment()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  await f.service.send({
    projectPath: context.projectPath,
    text: 'Bitte ändern',
    model: 'test-model',
    context,
    proposeChanges: true,
    applyRequestId: buildRequestId,
  })
  const turn = f.request.mock.calls.find(([method]) => method === 'turn/start')![1]!
  expect(JSON.stringify(turn.input)).toContain('DIRECT EDIT MODE')
  expect(JSON.stringify(turn.input)).not.toContain('Proposals are NOT applied until')
  f.notify('item/completed', {
    threadId: 'thread1',
    turnId: 'turn1',
    item: { type: 'agentMessage', id: 'a', text: editReply() },
  })
  expect(f.service.snapshot().messages.some((m) => m.applyRequestId)).toBe(false)
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages[1]).toMatchObject({
    applyRequestId: buildRequestId,
    proposal: { base: context },
  })
})

test.each(['stopped', 'failed', 'invalid', 'review'])(
  'does not create a direct apply capability for %s',
  async (mode) => {
    const f = fixture(),
      context = contextAttachment()
    await f.service.connect()
    f.service.selectProject(context.projectPath)
    await f.service.send({
      projectPath: context.projectPath,
      text: 'edit',
      model: 'test-model',
      context,
      proposeChanges: true,
      ...(mode === 'review' ? {} : { applyRequestId: buildRequestId }),
    })
    if (mode === 'stopped') await f.service.stop()
    f.notify('item/completed', {
      threadId: 'thread1',
      turnId: 'turn1',
      item: { type: 'agentMessage', id: 'a', text: mode === 'invalid' ? '{}' : editReply() },
    })
    f.notify('turn/completed', {
      threadId: 'thread1',
      turn: { id: 'turn1', status: mode === 'failed' ? 'failed' : 'completed' },
    })
    expect(f.service.snapshot().messages.some((m) => m.applyRequestId)).toBe(false)
  },
)

test('direct mode requires edits/context and cannot be enabled for compiler repair', async () => {
  const f = fixture(),
    context = contextAttachment()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  const request = {
    projectPath: context.projectPath,
    text: 'edit',
    model: 'test-model',
    applyRequestId: buildRequestId,
  }
  await expect(f.service.send(request)).rejects.toThrow('Direct editing requires')
  await expect(f.service.send({ ...request, context, proposeChanges: true, scratchOnly: true })).rejects.toThrow(
    'Direct editing requires',
  )
})

function debugSnapshot(): CodexDebugSnapshot {
  const now = Date.now()
  return {
    version: 1,
    capturedAt: now,
    debuggerActive: true,
    sessionMatches: true,
    target: '192.0.2.1',
    sourceMatch: 'unverified',
    unsavedChanges: true,
    localBuildId: 'local',
    status: null,
    callStack: null,
    variables: [{ key: 'main:Lamp', index: 1, value: 'TRUE', sampledAt: now, forced: null }],
    omittedVariables: 0,
    cacheLimited: false,
    selectedInstances: [],
  }
}

test('debugger context is explicit, bounded and re-evaluated after asynchronous thread startup', async () => {
  const f = fixture(),
    context = contextAttachment(),
    snapshot = debugSnapshot()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  const handler = f.request.getMockImplementation()!
  let clock: jest.SpyInstance | undefined
  f.request.mockImplementation((method, params) => {
    if (method === 'thread/start') clock = jest.spyOn(Date, 'now').mockReturnValue(snapshot.capturedAt + 6000)
    return handler(method, params)
  })
  try {
    await f.service.send({
      projectPath: context.projectPath,
      model: 'test-model',
      text: 'Warum blinkt Lamp nicht?',
      context,
      debugger: snapshot,
    })
    const turn = f.request.mock.calls.find(([method]) => method === 'turn/start')![1]!
    const input = JSON.stringify(turn.input)
    expect(input).toContain('DEBUGGER OBSERVATION SNAPSHOT')
    expect(input).toContain('stale')
    expect(input).toContain('unverified')
    expect(input).toContain('cannot connect, download')
    expect(input).not.toContain('C:/private')
    expect(f.service.snapshot().messages[0].debugger).toMatchObject({ variables: 1, capturedAt: snapshot.capturedAt })
    expect(f.service.snapshot().messages[0]).not.toHaveProperty('variables')
    expect(f.request.mock.calls.map(([method]) => method)).not.toEqual(expect.arrayContaining(['command/exec']))
  } finally {
    clock?.mockRestore()
  }
})

test.each(['missing-context', 'repair', 'command', 'oversize'])(
  'rejects invalid debugger attachment: %s before starting a model turn',
  async (mode) => {
    const f = fixture(),
      context = contextAttachment(),
      snapshot = debugSnapshot()
    await f.service.connect()
    f.service.selectProject(context.projectPath)
    if (mode === 'command') Object.assign(snapshot, { force: true })
    if (mode === 'oversize') snapshot.variables = Array.from({ length: 65 }, () => snapshot.variables[0])
    await expect(
      f.service.send({
        projectPath: context.projectPath,
        model: 'test-model',
        text: 'debug',
        debugger: snapshot,
        ...(mode !== 'missing-context' ? { context } : {}),
        ...(mode === 'repair' ? { scratchOnly: true } : {}),
      }),
    ).rejects.toThrow()
    expect(f.request.mock.calls.some(([method]) => method === 'turn/start' || method === 'thread/start')).toBe(false)
  },
)

test('ordinary chat does not attach debugger data and marks previous observations historical', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  await f.send()
  const turn = f.request.mock.calls.find(([method]) => method === 'turn/start')![1]!
  expect(JSON.stringify(turn.input)).toContain('No ordinary-editor debugger snapshot attached')
  expect(JSON.stringify(turn.input)).not.toContain('DEBUGGER OBSERVATION SNAPSHOT')
  expect(f.service.snapshot().messages[0].debugger).toBeUndefined()
})

test('chat compilation is bound to the request snapshot/model and only emitted after a complete turn', async () => {
  const f = fixture(),
    context = contextAttachment()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  await f.service.send({
    projectPath: context.projectPath,
    text: 'Kompiliere und korrigiere die Fehler',
    model: 'test-model',
    context,
    proposeChanges: true,
    buildRequestId,
  })
  const turn = f.request.mock.calls.find(([m]) => m === 'turn/start')![1]!
  expect(turn.outputSchema).toMatchObject({ required: ['message', 'changes', 'instances', 'action'] })
  expect(JSON.stringify(turn.input)).toContain('latest user message explicitly requests')
  const text = JSON.stringify({
    message: 'Ich starte die Prüfung.',
    action: 'compile-and-fix',
    changes: [],
    instances: [],
  })
  f.notify('item/agentMessage/delta', { threadId: 'thread1', turnId: 'turn1', itemId: 'a', delta: text })
  expect(f.service.snapshot().messages.some((m) => m.buildAction)).toBe(false)
  f.notify('item/completed', { threadId: 'thread1', turnId: 'turn1', item: { type: 'agentMessage', id: 'a', text } })
  expect(f.service.snapshot().messages.some((m) => m.buildAction)).toBe(false)
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages[1]).toMatchObject({
    buildAction: { requestId: buildRequestId, base: context, model: 'test-model' },
  })
  expect(f.service.snapshot().messages[1].proposal).toBeUndefined()
})

test.each(['stop', 'switch', 'failed', 'none', 'mixed', 'unsupported', 'repair'])(
  'does not emit a build action for %s',
  async (mode) => {
    const f = fixture(),
      context = contextAttachment()
    await f.service.connect()
    f.service.selectProject(context.projectPath)
    await f.service.send({
      projectPath: context.projectPath,
      text: 'test',
      model: 'test-model',
      context,
      proposeChanges: true,
      ...(mode === 'repair' ? { scratchOnly: true } : { buildRequestId }),
    })
    if (mode === 'stop') await f.service.stop()
    if (mode === 'switch') f.service.selectProject('C:/other')
    const reply = {
      message: 'test',
      action: mode === 'none' ? 'none' : mode === 'unsupported' ? 'upload' : 'compile-and-fix',
      changes: [],
      instances: mode === 'mixed' ? [{ name: 'i', task: 't', program: 'main' }] : [],
    }
    f.notify('item/completed', {
      threadId: 'thread1',
      turnId: 'turn1',
      item: { type: 'agentMessage', id: 'a', text: JSON.stringify(reply) },
    })
    f.notify('turn/completed', {
      threadId: 'thread1',
      turn: { id: 'turn1', status: mode === 'failed' ? 'failed' : 'completed' },
    })
    expect(f.service.snapshot().messages.some((m) => m.buildAction)).toBe(false)
  },
)

test('rejects enabling chat actions without context/edits or inside repair turns', async () => {
  const f = fixture(),
    context = contextAttachment()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  const request = { projectPath: context.projectPath, text: 'compile', model: 'test-model', buildRequestId }
  await expect(f.service.send(request)).rejects.toThrow('requires')
  await expect(f.service.send({ ...request, context, proposeChanges: true, scratchOnly: true })).rejects.toThrow(
    'requires',
  )
})

test('ordinary edit proposals still work with the chat action schema', async () => {
  const f = fixture(),
    context = contextAttachment()
  await f.service.connect()
  f.service.selectProject(context.projectPath)
  await f.service.send({
    projectPath: context.projectPath,
    text: 'Create an ST program',
    model: 'test-model',
    context,
    proposeChanges: true,
    buildRequestId,
  })
  const text = editReply().replace('"message":', '"action":"none","message":')
  f.notify('item/completed', { threadId: 'thread1', turnId: 'turn1', item: { type: 'agentMessage', id: 'a', text } })
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages[1].proposal?.reply.changes[0].name).toBe('NewProgram')
  expect(f.service.snapshot().messages[1].proposal?.reply).not.toHaveProperty('action')
  expect(f.service.snapshot().messages[1].buildAction).toBeUndefined()
})
const editReply = () =>
  JSON.stringify({
    message: 'Review this ST program.',
    changes: [
      {
        operation: 'create',
        name: 'NewProgram',
        kind: 'program',
        language: 'st',
        returnType: '',
        documentation: '',
        declarations: '',
        body: '(* new program *)',
      },
    ],
    instances: [],
  })

test('marks intermediate compiler corrections as scratch-only so they cannot be applied from chat', async () => {
  const f = fixture()
  await f.service.connect()
  const context = contextAttachment()
  f.service.selectProject(context.projectPath)
  await f.service.send({
    projectPath: context.projectPath,
    text: 'Correct compiler errors',
    model: 'test-model',
    context,
    proposeChanges: true,
    scratchOnly: true,
  })
  f.notify('item/completed', {
    threadId: 'thread1',
    turnId: 'turn1',
    item: { type: 'agentMessage', id: 'repair', text: editReply() },
  })
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages[1]).toMatchObject({ scratchOnly: true, proposal: { base: context } })
  expect(f.service.snapshot().messages[0].scratchOnly).toBe(true)
})

test('structured edits remain inert until a complete validated turn and retain the exact request baseline', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  const context = contextAttachment(),
    original = context.snapshot
  await f.service.send({
    projectPath: context.projectPath,
    text: 'Create ST program',
    model: 'test-model',
    context,
    proposeChanges: true,
  })
  context.snapshot = '{}'
  const turn = f.request.mock.calls.find(([m]) => m === 'turn/start')![1]!
  expect(turn.outputSchema).toMatchObject({ type: 'object', required: ['message', 'changes', 'instances'] })
  expect(JSON.stringify(turn.input)).toContain('Proposals are NOT applied')
  f.notify('item/agentMessage/delta', {
    threadId: 'thread1',
    turnId: 'turn1',
    itemId: 'a',
    delta: editReply().slice(0, 35),
  })
  expect(f.service.snapshot().messages).toHaveLength(1)
  f.notify('item/completed', {
    threadId: 'thread1',
    turnId: 'turn1',
    item: { type: 'agentMessage', id: 'a', text: editReply() },
  })
  expect(f.service.snapshot().messages).toHaveLength(1)
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages[1]).toMatchObject({
    text: 'Review this ST program.',
    proposal: { base: { snapshot: original }, reply: { changes: [{ name: 'NewProgram' }] } },
  })
})

test.each(['malformed', '```json\n{}\n```', '{"message":"unsafe","changes":[],"instances":[],"shell":"run"}'])(
  'rejects invalid edit output %s',
  async (text) => {
    const f = fixture()
    await f.service.connect()
    f.service.selectProject('C:/private/plc-project')
    await f.service.send({
      projectPath: 'C:/private/plc-project',
      text: 'Create',
      model: 'test-model',
      context: contextAttachment(),
      proposeChanges: true,
    })
    f.notify('item/completed', { threadId: 'thread1', turnId: 'turn1', item: { type: 'agentMessage', id: 'a', text } })
    f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
    expect(f.service.snapshot().messages.some((m) => m.proposal)).toBe(false)
    expect(f.service.snapshot().error).toContain('Nothing was applied')
  },
)

test('cancelled edits and late old-project replies cannot become actionable proposals', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  const request = {
    projectPath: 'C:/private/plc-project',
    text: 'Create',
    model: 'test-model',
    context: contextAttachment(),
    proposeChanges: true,
  }
  await f.service.send(request)
  f.notify('item/completed', {
    threadId: 'thread1',
    turnId: 'turn1',
    item: { type: 'agentMessage', id: 'a', text: editReply() },
  })
  await f.service.stop()
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages.some((m) => m.proposal)).toBe(false)
  await f.service.send(request)
  f.service.selectProject('C:/other')
  f.notify('item/completed', {
    threadId: 'thread1',
    turnId: 'turn1',
    item: { type: 'agentMessage', id: 'a', text: editReply() },
  })
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages).toEqual([])
})

test('edit mode requires context; ordinary chat explicitly clears the structured output schema', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  await expect(
    f.service.send({
      projectPath: 'C:/private/plc-project',
      text: 'Create',
      model: 'test-model',
      proposeChanges: true,
    }),
  ).rejects.toThrow('Include current project context')
  await f.send()
  expect(f.request.mock.calls.find(([m]) => m === 'turn/start')![1]!.outputSchema).toBeNull()
})
function contextAttachment() {
  const context: CodexContext = {
    version: 1,
    capturedAt: Date.now(),
    project: {
      name: 'Live editor',
      activeEditor: 'Main',
      editingState: 'unsaved',
      pous: [],
      dataTypes: [],
      resource: { globals: { source: 'table', variables: [] }, tasks: [], instances: [] },
    },
    device: { board: 'Eurosonic_Gen2', compiler: 'eurosonic-cli', coreVersion: '2.11.0', pinMapping: [] },
    io: {
      configuredHost: 'localhost',
      expected: null,
      observation: {
        state: 'success',
        requestedHost: 'localhost',
        inventory: {
          host: 'localhost',
          readAt: Date.now(),
          verified: true,
          modules: Array.from({ length: 7 }, (_, i) => ({
            slot: i + 1,
            type: i === 0 ? 1 : 0,
            ident: 0,
            registerCount: 0,
            version: i === 0 ? 1 : 0,
            communicationOk: i === 0,
          })),
        },
      },
    },
  }
  return { projectPath: 'C:/private/plc-project', snapshot: JSON.stringify(context) }
}

test('validates context/project binding before sending and rejects malformed attachments', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  const request = {
    projectPath: 'C:/private/plc-project',
    text: 'Explain my project',
    model: 'test-model',
    context: contextAttachment(),
  }
  await expect(f.service.send({ ...request, context: { ...request.context, projectPath: 'other' } })).rejects.toThrow()
  await expect(f.service.send({ ...request, context: { ...request.context, snapshot: '{}' } })).rejects.toThrow()
  expect(f.request.mock.calls.some(([method]) => method === 'thread/start' || method === 'turn/start')).toBe(false)
  expect(f.service.snapshot().busy).toBe(false)
})

test('sends detached background and current snapshot without local path and recalculates age after thread startup', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  const attachment = contextAttachment()
  const later = (JSON.parse(attachment.snapshot) as CodexContext).capturedAt + 31000
  const handler = f.request.getMockImplementation()!
  let clock: jest.SpyInstance | undefined
  f.request.mockImplementation((method, params) => {
    if (method === 'thread/start') clock = jest.spyOn(Date, 'now').mockReturnValue(later)
    return handler(method, params)
  })
  try {
    await f.service.send({
      projectPath: 'C:/private/plc-project',
      text: 'Explain my project',
      model: 'test-model',
      context: attachment,
    })
    const turn = f.request.mock.calls.find(([method]) => method === 'turn/start')![1]!
    const input = turn.input as { text: string }[]
    expect(input[0].text).toContain('"status":"stale"')
    expect(input[0].text).toContain('"contractVersion":1')
    expect(input[0].text).toContain('Live editor')
    expect(JSON.stringify(turn)).not.toContain('C:/private')
    expect(input[input.length - 1].text).toBe('Explain my project')
    expect(f.service.snapshot().messages[0]).toMatchObject({
      text: 'Explain my project',
      context: { name: 'Live editor', ioStatus: 'stale' },
    })
    expect(JSON.stringify(f.service.snapshot())).not.toContain('generatorGuidance')
  } finally {
    clock?.mockRestore()
  }
})
function fixture(signedIn = true) {
  let notify: (method: string, params: RpcObject) => void = () => {}
  let exit: (error: Error) => void = () => {}
  let account: unknown = signedIn
    ? { type: 'chatgpt', email: 'user@example.test', planType: 'plus', accessToken: 'must-not-leak' }
    : null
  const request = jest.fn(async (method: string, _params?: RpcObject): Promise<unknown> => {
    await Promise.resolve()
    if (method === 'account/read') return { account }
    if (method === 'model/list')
      return { data: [{ model: 'test-model', displayName: 'Test model', isDefault: true }], nextCursor: null }
    if (method === 'account/login/start')
      return { type: 'chatgpt', loginId: 'login1', authUrl: 'https://auth.openai.com/authorize?state=private-state' }
    if (method === 'account/logout') {
      account = null
      return {}
    }
    if (method === 'thread/start') return { thread: { id: 'thread1' } }
    if (method === 'turn/start') return { turn: { id: 'turn1' } }
    return {}
  })
  const client = { request, notify: jest.fn(), close: jest.fn() }
  const launch = jest.fn((notification: typeof notify, onExit: typeof exit) => {
    notify = notification
    exit = onExit
    return Promise.resolve(client)
  })
  const browser = jest.fn(() => Promise.resolve())
  const states: CodexState[] = []
  const service = new CodexService(launch, browser, (state) => states.push(state))
  const send = () => service.send({ projectPath: 'C:/private/plc-project', text: 'Explain TON', model: 'test-model' })
  return {
    service,
    client,
    request,
    launch,
    browser,
    states,
    send,
    notify: (method: string, params: RpcObject) => notify(method, params),
    exit: () => exit(new Error('Exited')),
    account: (value: unknown) => {
      account = value
    },
  }
}

test('connect is lazy, coalesces concurrent initialization and exposes only account display fields', async () => {
  const f = fixture()
  expect(f.launch).not.toHaveBeenCalled()
  await Promise.all([f.service.connect(), f.service.connect()])
  expect(f.launch).toHaveBeenCalledTimes(1)
  expect(f.request.mock.calls[0][0]).toBe('initialize')
  expect(f.client.notify).toHaveBeenCalledWith('initialized')
  expect(f.service.snapshot().account).toEqual({ type: 'chatgpt', email: 'user@example.test', plan: 'plus' })
  expect(JSON.stringify(f.states)).not.toContain('must-not-leak')
  expect(f.browser).not.toHaveBeenCalled()
})

test('sign-in opens only the validated URL and completion refreshes account and models', async () => {
  const f = fixture(false)
  await f.service.signIn()
  expect(f.browser).toHaveBeenCalledTimes(1)
  expect(f.service.snapshot().loginPending).toBe(true)
  expect(JSON.stringify(f.states)).not.toContain('private-state')
  f.account({ type: 'chatgpt', email: 'mikkel@example.test', planType: 'plus' })
  f.notify('account/login/completed', { loginId: 'login1', success: true })
  await flush()
  expect(f.service.snapshot()).toMatchObject({
    loginPending: false,
    account: { email: 'mikkel@example.test' },
    models: [{ id: 'test-model' }],
  })
  await f.service.signOut()
  expect(f.request).toHaveBeenCalledWith('account/logout')
  expect(f.service.snapshot().account).toBeNull()
})

test('cancel ignores a late completion for the old login and clears the browser URL', async () => {
  const f = fixture(false)
  await f.service.signIn()
  await f.service.cancelLogin()
  expect(f.request).toHaveBeenCalledWith('account/login/cancel', { loginId: 'login1' })
  f.notify('account/login/completed', { loginId: 'login1', success: true })
  await flush()
  expect(f.service.snapshot().loginPending).toBe(false)
  await expect(f.service.reopenLogin()).rejects.toThrow('No sign-in')
})

test.each([
  'http://auth.openai.com/',
  'https://auth.openai.com.evil.test/',
  'file:///a',
  'https://user:password@chatgpt.com/',
  'https://chatgpt.com:9000/',
])('rejects unsafe sign-in target %s', (url) => {
  expect(() => validateLoginUrl(url)).toThrow()
})

test('starts isolated read-only ephemeral chat, streams text and replaces the final item without duplicates', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  await f.send()
  const thread = f.request.mock.calls.find((call) => call[0] === 'thread/start')?.[1]
  expect(thread).toMatchObject({
    sandbox: 'read-only',
    ephemeral: true,
    approvalPolicy: 'never',
    config: { 'features.shell_tool': false, 'features.apps': false },
  })
  expect(JSON.stringify(thread)).not.toContain('C:/private')
  expect(f.request.mock.calls.find((call) => call[0] === 'turn/start')?.[1]).toMatchObject({
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
  })
  f.notify('item/agentMessage/delta', { threadId: 'wrong', turnId: 'turn1', itemId: 'a', delta: 'Wrong project' })
  f.notify('item/agentMessage/delta', { threadId: 'thread1', turnId: 'turn1', itemId: 'a', delta: 'Hello ' })
  f.notify('item/agentMessage/delta', { threadId: 'thread1', turnId: 'turn1', itemId: 'a', delta: 'PLC' })
  f.notify('item/completed', {
    threadId: 'thread1',
    turnId: 'turn1',
    item: { type: 'agentMessage', id: 'a', text: 'Hello PLC!' },
  })
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } })
  expect(f.service.snapshot().messages.map((message) => message.text)).toEqual(['Explain TON', 'Hello PLC!'])
  expect(f.service.snapshot().busy).toBe(false)
})

test('rejects double send and wrong project; stop targets only this response', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  await expect(f.service.send({ projectPath: 'other', text: 'x', model: 'test-model' })).rejects.toThrow(
    'active project',
  )
  await f.send()
  await expect(f.send()).rejects.toThrow('already running')
  await f.service.stop()
  expect(f.request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread1', turnId: 'turn1' })
  f.notify('turn/completed', { threadId: 'thread1', turn: { id: 'turn1', status: 'interrupted' } })
  expect(f.service.snapshot()).toMatchObject({ busy: false, error: 'Response stopped.' })
})

test('switching projects during thread creation cannot send the old prompt', async () => {
  const f = fixture()
  await f.service.connect()
  const handler = f.request.getMockImplementation()!
  let complete: (value: unknown) => void = () => {}
  f.request.mockImplementation((method, params) =>
    method === 'thread/start'
      ? new Promise((resolve) => {
          complete = resolve
        })
      : handler(method, params),
  )
  f.service.selectProject('C:/private/plc-project')
  const pending = f.send()
  f.service.selectProject('C:/second-project')
  complete({ thread: { id: 'thread1' } })
  await pending
  expect(f.request.mock.calls.some((call) => call[0] === 'turn/start')).toBe(false)
  expect(f.service.snapshot()).toMatchObject({ projectPath: 'C:/second-project', busy: false, messages: [] })
})

test('project switch interrupts an active response and drops late output', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  await f.send()
  f.service.selectProject(null)
  f.notify('item/agentMessage/delta', { threadId: 'thread1', turnId: 'turn1', itemId: 'a', delta: 'Late' })
  expect(f.service.snapshot().messages).toEqual([])
  expect(f.request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread1', turnId: 'turn1' })
})

test('stopping during thread creation preserves the unsent draft and sends no turn', async () => {
  const f = fixture()
  await f.service.connect()
  let complete: (value: unknown) => void = () => {}
  f.request.mockImplementation((method) =>
    method === 'thread/start'
      ? new Promise((resolve) => {
          complete = resolve
        })
      : Promise.resolve({}),
  )
  f.service.selectProject('C:/private/plc-project')
  const pending = f.service.run(f.send)
  await f.service.stop()
  complete({ thread: { id: 'thread1' } })
  expect(await pending).toMatchObject({ success: false })
  expect(f.request.mock.calls.some((call) => call[0] === 'turn/start')).toBe(false)
  expect(f.service.snapshot()).toMatchObject({ busy: false, messages: [] })
})

test('crash clears busy/auth and reconnect creates a fresh client', async () => {
  const f = fixture()
  await f.service.connect()
  f.service.selectProject('C:/private/plc-project')
  await f.send()
  f.exit()
  expect(f.service.snapshot()).toMatchObject({ connection: 'error', account: null, busy: false })
  await f.service.connect()
  expect(f.launch).toHaveBeenCalledTimes(2)
  expect(f.service.snapshot().connection).toBe('connected')
  f.service.disconnect()
})

test('disconnect while launching cannot revive the connection', async () => {
  let complete: (client: ReturnType<typeof fixture>['client']) => void = () => {}
  const f = fixture()
  const service = new CodexService(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
    f.browser,
    () => {},
  )
  const pending = service.connect()
  service.disconnect()
  complete(f.client)
  await pending
  expect(service.snapshot().connection).toBe('disconnected')
  expect(f.client.close).toHaveBeenCalled()
  expect(f.request).not.toHaveBeenCalled()
})
