import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('prepared commands retain the configured definition hash in receipts', async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'workflow-receipt-test-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const installedEntry = fileURLToPath(import.meta.resolve('ai-delivery-workflow'));
  const installedSource = dirname(installedEntry);
  const installedPackage = dirname(dirname(installedSource));
  const fixtureSource = join(temporaryRoot, 'dist', 'src');
  await cp(installedSource, fixtureSource, { recursive: true });
  await cp(join(installedPackage, 'schemas'), join(temporaryRoot, 'schemas'), { recursive: true });

  const runtimeImage = `sha256:${'b'.repeat(64)}`;
  await writeFile(
    join(fixtureSource, 'config', 'toolchain.js'),
    `export async function resolvePreparedCommand(_root, _project, _id, definition) {
  return {
    ...definition,
    isolation: {
      ...definition.isolation,
      image: '${runtimeImage}',
      nodeModulesPath: '/opt/ai-delivery/node_modules'
    }
  };
}\n`,
    'utf8',
  );

  const cacheBuster = `?test=${Date.now()}`;
  const containers = await import(
    `${pathToFileURL(join(fixtureSource, 'enforcement', 'containers.js')).href}${cacheBuster}`
  );
  const { hashObject } = await import(
    `${pathToFileURL(join(fixtureSource, 'shared', 'hash.js')).href}${cacheBuster}`
  );
  const { snapshot } = await import(
    `${pathToFileURL(join(fixtureSource, 'enforcement', 'files.js')).href}${cacheBuster}`
  );

  const configured = {
    executable: 'node',
    args: ['--version'],
    isolation: {
      workingDirectory: '.',
      image: `node@sha256:${'a'.repeat(64)}`,
      timeoutMs: 30_000,
      cpus: 1,
      memoryMb: 128,
      pids: 32,
      network: 'none',
      allowedDomains: [],
      requiredForReview: true,
    },
  };
  const governance = {
    allowedPaths: ['**/*'],
    deniedPaths: [],
    commands: { test: configured },
    dataClassification: 'INTERNAL',
  };

  const workspace = join(temporaryRoot, 'workspace');
  const storeDirectory = join(temporaryRoot, 'store');
  await mkdir(workspace);
  await mkdir(storeDirectory);
  await writeFile(join(workspace, 'fixture.txt'), 'fixture', 'utf8');

  const state = {
    id: 'session-1',
    workItem: 'WFLOW-001',
    project: 'app',
    workspace,
    hostRoot: workspace,
    expectedHost: await snapshot(workspace),
    governanceHash: 'c'.repeat(64),
    manifestHash: 'd'.repeat(64),
  };
  const audits = [];
  const workflow = {
    repository: {
      gitRoot: temporaryRoot,
      loadGovernance: async () => governance,
      saveWorkItem: async () => undefined,
      evidencePath: () => join(temporaryRoot, 'evidence.jsonl'),
    },
    status: async () => ({ id: state.workItem }),
  };
  const gateway = {
    workflow,
    store: {
      directory: storeDirectory,
      exclusive: async (operation) => operation(),
      save: async () => undefined,
    },
    current: async () => state,
    authorize: async () => undefined,
    audit: async (type, data) => audits.push({ type, data }),
  };

  let executedDefinition;
  class PreparedRunner extends containers.ContainerRunner {
    constructor() {
      super(async () => ({ stdout: '', stderr: '' }));
      this.requiresPreparedToolchain = true;
    }

    async execute(definition) {
      executedDefinition = definition;
      return {
        exitCode: 0,
        outputHash: 'e'.repeat(64),
        stdout: 'ok',
        stderr: '',
      };
    }
  }

  await containers.runGovernedCommand(gateway, { id: 'test' }, new PreparedRunner());

  const configuredHash = hashObject(configured);
  const receipt = state.validation.commandResults[0];
  assert.equal(executedDefinition.isolation.image, runtimeImage);
  assert.notEqual(hashObject(executedDefinition), configuredHash);
  assert.equal(receipt.definitionHash, configuredHash);
  assert.equal(audits.find(({ type }) => type === 'COMMAND_STARTED').data.definitionHash, configuredHash);
});
