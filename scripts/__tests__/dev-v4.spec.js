import { describe, expect, it } from 'vitest'

import {
  buildCompetingDevPorts,
  createV4ProcessSpecs,
  ensureV4RedisTargetReady,
  parseWindowsNetstatPids,
  resolveV4DevConfig,
  resolveV4RedisUrl,
  runV4DevCleanup,
  selectStaleCompetingDevProcessPids,
} from '../lib/dev-v4.js'

describe('parseWindowsNetstatPids', () => {
  it('extracts unique PIDs from netstat output', () => {
    const output = [
      '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       12000',
      '  TCP    127.0.0.1:3000         127.0.0.1:51452        ESTABLISHED     12000',
      '  TCP    127.0.0.1:3210         0.0.0.0:0              LISTENING       13000',
    ].join('\n')

    expect(parseWindowsNetstatPids(output)).toEqual([12000, 13000])
  })
})

describe('resolveV4DevConfig', () => {
  it('prefers explicit V4 frontend env and aligns all API bases to the V4 backend and dependency services', () => {
    const config = resolveV4DevConfig({
      frontendEnv: {
        VITE_BACKEND_VERSION: 'v4',
        VITE_DEV_API_BASE: 'http://127.0.0.1:3210',
      },
      backendEnv: {
        PORT: '3210',
      },
      env: {},
    })

    expect(config).toEqual({
      frontendPort: 3000,
      backendPort: 3210,
      dependencyPort: 3410,
      spatialEncoderPort: 8100,
      frontendEnv: {
        VITE_BACKEND_VERSION: 'v4',
        VITE_DEV_API_BASE: 'http://127.0.0.1:3210',
        VITE_AI_DEV_API_BASE: 'http://127.0.0.1:3210',
        VITE_SPATIAL_DEV_API_BASE: 'http://127.0.0.1:3210',
      },
      backendEnv: {
        SPATIAL_ENCODER_BASE_URL: 'http://127.0.0.1:8100',
        SPATIAL_VECTOR_BASE_URL: 'http://127.0.0.1:3410',
        ROUTING_BASE_URL: 'http://127.0.0.1:3410',
        REDIS_URL: 'redis://127.0.0.1:6380/0',
      },
      dependencyEnv: {
        V4_DEPENDENCY_PORT: '3410',
        SPATIAL_ENCODER_PORT: '8100',
      },
    })
  })

  it('allows process env to override backend and dependency ports for cleanup and startup', () => {
    const config = resolveV4DevConfig({
      frontendEnv: {},
      backendEnv: {
        PORT: '3210',
      },
      env: {
        V4_BACKEND_PORT: '3310',
        V4_DEPENDENCY_PORT: '3510',
        SPATIAL_ENCODER_PORT: '8110',
      },
    })

    expect(config.backendPort).toBe(3310)
    expect(config.dependencyPort).toBe(3510)
    expect(config.spatialEncoderPort).toBe(8110)
    expect(config.frontendEnv.VITE_DEV_API_BASE).toBe('http://127.0.0.1:3310')
    expect(config.backendEnv).toEqual({
      SPATIAL_ENCODER_BASE_URL: 'http://127.0.0.1:8110',
      SPATIAL_VECTOR_BASE_URL: 'http://127.0.0.1:3510',
      ROUTING_BASE_URL: 'http://127.0.0.1:3510',
      REDIS_URL: 'redis://127.0.0.1:6380/0',
    })
  })
})

describe('resolveV4RedisUrl', () => {
  it('prefers an already-running local redis instance when no explicit REDIS_URL is configured', async () => {
    const redisUrl = await resolveV4RedisUrl({
      env: {},
      backendEnv: {},
      backendExampleEnv: {},
      portProbe: async (_host, port) => port === 6379,
    })

    expect(redisUrl).toBe('redis://127.0.0.1:6379/0')
  })

  it('keeps an explicitly configured REDIS_URL untouched', async () => {
    const redisUrl = await resolveV4RedisUrl({
      env: {
        REDIS_URL: 'redis://10.0.0.12:6381/3',
      },
      backendEnv: {
        REDIS_URL: 'redis://127.0.0.1:6380/0',
      },
      backendExampleEnv: {},
      portProbe: async () => true,
    })

    expect(redisUrl).toBe('redis://10.0.0.12:6381/3')
  })
})

describe('ensureV4RedisTargetReady', () => {
  it('starts a local dev redis container when the target port is not reachable', async () => {
    const commands = []
    let probeCount = 0

    const result = await ensureV4RedisTargetReady({
      rootDir: 'D:\\AAA_Edu\\TagCloud\\vite-project',
      redisUrl: 'redis://127.0.0.1:6380/0',
      logger: {
        log() {},
        warn() {},
      },
      portProbe: async () => {
        probeCount += 1
        return probeCount >= 2
      },
      runCommand(command, args) {
        commands.push([command, ...args])
        return {
          status: 0,
          stdout: '',
          stderr: '',
        }
      },
    })

    expect(result).toEqual({
      ready: true,
      started: true,
      reason: null,
      redisUrl: 'redis://127.0.0.1:6380/0',
      containerName: 'geoloom-v4-redis-6380',
      port: 6380,
    })
    expect(commands).toEqual([
      ['docker', 'version', '--format', '{{.Server.Version}}'],
      ['docker', 'ps', '-a', '--filter', 'name=^/geoloom-v4-redis-6380$', '--format', '{{.Names}}'],
      ['docker', 'run', '-d', '--name', 'geoloom-v4-redis-6380', '-p', '6380:6379', 'redis:7-alpine'],
    ])
  })
})

describe('createV4ProcessSpecs', () => {
  it('builds direct Windows process specs for frontend, dependency adapter, and V4 backend without cmd wrappers', () => {
    const specs = createV4ProcessSpecs({
      rootDir: 'D:\\AAA_Edu\\TagCloud\\vite-project',
      platform: 'win32',
      nodeCommand: 'node.exe',
      npmExecPath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      frontendEnv: {
        VITE_BACKEND_VERSION: 'v4',
      },
      dependencyEnv: {
        V4_DEPENDENCY_PORT: '3410',
        SPATIAL_ENCODER_PORT: '8100',
      },
      backendEnv: {
        SPATIAL_ENCODER_BASE_URL: 'http://127.0.0.1:8100',
        SPATIAL_VECTOR_BASE_URL: 'http://127.0.0.1:3410',
        ROUTING_BASE_URL: 'http://127.0.0.1:3410',
        REDIS_URL: 'redis://127.0.0.1:6380/0',
      },
    })

    expect(specs).toEqual([
      {
        label: 'front',
        command: 'node.exe',
        args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'dev:frontend:v4'],
        cwd: 'D:\\AAA_Edu\\TagCloud\\vite-project',
        env: {
          VITE_BACKEND_VERSION: 'v4',
        },
      },
      {
        label: 'deps',
        command: 'node.exe',
        args: ['scripts/v4-dependency-adapter.mjs'],
        cwd: 'D:\\AAA_Edu\\TagCloud\\vite-project',
        env: {
          V4_DEPENDENCY_PORT: '3410',
          SPATIAL_ENCODER_PORT: '8100',
        },
      },
      {
        label: 'v4',
        command: 'node.exe',
        args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'dev'],
        cwd: 'D:\\AAA_Edu\\TagCloud\\vite-project\\V4-GeoLoom-beta',
        env: {
          SPATIAL_ENCODER_BASE_URL: 'http://127.0.0.1:8100',
          SPATIAL_VECTOR_BASE_URL: 'http://127.0.0.1:3410',
          ROUTING_BASE_URL: 'http://127.0.0.1:3410',
          REDIS_URL: 'redis://127.0.0.1:6380/0',
        },
      },
    ])
  })
})

describe('buildCompetingDevPorts', () => {
  it('tracks the V4 dependency adapter port alongside legacy V1 and V3 dev ports', () => {
    expect(buildCompetingDevPorts({
      frontendPort: 3000,
      backendPort: 3210,
      dependencyPort: 3410,
    })).toEqual([3000, 3210, 3410, 3200, 3300, 50051, 8100])
  })
})

describe('selectStaleCompetingDevProcessPids', () => {
  it('selects V1 and V3 dev trees while protecting the current process ancestry', () => {
    const processes = [
      {
        ProcessId: 100,
        ParentProcessId: 50,
        Name: 'cmd.exe',
        CommandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c npm run dev:stack',
      },
      {
        ProcessId: 101,
        ParentProcessId: 100,
        Name: 'node.exe',
        CommandLine: 'node D:/AAA_Edu/TagCloud/vite-project/V1-fastify-backend/scripts/dev_stack.js',
      },
      {
        ProcessId: 102,
        ParentProcessId: 101,
        Name: 'node.exe',
        CommandLine: 'node --watch D:/AAA_Edu/TagCloud/vite-project/V1-fastify-backend/server.js',
      },
      {
        ProcessId: 103,
        ParentProcessId: 101,
        Name: 'python.exe',
        CommandLine: 'python D:/AAA_Edu/TagCloud/vite-project/V1-fastify-backend/python_service/grpc_server.py',
      },
      {
        ProcessId: 200,
        ParentProcessId: 50,
        Name: 'cmd.exe',
        CommandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c npm run dev:V3',
      },
      {
        ProcessId: 201,
        ParentProcessId: 200,
        Name: 'node.exe',
        CommandLine: 'node concurrently -n front,v3 -c cyan,magenta "npm run dev:frontend:v3" "cd V3-GeoEncoder-RAG && npm run dev"',
      },
      {
        ProcessId: 202,
        ParentProcessId: 201,
        Name: 'node.exe',
        CommandLine: 'node --watch D:/AAA_Edu/TagCloud/vite-project/V3-GeoEncoder-RAG/server.js',
      },
      {
        ProcessId: 203,
        ParentProcessId: 201,
        Name: 'cmd.exe',
        CommandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c vite --mode v3',
      },
      {
        ProcessId: 500,
        ParentProcessId: 400,
        Name: 'node.exe',
        CommandLine: 'node scripts/dev-v4.mjs',
      },
      {
        ProcessId: 501,
        ParentProcessId: 500,
        Name: 'cmd.exe',
        CommandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c npm run dev:frontend:v4',
      },
      {
        ProcessId: 900,
        ParentProcessId: 1,
        Name: 'postgres.exe',
        CommandLine: 'postgres -D data',
      },
    ]

    expect(selectStaleCompetingDevProcessPids({
      processes,
      portOwners: [102, 103, 202],
      currentPid: 500,
      currentParentPid: 400,
    })).toEqual([100, 101, 102, 103, 200, 201, 202, 203])
  })

  it('also captures an old V4 launcher tree when rerunning dev:v4', () => {
    const processes = [
      {
        ProcessId: 400,
        ParentProcessId: 50,
        Name: 'cmd.exe',
        CommandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c npm run dev:v4',
      },
      {
        ProcessId: 401,
        ParentProcessId: 400,
        Name: 'node.exe',
        CommandLine: 'node D:/AAA_Edu/TagCloud/vite-project/scripts/dev-v4.mjs',
      },
      {
        ProcessId: 402,
        ParentProcessId: 401,
        Name: 'node.exe',
        CommandLine: 'node D:/AAA_Edu/TagCloud/vite-project/node_modules/.bin/../vite/bin/vite.js --mode v4',
      },
      {
        ProcessId: 403,
        ParentProcessId: 401,
        Name: 'node.exe',
        CommandLine: 'node D:/AAA_Edu/TagCloud/vite-project/V4-GeoLoom-beta/node_modules/.bin/../tsx/dist/cli.mjs watch src/server.ts',
      },
      {
        ProcessId: 900,
        ParentProcessId: 800,
        Name: 'node.exe',
        CommandLine: 'node scripts/dev-v4.mjs',
      },
    ]

    expect(selectStaleCompetingDevProcessPids({
      processes,
      portOwners: [402, 403],
      currentPid: 900,
      currentParentPid: 800,
    })).toEqual([400, 401, 402, 403])
  })
})

describe('runV4DevCleanup', () => {
  it('clears competing V1 and V3 dev processes on Windows before V4 starts', () => {
    const killed = []
    const logs = []
    const processes = [
      {
        ProcessId: 100,
        ParentProcessId: 50,
        Name: 'cmd.exe',
        CommandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c npm run dev:stack',
      },
      {
        ProcessId: 101,
        ParentProcessId: 100,
        Name: 'node.exe',
        CommandLine: 'node D:/AAA_Edu/TagCloud/vite-project/V1-fastify-backend/scripts/dev_stack.js',
      },
      {
        ProcessId: 200,
        ParentProcessId: 50,
        Name: 'cmd.exe',
        CommandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c npm run dev:V3',
      },
      {
        ProcessId: 201,
        ParentProcessId: 200,
        Name: 'node.exe',
        CommandLine: 'node concurrently -n front,v3 -c cyan,magenta "npm run dev:frontend:v3" "cd V3-GeoEncoder-RAG && npm run dev"',
      },
      {
        ProcessId: 500,
        ParentProcessId: 400,
        Name: 'node.exe',
        CommandLine: 'node scripts/dev-v4.mjs',
      },
    ]

    const result = runV4DevCleanup({
      platform: 'win32',
      frontendPort: 3000,
      backendPort: 3210,
      dependencyPort: 3410,
      currentPid: 500,
      currentParentPid: 400,
      logger: {
        log(message) {
          logs.push(message)
        },
      },
      readSnapshot(ports) {
        expect(ports).toEqual([3000, 3210, 3410, 3200, 3300, 50051, 8100])
        return {
          processes,
          portOwners: [101, 201],
        }
      },
      killProcesses(pids) {
        killed.push(...pids)
      },
    })

    expect(killed).toEqual([100, 101, 200, 201])
    expect(result).toEqual({
      skipped: false,
      killedPids: [100, 101, 200, 201],
      trackedPorts: [3000, 3210, 3410, 3200, 3300, 50051, 8100],
    })
    expect(logs).toEqual([
      '[dev:v4] Cleared competing dev processes: 100, 101, 200, 201',
    ])
  })
})
