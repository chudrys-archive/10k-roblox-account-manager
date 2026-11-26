'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Executor, decide, parseTasklist, splitArgs, validName, profileOf, listPrograms, buildTaskScript, buildTaskRemoveScript, TASK_OPEN, TASK_CLOSE, RELAUNCH_CAP_PER_HOUR } = require('../src/executor');

const on = { enabled: true, relaunch: true, startWithManager: false };
const base = { running: 0, seen: false, held: false, startedOnce: false, pathOk: true, now: 1_000_000, nextAttemptAt: 0, relaunches: [] };

test('tasklist output is parsed whatever the Windows language', () => {
  const out = '"Potassium.exe","4120","Console","1","412.336 K"\r\n"Potassium.exe","77","Console","1","1,024 K"\r\nINFO: nothing\r\n';
  assert.deepEqual(parseTasklist(out), [
    { name: 'Potassium.exe', pid: 4120, memMB: 403 },
    { name: 'Potassium.exe', pid: 77, memMB: 1 },
  ]);
  assert.deepEqual(parseTasklist('INFO: No tasks are running which match the specified criteria.'), []);
});

test('command arguments keep quoted parts together and are capped', () => {
  assert.deepEqual(splitArgs('--name "my script.lua" -v'), ['--name', 'my script.lua', '-v']);
  assert.deepEqual(splitArgs(''), []);
  assert.equal(splitArgs(Array.from({ length: 50 }, (_, i) => 'a' + i).join(' ')).length, 20);
});

test('only plain program names are accepted', () => {
  assert.equal(validName('Potassium.exe'), true);
  assert.equal(validName('my tool.exe'), true);
  assert.equal(validName('..\\evil.exe'), false);
  assert.equal(validName('x.exe /c calc'), false);
  assert.equal(validName('notanexe'), false);
});

test('the executor is not started just because the setting is on', () => {
  const d = decide(on, base);
  assert.equal(d.status, 'standby');
  assert.equal(d.action, undefined);
});

test('it is started again only after it was seen running', () => {
  assert.equal(decide(on, { ...base, seen: true }).action, 'start');
  assert.equal(decide({ ...on, relaunch: false }, { ...base, seen: true }).status, 'closed');
  assert.equal(decide(on, { ...base, running: 1, seen: true }).status, 'running');
});

test('"open it with the manager" starts it once, and only when it is not already open', () => {
  const cfg = { ...on, startWithManager: true };
  assert.equal(decide(cfg, base).action, 'start');
  assert.equal(decide(cfg, { ...base, startedOnce: true }).status, 'standby');
  assert.equal(decide(cfg, { ...base, running: 1 }).action, undefined);
});

test('a missing path, a retry delay and the hourly cap all hold a start back', () => {
  assert.equal(decide(on, { ...base, seen: true, pathOk: false }).status, 'error');
  assert.equal(decide(on, { ...base, seen: true, nextAttemptAt: base.now + 5000 }).status, 'waiting');
  const many = Array.from({ length: RELAUNCH_CAP_PER_HOUR }, () => base.now - 60e3);
  assert.equal(decide(on, { ...base, seen: true, relaunches: many }).status, 'throttled');
  const old = Array.from({ length: RELAUNCH_CAP_PER_HOUR }, () => base.now - 2 * 3600e3);
  assert.equal(decide(on, { ...base, seen: true, relaunches: old }).action, 'start');
});

test('a held executor and a switched-off feature are never started', () => {
  assert.equal(decide(on, { ...base, seen: true, held: true }).status, 'held');
  assert.equal(decide({ ...on, enabled: false }, { ...base, seen: true }).status, 'off');
});

function make(cfg) {
  const settings = { get: (k) => (k === 'executor' ? cfg : undefined), update() {} };
  const ex = new Executor({ settings });
  const calls = { starts: 0 };
  let procs = [];
  ex.find = async () => procs;
  ex.pathOk = () => true;
  ex.probe = async () => {};
  ex.checkTasks = async () => {};
  ex.launch = async () => { calls.starts++; ex.relaunches.push(Date.now()); ex.nextAttemptAt = Date.now() + 20e3; ex.startedOnce = true; procs = [{ name: 'Potassium.exe', pid: 9, memMB: 300 }]; return ''; };
  return { ex, calls, setProcs: (p) => { procs = p; } };
}

test('closing the executor after it was open starts it again', async () => {
  const { ex, calls, setProcs } = make({ enabled: true, relaunch: true, startWithManager: false, processName: 'Potassium.exe', afterLaunch: {} });
  await ex.tick();
  assert.equal(ex.view.status, 'standby');
  assert.equal(calls.starts, 0);
  setProcs([{ name: 'Potassium.exe', pid: 5, memMB: 250 }]);
  await ex.tick();
  assert.equal(ex.view.status, 'running');
  assert.equal(ex.view.memMB, 250);
  setProcs([]);
  await ex.tick();
  assert.equal(calls.starts, 1);
});

test('the after-launch command runs only for a client that is still open', async () => {
  const launcher = new EventEmitter();
  launcher.instances = new Map();
  const cfg = { enabled: true, relaunch: true, processName: 'Potassium.exe', afterLaunch: { command: 'C:\\does\\not\\exist.ps1', args: '', delaySec: 0 } };
  const ex = new Executor({ settings: { get: () => cfg }, launcher, accounts: { get: () => ({ username: 'a', userId: 1 }) } });
  await ex.runHook({ pid: 1, accountId: 'x' }); // client already gone: nothing happens
  assert.equal(ex.hook.runs, 0);
  launcher.instances.set(1, {});
  await ex.runHook({ pid: 1, accountId: 'x' }); // missing file: reported, not run
  assert.equal(ex.hook.runs, 1);
  assert.equal(ex.hook.ok, false);
});

test('the program name comes from the path, so any executor works', () => {
  const mk = (cfg) => new Executor({ settings: { get: () => cfg } });
  assert.equal(mk({ path: 'C:\\Tools\\Volt.exe', processName: 'Potassium.exe' }).name(), 'Volt.exe');
  assert.equal(mk({ path: '', processName: 'Madium.exe' }).name(), 'Madium.exe');
  assert.equal(mk({ path: 'C:\\Tools\\readme.txt', processName: 'Real.exe' }).name(), 'Real.exe');
  assert.equal(mk({}).name(), 'Potassium.exe');
});

test('known executor names are recognised and look-alikes are not', () => {
  assert.equal(profileOf('Potassium.exe').label, 'Potassium');
  assert.equal(profileOf('VoltExecutor.exe').label, 'Volt');
  assert.equal(profileOf('madium.exe').label, 'Madium');
  assert.equal(profileOf('Real.exe').label, 'Real');
  assert.equal(profileOf('RealtekAudioService.exe'), null);
  assert.equal(profileOf('chrome.exe'), null);
  assert.equal(profileOf(''), null);
});

test('the open-programs list groups processes, hides Windows programs and puts known executors first', () => {
  const procs = [
    { name: 'svchost.exe', pid: 1, memMB: 50 }, { name: 'Zed.exe', pid: 2, memMB: 900 }, { name: 'Zed.exe', pid: 3, memMB: 100 },
    { name: 'Volt.exe', pid: 4, memMB: 40 }, { name: 'bad name.txt', pid: 5, memMB: 1 }, { name: 'Other.exe', pid: 6, memMB: 200 },
  ];
  const list = listPrograms(procs);
  assert.deepEqual(list.map((p) => p.name), ['Volt.exe', 'Zed.exe', 'Other.exe']);
  assert.equal(list[1].count, 2);
  assert.equal(list[1].memMB, 1000);
  assert.equal(list[0].profile, 'Volt');
  assert.equal(listPrograms(procs, 1).length, 1);
});

test('choosing another executor forgets what was known about the previous one', async () => {
  const cfg = { enabled: true, relaunch: true, startWithManager: false, processName: 'Potassium.exe', path: '', afterLaunch: {} };
  const { ex, calls, setProcs } = make(cfg);
  setProcs([{ name: 'Potassium.exe', pid: 5, memMB: 250 }]);
  await ex.tick();
  assert.equal(ex.seen, true);
  cfg.processName = 'Volt.exe';
  setProcs([]);
  await ex.tick();
  assert.equal(ex.view.status, 'standby'); // not "closed": Volt was never open
  assert.equal(calls.starts, 0);
});

test('a program that needs administrator rights is opened that way', async () => {
  const ex = new Executor({ settings: { get: () => ({ enabled: true, path: 'C:\\Tools\\Volt.exe', asAdmin: false }) } });
  ex.pathOk = () => true;
  const how = [];
  ex.startPlain = async () => { how.push('plain'); return 'needs-admin'; };
  ex.startAsAdmin = async () => { how.push('admin'); return ''; };
  assert.equal(await ex.launch(), '');
  assert.deepEqual(how, ['plain', 'admin']);
  assert.equal(ex.looksElevated, true);
  how.length = 0;
  await ex.launch(); // remembered: no failed plain attempt first
  assert.deepEqual(how, ['admin']);
  ex.startAsAdmin = async () => 'The administrator prompt was declined';
  ex.looksElevated = false;
  assert.equal(await ex.launch(), 'The administrator prompt was declined');
  assert.equal(ex.looksElevated, false);
});

function openFirst(cfg, running) {
  const ex = new Executor({ settings: { get: () => cfg } });
  ex.pollMs = 1; ex.settleMs = 1;
  const calls = { starts: 0 };
  let up = running;
  ex.find = async () => (up ? [{ name: 'Potassium.exe', pid: 9, memMB: 100 }] : []);
  ex.probe = async () => {};
  ex.checkTasks = async () => {};
  ex.pathOk = () => true;
  ex.launch = async () => { calls.starts++; ex.relaunches.push(Date.now()); up = true; return ''; };
  return { ex, calls };
}

test('open before clients: opens a closed executor once, even for launches that overlap', async () => {
  const { ex, calls } = openFirst({ enabled: true, openBeforeClients: true, openWaitSec: 5, processName: 'Potassium.exe' }, false);
  await Promise.all([ex.ensureOpen(), ex.ensureOpen(), ex.ensureOpen()]);
  assert.equal(calls.starts, 1);
  assert.equal(ex.seen, true);
  await ex.ensureOpen();
  assert.equal(calls.starts, 1); // already open
});

test('open before clients does nothing when off, held, unknown or started too often', async () => {
  for (const [cfg, mut] of [
    [{ enabled: true, openBeforeClients: false }, null],
    [{ enabled: false, openBeforeClients: true }, null],
    [{ enabled: true, openBeforeClients: true }, (ex) => { ex.held = true; }],
    [{ enabled: true, openBeforeClients: true }, (ex) => { ex.pathOk = () => false; }],
    [{ enabled: true, openBeforeClients: true }, (ex) => { for (let i = 0; i < RELAUNCH_CAP_PER_HOUR; i++) ex.relaunches.push(Date.now()); }],
  ]) {
    const { ex, calls } = openFirst({ openWaitSec: 1, processName: 'Potassium.exe', ...cfg }, false);
    if (mut) mut(ex);
    await ex.ensureOpen();
    assert.equal(calls.starts, 0);
  }
});

test('scanning a folder lists the programs in it and skips installers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iram-scan-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'Volt.exe'), Buffer.alloc(3000));
    fs.writeFileSync(path.join(dir, 'bin', 'Helper.exe'), Buffer.alloc(9000));
    fs.writeFileSync(path.join(dir, 'unins000.exe'), 'x');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const ex = new Executor({ settings: { get: () => ({}) } });
    const files = await ex.scanFolder(dir);
    assert.deepEqual(files.map((f) => f.rel), ['Volt.exe', path.join('bin', 'Helper.exe')]); // known executor first
    assert.equal(files[0].profile, 'Volt');
    assert.equal(files[0].inUse, false);
    assert.equal((await ex.scanFolder(path.join(dir, 'Volt.exe'))).length, 2); // a file path means its folder
    await assert.rejects(() => ex.scanFolder(path.join(dir, 'missing')), /does not exist/);
    await assert.rejects(() => ex.scanFolder('  '), /Enter a folder/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the setup script creates both tasks with the highest privileges and quotes awkward paths', () => {
  const s = buildTaskScript({ user: "PC\\o'brien", exe: "C:\\Tools\\it's here\\Volt.exe", name: 'Volt.exe' });
  assert.match(s, /-RunLevel Highest/);
  assert.match(s, /-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/); // no 72-hour limit that would stop the executor
  assert.equal((s.match(/Register-ScheduledTask/g) || []).length, 2);
  assert.ok(s.includes("'PC\\o''brien'"));
  assert.ok(s.includes("'C:\\Tools\\it''s here\\Volt.exe'"));
  assert.ok(s.includes("-WorkingDirectory 'C:\\Tools\\it''s here'"));
  assert.ok(s.includes("'/F /IM \"Volt.exe\"'"));
  assert.ok(s.includes("'" + TASK_OPEN + "'") && s.includes("'" + TASK_CLOSE + "'"));
  const r = buildTaskRemoveScript();
  assert.equal((r.match(/Unregister-ScheduledTask/g) || []).length, 2);
});

test('the administrator tasks are used only when they exist for the current program', async () => {
  const cfg = { enabled: true, path: 'C:\\Tools\\Volt.exe', taskPath: 'C:\\Tools\\Volt.exe', asAdmin: true };
  const ex = new Executor({ settings: { get: () => cfg } });
  ex.pathOk = () => true;
  const calls = [];
  ex.runTask = async (n) => { calls.push(n); return ''; };
  ex.startAsAdmin = async () => { calls.push('prompt'); return ''; };
  ex.tasks = { open: true, close: true, at: Date.now() };
  assert.equal(ex.taskState(), 'ready');
  assert.equal(await ex.launch(), '');
  assert.deepEqual(calls, [TASK_OPEN]); // no prompt
  calls.length = 0;
  ex.runTask = async () => 'Access is denied'; // a task that will not start falls back to the prompt
  assert.equal(await ex.launch(), '');
  assert.deepEqual(calls, ['prompt']);
  calls.length = 0;
  cfg.taskPath = 'C:\\Other\\Real.exe'; // set up for another program
  ex.runTask = async (n) => { calls.push(n); return ''; };
  assert.equal(ex.taskState(), 'stale');
  await ex.launch();
  assert.deepEqual(calls, ['prompt']);
  cfg.taskPath = '';
  ex.tasks = { open: false, close: false, at: Date.now() };
  assert.equal(ex.taskState(), 'none');
});
