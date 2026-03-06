#!/usr/bin/env node
import { Command } from 'commander';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DaemonState } from './types';

const PID_FILE = path.join(os.homedir(), '.claude-tracer', 'daemon.pid');
const PROXY_SCRIPT = path.join(__dirname, 'proxy.js');

function readState(): DaemonState | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8');
    return JSON.parse(raw) as DaemonState;
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function countCalls(sessionId: string): number {
  const file = path.join(os.homedir(), '.claude-tracer', 'sessions', sessionId, 'calls.jsonl');
  try {
    const content = fs.readFileSync(file, 'utf8');
    return content.split('\n').filter(l => l.trim()).length;
  } catch {
    return 0;
  }
}

const program = new Command();

program
  .name('claude-tracer')
  .description('Transparent proxy for tracing Claude Code API calls')
  .version('0.1.0');

program
  .command('start')
  .description('Start the proxy daemon on port 7749')
  .option('-f, --foreground', 'Run in foreground (do not detach)')
  .action((opts: { foreground?: boolean }) => {
    const existing = readState();
    if (existing && isRunning(existing.pid)) {
      console.log(`Already running (PID ${existing.pid}, session: ${existing.sessionId})`);
      process.exit(0);
    }

    if (opts.foreground) {
      require('./proxy').startProxy();
      return;
    }

    const child = child_process.spawn(process.execPath, [PROXY_SCRIPT], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    child.unref();

    setTimeout(() => {
      const state = readState();
      if (state && isRunning(state.pid)) {
        console.log(`\nProxy started. Set: export ANTHROPIC_BASE_URL=http://localhost:7749`);
        process.exit(0);
      } else {
        console.error('Proxy failed to start (no pid file written)');
        process.exit(1);
      }
    }, 1500);
  });

program
  .command('stop')
  .description('Stop the proxy daemon')
  .action(() => {
    const state = readState();
    if (!state) {
      console.log('Not running.');
      process.exit(0);
    }
    if (!isRunning(state.pid)) {
      console.log('Not running (stale pid file). Cleaning up.');
      try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
      process.exit(0);
    }
    try {
      process.kill(state.pid, 'SIGTERM');
      console.log(`Stopped PID ${state.pid} (session: ${state.sessionId})`);
      setTimeout(() => {
        if (fs.existsSync(PID_FILE)) {
          try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
        }
        process.exit(0);
      }, 500);
    } catch (err) {
      console.error('Failed to stop:', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show proxy daemon status')
  .action(() => {
    const state = readState();
    if (!state || !isRunning(state.pid)) {
      console.log('Status: stopped');
      process.exit(0);
    }
    const calls = countCalls(state.sessionId);
    console.log(`Status:     running`);
    console.log(`PID:        ${state.pid}`);
    console.log(`Session ID: ${state.sessionId}`);
    console.log(`Port:       ${state.port}`);
    console.log(`Started:    ${state.startedAt}`);
    console.log(`Calls:      ${calls}`);
    console.log(`\nTo use: export ANTHROPIC_BASE_URL=http://localhost:${state.port}`);
    process.exit(0);
  });

program.parse(process.argv);
