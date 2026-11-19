import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LockReason } from '@/lib/learn/access';
import type { LearnChallenge, LearnCollection, LearnExercise, Localized } from '@/lib/learn/model';
import type { LearnFeatureId } from '@/lib/plans';
import { signInPath } from '@/lib/redirects';
import { useAccount } from '@/components/shell/account';

// ─── Learn's data in the studio (ADR-0018) ────────────────────────────────────
// Everything comes from the Learn API, which decides on every request from the
// account's fresh entitlements (src/app/api/learn): lists show what this
// account may see, an item's content comes only when it may open it. Pages
// never carry content. Asked again on every visit to a screen, when the tab
// comes back into view, every minute while it is in view, and at once when
// the account's Learn access changes (its `learn.key`), so a card whose access
// ends locks on its next refresh; its images and exports are refused at once.

export interface ListEntry {
  id: string;
  kind: 'exercise' | 'challenge';
  collection: LearnCollection;
  groupId: string;
  order: number;
  title: Localized;
  level?: LearnChallenge['level'];
  quick?: boolean;
  medium?: LearnChallenge['medium'];
  reference?: LearnChallenge['reference'];
  /** Admins only. */
  published?: boolean;
  open: boolean;
  lock: LockReason | null;
  thumbnailAssetId: string | null;
}

export interface ListAnswer {
  collection: LearnCollection;
  contentVersion: number | null;
  groups: { id: string; order: number; title: Localized }[];
  items: ListEntry[];
}

export interface ReferenceView {
  assetId: string;
  alt: Localized;
  credit?: Localized;
  thumbnailAssetId: string | null;
  width: number | null;
  height: number | null;
}

type Common = { id: string; groupId: string; order: number; title: Localized; references: ReferenceView[]; published?: boolean };
export type OpenExercise = Common & Omit<LearnExercise, keyof Common | 'published'> & { kind: 'exercise' };
export type OpenChallenge = Common & Omit<LearnChallenge, keyof Common | 'published'> & { kind: 'challenge'; collection: 'challenges' };
export type OpenItem = OpenExercise | OpenChallenge;

export type ItemAnswer =
  | { status: 'open'; item: OpenItem; contentVersion: number | null }
  | { status: 'locked'; reason: LockReason; feature: LearnFeatureId; item: ListEntry | null }
  | { status: 'not_found' };

export interface CompletionView {
  id: string;
  itemId: string;
  completedAt: string;
}

export interface CompletionsAnswer {
  summary: { items: Record<string, { count: number; last: string }>; total: number };
  completions: CompletionView[];
  next: string | null;
  titles: Record<string, { title: Localized; kind: 'exercise' | 'challenge' } | null>;
}

/** An answer the Learn API gave other than success (429: too many requests; 503: unavailable). */
export class LearnRequestError extends Error {
  constructor(readonly status: number) {
    super(`Learn request failed (${status})`);
  }
}

/** Every Learn request: same origin, never cached; signed out leads to sign-in and back. */
export async function learnFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  if (response.status === 401) {
    window.location.assign(signInPath(window.location.pathname));
    throw new LearnRequestError(401);
  }
  return response;
}

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw new LearnRequestError(response.status);
  return (await response.json()) as T;
};

/** Do not retry what another try cannot fix soon. */
const retry = (failures: number, error: unknown) => failures < 2 && !(error instanceof LearnRequestError && [400, 401, 403, 404, 429].includes(error.status));

/** Refreshed every minute while in view (react-query pauses it in a hidden tab). */
export const LEARN_REFRESH_MS = 60_000;

function useLearnKey(): string {
  return useAccount()?.account.learn.key ?? 'none';
}

export function useLearnList(collection: LearnCollection, enabled = true) {
  const key = useLearnKey();
  return useQuery({
    queryKey: ['learn', 'list', collection, key],
    queryFn: async () => json<ListAnswer>(await learnFetch(`/api/learn/items?collection=${collection}`)),
    enabled,
    staleTime: 10_000,
    refetchInterval: LEARN_REFRESH_MS,
    refetchOnWindowFocus: true,
    retry,
  });
}

export function useLearnItem(id: string) {
  const key = useLearnKey();
  return useQuery({
    queryKey: ['learn', 'item', id, key],
    queryFn: async (): Promise<ItemAnswer> => {
      const response = await learnFetch(`/api/learn/items/${id}`);
      if (response.status === 404) return { status: 'not_found' };
      if (response.status === 403) {
        const body = (await response.json().catch(() => ({}))) as { reason?: LockReason; feature?: LearnFeatureId; item?: ListEntry };
        return { status: 'locked', reason: body.reason ?? 'not_in_plan', feature: body.feature ?? 'learn.curriculum', item: body.item ?? null };
      }
      const body = await json<{ item: OpenItem; contentVersion: number | null }>(response);
      return { status: 'open', item: body.item, contentVersion: body.contentVersion };
    },
    staleTime: 10_000,
    refetchInterval: LEARN_REFRESH_MS,
    refetchOnWindowFocus: true,
    retry,
  });
}

const COMPLETIONS = ['learn', 'completions'] as const;

/** The person's own history: never asked for in class mode (`enabled` false), so nothing about it is requested then. */
export function useCompletions(enabled: boolean) {
  return useQuery({
    queryKey: [...COMPLETIONS, 'first'],
    queryFn: async () => json<CompletionsAnswer>(await learnFetch('/api/learn/completions')),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry,
  });
}

/** The history page, a page at a time. */
export function useCompletionPages(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...COMPLETIONS, 'pages'],
    queryFn: async ({ pageParam }) => json<CompletionsAnswer>(await learnFetch(`/api/learn/completions${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ''}`)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled,
    retry,
  });
}

/** Record or remove completions; every list of them is asked again afterwards. */
export function useCompletionChanges() {
  const client = useQueryClient();
  const settle = useCallback(() => client.invalidateQueries({ queryKey: COMPLETIONS }), [client]);
  const mark = useMutation({
    mutationFn: async (itemId: string) =>
      json<{ completion: CompletionView }>(
        await learnFetch('/api/learn/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId }) }),
      ),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: async (completionId: string) => json<{ ok: true }>(await learnFetch(`/api/learn/completions/${completionId}`, { method: 'DELETE' })),
    onSettled: settle,
  });
  return { mark, remove };
}

/** The address of a Learn image (the server decides, on every request, whether it is sent). */
export const assetUrl = (assetId: string) => `/api/learn/assets/${assetId}`;

/** A Learn reference as a data URL, for a tool or worksheets on this device: only if the server still sends it. */
export async function referenceDataUrl(assetId: string): Promise<string> {
  const response = await learnFetch(assetUrl(assetId));
  if (!response.ok) throw new LearnRequestError(response.status);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** The day of a moment in this browser's time zone (YYYY-MM-DD), for "completed today". */
export const localDay = (iso: string | Date) => {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
