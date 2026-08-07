export type FileStorageLocation = 'supabase' | 'google_drive'

export type FileArchiveState =
  | 'local'
  | 'queued'
  | 'copying'
  | 'pending_delete'
  | 'archived'
  | 'failed'

export type DriveArchiveConnectionStatus = 'active' | 'read_only' | 'error'

export type DriveArchiveConnection = {
  id: string
  email: string
  displayName: string | null
  status: DriveArchiveConnectionStatus
  rootFolderName: string
  lastVerifiedAt: string | null
  lastError: string | null
  connectedAt: string
  archivedFiles: number
  archivedBytes: number
}

export type ArchivePolicy = {
  key: string
  label: string
  category: string
  enabled: boolean
  enabledAt: string | null
  retentionDays: number
  localGraceDays: number
}

export type ArchiveRun = {
  id: string
  kind: 'automatic' | 'backfill'
  status: 'preview' | 'queued' | 'running' | 'completed' | 'failed'
  cutoffAt: string
  itemCount: number
  totalBytes: number
  missingRelationCount: number
  machineCount: number
  categorySummary: Array<{ category: string; count: number; bytes: number }>
  previewHash: string | null
  createdAt: string
  confirmedAt: string | null
}

export type FileArchiveDashboard = {
  connections: DriveArchiveConnection[]
  policies: ArchivePolicy[]
  runs: ArchiveRun[]
  metrics: {
    trackedFiles: number
    archivedFiles: number
    freedBytes: number
    pendingDeleteFiles: number
    pendingDeleteBytes: number
    queuedFiles: number
    failedFiles: number
    lastSuccessfulCopyAt: string | null
  }
}
