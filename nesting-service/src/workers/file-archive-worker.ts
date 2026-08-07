import {
  getBoss,
  QUEUE_FILE_ARCHIVE_COPY,
  QUEUE_FILE_ARCHIVE_DELETE,
  QUEUE_FILE_ARCHIVE_SCAN,
  stopBoss,
} from '../lib/queue';
import {
  copyArchiveAsset,
  deleteArchiveSource,
  getArchiveClient,
  isFileArchiveEnabled,
  markArchiveFailure,
  releaseArchiveCopyClaim,
  type ArchiveAsset,
} from '../lib/file-archive';

type AssetJob = { id: string; data: { assetId: string; runId?: string | null } };

async function updateRunState(runId: string | null | undefined) {
  if (!runId) return;
  const db = getArchiveClient();
  const { data, error } = await db.from('file_archive_assets').select('state').eq('archive_run_id', runId).limit(10000);
  if (error) throw new Error(error.message);
  const states = (data || []).map((row) => row.state as string);
  const hasPending = states.some((state) => ['queued', 'copying', 'pending_delete'].includes(state));
  const hasFailed = states.some((state) => state === 'failed');
  await db.from('file_archive_runs').update(hasPending
    ? { status: 'running' }
    : hasFailed
      ? { status: 'failed', completed_at: new Date().toISOString() }
      : { status: 'completed', completed_at: new Date().toISOString() }
  ).eq('id', runId).neq('status', 'preview');
}

async function enqueueEligibleAssets() {
  if (!await isFileArchiveEnabled()) return { copies: 0, deletions: 0, disabled: true };
  const boss = await getBoss();
  const db = getArchiveClient();
  const { data: run, error: runError } = await db.from('file_archive_runs').insert({
    kind: 'automatic', status: 'running', cutoff_at: new Date().toISOString(),
  }).select('id').single();
  if (runError || !run) throw new Error(runError?.message || 'Cannot create automatic archive run');
  const [{ data: copies, error: copyError }, { data: deletions, error: deleteError }] = await Promise.all([
    db.rpc('file_archive_claim_copy_jobs', { p_limit: 25, p_run_id: run.id }),
    db.rpc('file_archive_claim_delete_jobs', { p_limit: 100 }),
  ]);
  if (copyError) throw new Error(copyError.message);
  if (deleteError) throw new Error(deleteError.message);
  const copyAssets = (copies || []) as ArchiveAsset[];
  const newRunAssets = copyAssets.filter((asset) => asset.archive_run_id === run.id);
  await db.from('file_archive_runs').update({
    status: newRunAssets.length > 0 ? 'running' : 'completed',
    item_count: newRunAssets.length,
    total_bytes: newRunAssets.reduce((total, asset) => total + Number(asset.size_bytes || 0), 0),
    ...(newRunAssets.length === 0 ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', run.id);
  for (const asset of copyAssets) {
    await boss.send(QUEUE_FILE_ARCHIVE_COPY, { assetId: asset.id, runId: asset.archive_run_id || run.id }, {
      singletonKey: asset.id, retryLimit: 5, retryDelay: 30, retryBackoff: true,
    });
  }
  for (const asset of (deletions || []) as ArchiveAsset[]) {
    await boss.send(QUEUE_FILE_ARCHIVE_DELETE, { assetId: asset.id, runId: asset.archive_run_id }, {
      singletonKey: asset.id, retryLimit: 5, retryDelay: 60, retryBackoff: true,
    });
  }
  return { copies: copies?.length || 0, deletions: deletions?.length || 0, disabled: false };
}

async function main() {
  const boss = await getBoss();
  await boss.schedule(QUEUE_FILE_ARCHIVE_SCAN, '0 * * * *', {}, { tz: 'UTC' });
  await boss.send(QUEUE_FILE_ARCHIVE_SCAN, {}, { singletonKey: 'startup-scan' });

  await boss.work<Record<string, never>>(QUEUE_FILE_ARCHIVE_SCAN, { batchSize: 1 }, async () => {
    const result = await enqueueEligibleAssets();
    if (result.disabled) {
      console.log('[file-archive-worker] Scan skipped: archive is disabled');
      return result;
    }
    console.log(`[file-archive-worker] Scan complete: ${result.copies} copy, ${result.deletions} delete`);
    return result;
  });
  await boss.work<{ assetId: string }>(QUEUE_FILE_ARCHIVE_COPY, { batchSize: 1 }, async (jobs: AssetJob[]) => {
    for (const job of jobs) {
      try {
        if (!await isFileArchiveEnabled()) {
          await releaseArchiveCopyClaim(job.data.assetId);
          console.log(`[file-archive-worker] Copy skipped while disabled: ${job.data.assetId}`);
          continue;
        }
        await copyArchiveAsset(job.data.assetId);
        await updateRunState(job.data.runId);
        console.log(`[file-archive-worker] Copied ${job.data.assetId}`);
      } catch (error) {
        await markArchiveFailure(job.data.assetId, error);
        await updateRunState(job.data.runId);
        throw error;
      }
    }
  });
  await boss.work<{ assetId: string }>(QUEUE_FILE_ARCHIVE_DELETE, { batchSize: 1 }, async (jobs: AssetJob[]) => {
    for (const job of jobs) {
      try {
        if (!await isFileArchiveEnabled()) {
          console.log(`[file-archive-worker] Delete skipped while disabled: ${job.data.assetId}`);
          continue;
        }
        const deleted = await deleteArchiveSource(job.data.assetId);
        await updateRunState(job.data.runId);
        console.log(deleted
          ? `[file-archive-worker] Removed Supabase source ${job.data.assetId}`
          : `[file-archive-worker] Delete stopped by archive switch: ${job.data.assetId}`);
      } catch (error) {
        await markArchiveFailure(job.data.assetId, error);
        await updateRunState(job.data.runId);
        throw error;
      }
    }
  });
  console.log('[file-archive-worker] Started, hourly scan scheduled');

  const shutdown = async (signal: string) => {
    console.log(`[file-archive-worker] ${signal} received, shutting down...`);
    await stopBoss();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[file-archive-worker] Failed to start:', error);
  process.exit(1);
});
