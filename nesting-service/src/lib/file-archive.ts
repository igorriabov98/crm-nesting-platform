import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

let archiveClient: SupabaseClient | null = null;

export type ArchiveAsset = {
  id: string;
  policy_key: string;
  bucket_id: string;
  object_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | string;
  source_created_at: string;
  machine_id: string | null;
  object_label: string | null;
  category: string;
  state: string;
  archive_run_id: string | null;
  drive_connection_id: string | null;
  drive_file_id: string | null;
  archived_path: string | null;
};

type DriveConnection = {
  id: string;
  email: string;
  status: string;
  access_token_vault_id: string | null;
  refresh_token_vault_id: string;
  token_expires_at: string | null;
  root_folder_id: string | null;
  root_folder_name: string;
};

type MachineSnapshot = { id: string; name: string | null; production_month: string | null };

export function getArchiveClient(): SupabaseClient {
  if (archiveClient) return archiveClient;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured for the file archive');
  }
  archiveClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return archiveClient;
}

export async function isFileArchiveEnabled() {
  const { data, error } = await getArchiveClient().from('file_archive_settings')
    .select('global_enabled').eq('id', true).maybeSingle();
  if (error) throw new Error(`Cannot read file archive switch: ${error.message}`);
  return Boolean(data?.global_enabled);
}

export async function releaseArchiveCopyClaim(assetId: string) {
  const { error } = await getArchiveClient().from('file_archive_assets').update({
    state: 'queued',
    last_error: null,
  }).eq('id', assetId).eq('state', 'copying');
  if (error) throw new Error(`Cannot release archive copy claim: ${error.message}`);
}

async function readVaultSecret(secretId: string): Promise<string> {
  const { data, error } = await getArchiveClient().rpc('mail_vault_read_secret', { p_secret_id: secretId });
  if (error || typeof data !== 'string' || !data) throw new Error(`Supabase Vault: ${error?.message || 'secret missing'}`);
  return data;
}

async function storeVaultSecret(input: { secretId?: string | null; secret: string; name: string; description: string }) {
  const { data, error } = await getArchiveClient().rpc('mail_vault_store_secret', {
    p_secret_id: input.secretId || null,
    p_secret: input.secret,
    p_name: input.name,
    p_description: input.description,
  });
  if (error || typeof data !== 'string' || !data) throw new Error(`Supabase Vault: ${error?.message || 'secret write failed'}`);
  return data;
}

async function getDriveToken(connection: DriveConnection): Promise<string> {
  if (
    connection.access_token_vault_id
    && connection.token_expires_at
    && new Date(connection.token_expires_at).getTime() > Date.now() + 60_000
  ) {
    return readVaultSecret(connection.access_token_vault_id);
  }
  const { data: settings, error } = await getArchiveClient().from('mail_settings')
    .select('oauth_client_id,oauth_client_secret_vault_id').eq('id', true).maybeSingle();
  if (error || !settings?.oauth_client_id || !settings.oauth_client_secret_vault_id) {
    throw new Error('Google OAuth settings are not configured');
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.oauth_client_id,
      client_secret: await readVaultSecret(settings.oauth_client_secret_vault_id),
      refresh_token: await readVaultSecret(connection.refresh_token_vault_id),
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) {
    const message = payload.error_description || `OAuth refresh failed: ${response.status}`;
    await getArchiveClient().from('file_archive_connections').update({ status: 'error', last_error: message }).eq('id', connection.id);
    throw new Error(message);
  }
  const vaultId = await storeVaultSecret({
    secretId: connection.access_token_vault_id,
    secret: payload.access_token,
    name: `drive-access-${connection.id}`,
    description: `Google Drive access token for archive connection ${connection.id}`,
  });
  await getArchiveClient().from('file_archive_connections').update({
    access_token_vault_id: vaultId,
    token_expires_at: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(),
    last_verified_at: new Date().toISOString(),
    last_error: null,
  }).eq('id', connection.id);
  return payload.access_token;
}

async function driveFetch(connection: DriveConnection, url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${await getDriveToken(connection)}`, ...init?.headers },
  });
}

async function loadConnection(id?: string | null): Promise<DriveConnection> {
  let query = getArchiveClient().from('file_archive_connections').select('*');
  query = id ? query.eq('id', id) : query.eq('status', 'active');
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Active Google Drive connection is missing');
  return data as DriveConnection;
}

function driveEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function safeFolderName(value: string) {
  return value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Без названия';
}

async function ensureFolder(
  connection: DriveConnection,
  folderKey: string,
  folderName: string,
  parentFolderId: string | null,
) {
  const db = getArchiveClient();
  const { data: cached } = await db.from('file_archive_folders')
    .select('drive_folder_id').eq('connection_id', connection.id).eq('folder_key', folderKey).maybeSingle();
  if (cached?.drive_folder_id) return cached.drive_folder_id as string;

  const query = [
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    `appProperties has { key='crmFolderKey' and value='${driveEscape(folderKey)}' }`,
    parentFolderId ? `'${driveEscape(parentFolderId)}' in parents` : null,
  ].filter(Boolean).join(' and ');
  const search = await driveFetch(connection, `${DRIVE_API}/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)&pageSize=1`);
  const searchPayload = await search.json() as { files?: Array<{ id: string }> };
  if (!search.ok) throw new Error(`Drive folder lookup failed: ${search.status}`);
  let folderId = searchPayload.files?.[0]?.id;
  if (!folderId) {
    const create = await driveFetch(connection, `${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: safeFolderName(folderName),
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentFolderId ? { parents: [parentFolderId] } : {}),
        appProperties: { crmFolderKey: folderKey },
      }),
    });
    const payload = await create.json() as { id?: string; error?: { message?: string } };
    if (!create.ok || !payload.id) throw new Error(payload.error?.message || `Drive folder create failed: ${create.status}`);
    folderId = payload.id;
  }
  await db.from('file_archive_folders').upsert({
    connection_id: connection.id,
    parent_folder_id: parentFolderId,
    folder_key: folderKey,
    folder_name: safeFolderName(folderName),
    drive_folder_id: folderId,
  }, { onConflict: 'connection_id,folder_key' });
  return folderId;
}

async function ensureFolderPath(connection: DriveConnection, asset: ArchiveAsset) {
  const db = getArchiveClient();
  let machine: MachineSnapshot | null = null;
  if (asset.machine_id) {
    const { data } = await db.from('machines').select('id,name,production_month').eq('id', asset.machine_id).maybeSingle();
    machine = (data || null) as MachineSnapshot | null;
  }
  const sourceDate = new Date(machine?.production_month || asset.source_created_at);
  const year = String(sourceDate.getUTCFullYear());
  const monthNumber = String(sourceDate.getUTCMonth() + 1).padStart(2, '0');
  const month = `${monthNumber} ${MONTHS_RU[sourceDate.getUTCMonth()]}`;
  const parts = machine
    ? [year, month, `${machine.name || 'Машина'} [${machine.id.slice(0, 8)}]`, asset.category]
    : ['Без привязки', year, month, asset.object_label || 'Объект', asset.category];
  let parent: string | null = await ensureFolder(connection, 'root', connection.root_folder_name, null);
  if (parent && connection.root_folder_id !== parent) {
    await db.from('file_archive_connections').update({ root_folder_id: parent }).eq('id', connection.id);
  }
  let key = 'root';
  const names = [connection.root_folder_name];
  for (const part of parts) {
    const name = safeFolderName(part);
    key = `${key}/${name}`;
    parent = await ensureFolder(connection, key, name, parent);
    names.push(name);
  }
  return { folderId: parent, archivedPath: names.join(' / ') };
}

async function findExistingDriveFile(connection: DriveConnection, assetId: string) {
  const query = `trashed = false and appProperties has { key='crmAssetId' and value='${driveEscape(assetId)}' }`;
  const response = await driveFetch(connection, `${DRIVE_API}/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,size,md5Checksum,name)&pageSize=1`);
  const payload = await response.json() as { files?: Array<{ id: string; size?: string; md5Checksum?: string }> };
  if (!response.ok) throw new Error(`Drive file lookup failed: ${response.status}`);
  return payload.files?.[0] || null;
}

async function uploadAsset(connection: DriveConnection, asset: ArchiveAsset, folderId: string) {
  const signed = await getArchiveClient().storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 300);
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message || 'Cannot create source signed URL');
  const source = await fetch(signed.data.signedUrl);
  if (!source.ok || !source.body) throw new Error(`Supabase download failed: ${source.status}`);
  const size = Number(source.headers.get('content-length') || asset.size_bytes || 0);
  const session = await driveFetch(connection, `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,size,md5Checksum,name`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-upload-content-type': asset.mime_type || 'application/octet-stream',
      ...(size > 0 ? { 'x-upload-content-length': String(size) } : {}),
    },
    body: JSON.stringify({
      name: asset.file_name,
      parents: [folderId],
      appProperties: { crmAssetId: asset.id, crmBucket: asset.bucket_id },
    }),
  });
  const uploadUrl = session.headers.get('location');
  if (!session.ok || !uploadUrl) throw new Error(`Drive resumable session failed: ${session.status}`);
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': asset.mime_type || 'application/octet-stream',
      ...(size > 0 ? { 'content-length': String(size) } : {}),
    },
    body: source.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const payload = await upload.json() as { id?: string; size?: string; md5Checksum?: string; error?: { message?: string } };
  if (!upload.ok || !payload.id) throw new Error(payload.error?.message || `Drive upload failed: ${upload.status}`);
  return payload as { id: string; size?: string; md5Checksum?: string };
}

async function verifyDriveFile(connection: DriveConnection, fileId: string, expectedSize: number) {
  const response = await driveFetch(connection, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,size,md5Checksum,trashed`);
  const payload = await response.json() as { id?: string; size?: string; md5Checksum?: string; trashed?: boolean; error?: { message?: string } };
  if (!response.ok || !payload.id || payload.trashed) throw new Error(payload.error?.message || 'Drive verification failed');
  const actualSize = Number(payload.size || 0);
  if (expectedSize > 0 && actualSize !== expectedSize) {
    throw new Error(`Drive size mismatch: expected ${expectedSize}, received ${actualSize}`);
  }
  return { id: payload.id, size: actualSize, md5Checksum: payload.md5Checksum || null };
}

export async function copyArchiveAsset(assetId: string) {
  const db = getArchiveClient();
  const { data, error } = await db.from('file_archive_assets').select('*').eq('id', assetId).maybeSingle();
  if (error || !data) throw new Error(error?.message || `Archive asset ${assetId} not found`);
  const asset = data as ArchiveAsset;
  if (asset.state === 'archived' || asset.state === 'pending_delete') return;
  const connection = await loadConnection(asset.drive_connection_id);
  const { data: policy, error: policyError } = await db.from('file_archive_policies')
    .select('local_grace_days').eq('key', asset.policy_key).maybeSingle();
  if (policyError || !policy) throw new Error(policyError?.message || 'Archive policy missing');
  const path = await ensureFolderPath(connection, asset);
  const existing = asset.drive_file_id
    ? { id: asset.drive_file_id }
    : await findExistingDriveFile(connection, asset.id);
  const file = existing || await uploadAsset(connection, asset, path.folderId);
  const verified = await verifyDriveFile(connection, file.id, Number(asset.size_bytes || 0));
  const copiedAt = new Date();
  const { error: updateError } = await db.from('file_archive_assets').update({
    state: 'pending_delete',
    drive_connection_id: connection.id,
    drive_file_id: verified.id,
    drive_folder_id: path.folderId,
    drive_md5_checksum: verified.md5Checksum,
    drive_size_bytes: verified.size,
    archived_path: path.archivedPath,
    copied_at: copiedAt.toISOString(),
    delete_after: new Date(copiedAt.getTime() + Number(policy.local_grace_days) * 86_400_000).toISOString(),
    last_error: null,
  }).eq('id', asset.id);
  if (updateError) throw new Error(updateError.message);
}

export async function deleteArchiveSource(assetId: string) {
  const db = getArchiveClient();
  const { data, error } = await db.from('file_archive_assets').select('*').eq('id', assetId).maybeSingle();
  if (error || !data) throw new Error(error?.message || `Archive asset ${assetId} not found`);
  const asset = data as ArchiveAsset;
  if (asset.state === 'archived') return;
  if (!asset.drive_connection_id || !asset.drive_file_id) throw new Error('Verified Drive copy is missing');
  const connection = await loadConnection(asset.drive_connection_id);
  await verifyDriveFile(connection, asset.drive_file_id, Number(asset.size_bytes || 0));
  if (!await isFileArchiveEnabled()) return false;
  const removal = await db.storage.from(asset.bucket_id).remove([asset.object_path]);
  if (removal.error) throw new Error(removal.error.message);
  const { error: updateError } = await db.from('file_archive_assets').update({
    state: 'archived', source_deleted_at: new Date().toISOString(), last_error: null,
  }).eq('id', asset.id);
  if (updateError) throw new Error(updateError.message);
  return true;
}

export async function markArchiveFailure(assetId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await getArchiveClient().from('file_archive_assets').update({
    state: 'failed', last_error: message.slice(0, 2000), last_attempt_at: new Date().toISOString(),
  }).eq('id', assetId);
  await notifyArchiveManagers(message);
}

async function notifyArchiveManagers(message: string) {
  const db = getArchiveClient();
  const { data: userIds } = await db.rpc('file_archive_manager_user_ids');
  const ids = (userIds || []).filter((id: unknown): id is string => typeof id === 'string');
  if (!ids.length) return;
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { data: recent } = await db.from('notifications').select('id').eq('type', 'file_archive_error').gte('created_at', since).limit(1);
  if (recent?.length) return;
  await db.from('notifications').insert(ids.map((userId: string) => ({
    user_id: userId,
    type: 'file_archive_error',
    title: 'Архивирование файлов приостановлено',
    message: message.slice(0, 500),
    is_read: false,
  })));
}

export async function downloadArchivedAsset(assetId: string) {
  const { data, error } = await getArchiveClient().from('file_archive_assets').select('*').eq('id', assetId).maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Archive asset not found');
  const asset = data as ArchiveAsset;
  if (asset.state !== 'archived') {
    const local = await getArchiveClient().storage.from(asset.bucket_id).download(asset.object_path);
    if (!local.error && local.data) return local.data;
  }
  if (!asset.drive_connection_id || !asset.drive_file_id) throw new Error('Archived Drive file is missing');
  const connection = await loadConnection(asset.drive_connection_id);
  const response = await driveFetch(connection, `${DRIVE_API}/files/${encodeURIComponent(asset.drive_file_id)}?alt=media`);
  if (!response.ok) throw new Error(`Drive download failed: ${response.status}`);
  return response.blob();
}

export async function findArchivedAsset(bucket: string, objectPath: string) {
  const { data, error } = await getArchiveClient().from('file_archive_assets')
    .select('id,state,drive_file_id').eq('bucket_id', bucket).eq('object_path', objectPath).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; state: string; drive_file_id: string | null } | null;
}

export async function registerNestingOutput(input: {
  objectPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const projectId = input.objectPath.split('/')[1] || null;
  const { error } = await getArchiveClient().rpc('file_archive_register_asset', {
    p_policy_key: 'nesting_output',
    p_source_kind: 'nesting_output',
    p_source_record_id: null,
    p_source_attachment_id: projectId,
    p_bucket_id: config.NESTING_STORAGE_BUCKET,
    p_object_path: input.objectPath,
    p_file_name: input.fileName,
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_source_created_at: new Date().toISOString(),
    p_machine_id: null,
    p_object_label: projectId ? `Nesting ${projectId}` : 'Nesting',
  });
  if (error) throw new Error(error.message);
}
