/**
 * How a consultation is captured:
 * - "scribed": full pipeline — transcription plus clinical note generation
 * - "recording_only": transcription and archival only, no note. Used for the
 *   study's non-scribed control arm, where the consultation must still be
 *   recorded for stimulated recall but the clinician never sees AI output.
 * Encounters created before this field existed have no mode; treat absent as
 * "scribed".
 */
export type EncounterMode = "scribed" | "recording_only"

export type EncounterStatus =
  | "idle"
  | "recording"
  | "processing"
  | "transcription_failed"
  | "note_generation_failed"
  | "completed"

export interface Encounter {
  id: string
  patient_name: string
  patient_id: string
  visit_reason: string
  session_id?: string
  created_at: string
  updated_at: string
  audio_blob?: Blob
  transcript_text: string
  /**
   * Clinical note in markdown format
   * This is the primary storage format for notes
   */
  note_text: string
  /**
   * Version of note_text. The generated note is v0; each user edit that is
   * saved increments it. Every version is archived as its own note_v<N>.md.
   */
  note_version?: number
  /** Archive state of the current note version's copy in the storage backend. */
  note_archive_status?: NoteArchiveStatus
  status: EncounterStatus
  mode?: EncounterMode
  language: string
  recording_duration?: number
  /** Archival state, when archiving is enabled (see /api/archive/note). */
  archive_status?: ArchiveStatus
  /** Per-consultation container id (Box folder id, or R2 key prefix). */
  archive_location?: string
  /** ISO 8601 timestamp of the last successful archive. */
  archived_at?: string
}

/**
 * Archive state for a consultation's copy in the configured storage backend.
 * - archived: all artifacts uploaded successfully
 * - failed: an upload attempt errored (retryable)
 * - skipped: archiving is not configured, so nothing was uploaded
 */
export type ArchiveStatus = "archived" | "failed" | "skipped"

/** ArchiveStatus plus "pending" for an upload that is still in flight. */
export type NoteArchiveStatus = ArchiveStatus | "pending"

/**
 * Audit event types for HIPAA compliance tracking
 * Tracks all operations that create, read, update, or delete PHI
 */
export type AuditEventType =
  | "encounter.created"
  | "encounter.updated"
  | "encounter.deleted"
  | "encounter.archived"
  | "encounter.archive_failed"
  | "transcription.segment_uploaded"
  | "transcription.completed"
  | "transcription.failed"
  | "note.generation_started"
  | "note.generated"
  | "note.generation_failed"
  | "settings.api_key_configured"
  | "settings.preferences_updated"
  | "audit.exported"
  | "audit.purged"

/**
 * Audit log entry for HIPAA compliance
 * Stored encrypted in localStorage or filesystem
 * CRITICAL: No PHI content allowed (patient names, transcripts, notes)
 */
export interface AuditLogEntry {
  /** Unique identifier for this audit entry */
  id: string
  /** ISO 8601 timestamp when event occurred */
  timestamp: string
  /** Type of event being audited */
  event_type: AuditEventType
  /** Resource identifier (e.g., encounter ID) - NOT patient identifiers */
  resource_id?: string
  /** Operation success status */
  success: boolean
  /** Error message if operation failed (sanitized, no PHI) */
  error_message?: string
  /** Additional non-PHI metadata (durations, counts, settings changed) */
  metadata?: Record<string, unknown>
  /** User identifier for future multi-user support */
  user_id?: string
}

/**
 * Filter options for querying audit logs
 */
export interface AuditLogFilter {
  /** Start date (ISO 8601) */
  startDate?: string
  /** End date (ISO 8601) */
  endDate?: string
  /** Filter by event types */
  eventTypes?: AuditEventType[]
  /** Filter by resource ID */
  resourceId?: string
  /** Filter by success status */
  success?: boolean
  /** Maximum number of entries to return */
  limit?: number
}

/**
 * Export format options for audit logs
 */
export type AuditExportFormat = "csv" | "json"
