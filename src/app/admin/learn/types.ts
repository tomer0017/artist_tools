import type { AccessMode, LearnCollection, Localized } from '@/lib/learn/model';

// What Admin → Learn's page hands its tables and editor (ADR-0023): rows for
// the tables (no item text beyond titles), the groups and the lessons to
// pick from. An item's full content is loaded when its editor opens.

export interface LearnRow {
  id: string;
  kind: 'exercise' | 'challenge';
  collection: LearnCollection;
  groupId: string;
  order: number;
  title: Localized;
  access: AccessMode;
  /** Has its own mode (false: written before modes, following the old plan rules until saved). */
  explicit: boolean;
  archived: boolean;
  /** The number learners see (lessons), or null (optional, not seen by learners, or a challenge). */
  number: number | null;
  optional: boolean;
  thumbnailAssetId: string | null;
  pictures: number;
  /** What it still needs before it can be Free or Pro. */
  missing: string[];
  /** Whether it can move up or down within its group. */
  canMove: { up: boolean; down: boolean };
}

export interface GroupOption {
  id: string;
  collection: LearnCollection;
  order: number;
  title: Localized;
}

export interface LessonOption {
  id: string;
  title: Localized;
  number: number | null;
}

export interface VersionEntry {
  version: number;
  live: boolean;
  at: string | null;
  by: string;
  note: string | null;
}
