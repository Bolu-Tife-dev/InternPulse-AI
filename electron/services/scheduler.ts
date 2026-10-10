import { getSetting } from '../db';
import { logLine } from '../env';
import { syncOutlookInbox } from './outlook';

let outlookTimer: NodeJS.Timeout | null = null;
let running = false;

export async function startScheduler(): Promise<void> {
  await stopScheduler();
  const raw = await getSetting('OUTLOOK_SYNC_INTERVAL_MS', '300000');
  const interval = Number(raw);
  if (!interval || interval <= 0) {
    logLine('[scheduler] outlook sync disabled');
    return;
  }
  outlookTimer = setInterval(() => {
    void tick();
  }, interval);
  logLine(`[scheduler] outlook sync every ${interval}ms`);
}

export async function stopScheduler(): Promise<void> {
  if (outlookTimer) {
    clearInterval(outlookTimer);
    outlookTimer = null;
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const summary = await syncOutlookInbox();
    if (summary.matched > 0) {
      logLine(`[scheduler] outlook sync matched=${summary.matched} tagged=${summary.tagged}`);
    }
  } catch (error) {
    logLine(`[scheduler] outlook sync failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    running = false;
  }
}

export async function runOutlookSyncNow(): Promise<void> {
  await tick();
}
