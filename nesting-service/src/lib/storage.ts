import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

const STORAGE_SCHEME = 'supabase://';
const ALLOWED_PREFIXES: Record<string, readonly string[]> = {
  'product-files': ['products/'],
  'nesting-files': ['uploads/', 'projects/'],
};
let storageClient: SupabaseClient | null = null;

export type MaterializedStorageObject = {
  filePath: string;
  cleanup: () => Promise<void>;
};

export type StorageFileKind = 'step' | 'pdf';

export function createStorageUri(bucket: string, objectPath: string): string {
  validateStorageRef(bucket, objectPath);
  return `${STORAGE_SCHEME}${bucket}/${objectPath}`;
}

export function isStorageUri(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith(STORAGE_SCHEME));
}

export function isStorageConfigured(): boolean {
  return Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);
}

export function parseStorageUri(uri: string): { bucket: string; objectPath: string } {
  if (!isStorageUri(uri)) throw new Error('Invalid Supabase Storage URI');
  const value = uri.slice(STORAGE_SCHEME.length);
  const slash = value.indexOf('/');
  if (slash <= 0) throw new Error('Invalid Supabase Storage URI');
  const bucket = value.slice(0, slash);
  const objectPath = value.slice(slash + 1);
  validateStorageRef(bucket, objectPath);
  return { bucket, objectPath };
}

export async function materializeStorageObject(uriOrPath: string): Promise<MaterializedStorageObject> {
  if (!isStorageUri(uriOrPath)) {
    return { filePath: uriOrPath, cleanup: async () => undefined };
  }

  const { bucket, objectPath } = parseStorageUri(uriOrPath);
  const directory = path.join(tmpdir(), 'nesting-service', randomUUID());
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, safeFileName(path.basename(objectPath)));
  const { data, error } = await getStorageClient().storage.from(bucket).download(objectPath);
  if (error || !data) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(error?.message || `Storage object not found: ${uriOrPath}`);
  }
  try {
    await pipeline(
      Readable.fromWeb(data.stream() as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(filePath)
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    filePath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function materializeValidatedStorageObject(
  uriOrPath: string,
  kind: StorageFileKind
): Promise<MaterializedStorageObject> {
  const materialized = await materializeStorageObject(uriOrPath);
  try {
    await validateMaterializedFile(materialized.filePath, kind);
    return materialized;
  } catch (error) {
    await materialized.cleanup();
    throw error;
  }
}

export async function createSignedUpload(
  kind: StorageFileKind,
  originalName: string
): Promise<{ bucket: string; objectPath: string; token: string; signedUrl: string; storageUri: string }> {
  const bucket = config.NESTING_STORAGE_BUCKET;
  const extension = kind === 'step' ? '.step' : '.pdf';
  const date = new Date().toISOString().slice(0, 10);
  const baseName = safeFileName(path.basename(originalName, path.extname(originalName))).slice(0, 80) || kind;
  const objectPath = `uploads/${date}/${randomUUID()}/${baseName}${extension}`;
  validateStorageRef(bucket, objectPath);

  const { data, error } = await getStorageClient().storage.from(bucket).createSignedUploadUrl(objectPath);
  if (error || !data) throw new Error(`Signed upload URL failed: ${error?.message || 'unknown error'}`);

  return {
    bucket,
    objectPath,
    token: data.token,
    signedUrl: data.signedUrl,
    storageUri: createStorageUri(bucket, objectPath),
  };
}

export async function uploadStorageBuffer(
  objectPath: string,
  body: Buffer | string,
  contentType: string
): Promise<string> {
  const bucket = config.NESTING_STORAGE_BUCKET;
  validateStorageRef(bucket, objectPath);
  const { error } = await getStorageClient().storage.from(bucket).upload(objectPath, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return createStorageUri(bucket, objectPath);
}

export async function downloadStorageBuffer(uri: string): Promise<Buffer> {
  const materialized = await materializeStorageObject(uri);
  try {
    return await readFile(materialized.filePath);
  } finally {
    await materialized.cleanup();
  }
}

export async function removeOwnedStorageUris(uris: Array<string | null | undefined>): Promise<void> {
  const grouped = new Map<string, string[]>();
  for (const uri of uris) {
    if (!uri || !isStorageUri(uri)) continue;
    const { bucket, objectPath } = parseStorageUri(uri);
    if (bucket !== config.NESTING_STORAGE_BUCKET) continue;
    grouped.set(bucket, [...(grouped.get(bucket) || []), objectPath]);
  }
  await Promise.all(Array.from(grouped.entries()).map(async ([bucket, paths]) => {
    const { error } = await getStorageClient().storage.from(bucket).remove(Array.from(new Set(paths)));
    if (error) throw new Error(`Storage cleanup failed: ${error.message}`);
  }));
}

export async function removeProjectStorageObjects(projectId: string): Promise<void> {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return;
  const bucket = config.NESTING_STORAGE_BUCKET;
  const prefix = `projects/${projectId}`;
  validateStorageRef(bucket, `${prefix}/placeholder`);
  const { data, error } = await getStorageClient().storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`Storage list failed: ${error.message}`);
  const objectPaths = (data || []).filter((item) => item.id).map((item) => `${prefix}/${item.name}`);
  if (objectPaths.length === 0) return;
  const { error: removeError } = await getStorageClient().storage.from(bucket).remove(objectPaths);
  if (removeError) throw new Error(`Storage cleanup failed: ${removeError.message}`);
}

function getStorageClient(): SupabaseClient {
  if (storageClient) return storageClient;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase Storage is not configured');
  }
  storageClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return storageClient;
}

export function validateStorageRef(bucket: string, objectPath: string) {
  const prefixes = ALLOWED_PREFIXES[bucket];
  const hasUnsafeSegment = objectPath.split('/').some((segment) => !segment || segment === '.' || segment === '..');
  if (
    !prefixes ||
    !objectPath ||
    objectPath.startsWith('/') ||
    objectPath.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(objectPath) ||
    hasUnsafeSegment ||
    !prefixes.some((prefix) => objectPath.startsWith(prefix))
  ) {
    throw new Error('Storage reference is not allowed');
  }
}

async function validateMaterializedFile(filePath: string, kind: StorageFileKind): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = kind === 'step' ? config.MAX_FILE_SIZE_MB * 1024 * 1024 : 50 * 1024 * 1024;
  if (fileStat.size <= 0 || fileStat.size > maxBytes) {
    throw new Error(`${kind.toUpperCase()} file size is invalid`);
  }

  const handle = await open(filePath, 'r');
  const buffer = Buffer.alloc(128);
  try {
    await handle.read(buffer, 0, buffer.length, 0);
  } finally {
    await handle.close();
  }
  const header = buffer.toString('utf8');
  const valid = kind === 'step' ? header.includes('ISO-10303-21') : header.startsWith('%PDF');
  if (!valid) throw new Error(`${kind.toUpperCase()} file signature is invalid`);
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file.bin';
}
