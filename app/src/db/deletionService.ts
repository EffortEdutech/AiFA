/**
 * Remote account-data deletion — best-effort counterpart to
 * deletionRepository.ts's `deleteAllLocalData` (Sprint 10, Vol 7_7 Data &
 * Privacy). Same native/network-dependent shape as backupService.ts
 * (Sprint 9): code-complete against the documented Supabase client API,
 * not exercisable in this sandbox.
 *
 * Scope, stated honestly rather than overclaimed:
 * - Deletes this owner's `public.backups` metadata rows and their
 *   corresponding objects in the `backups` Storage bucket -- the only
 *   remote business data Phase 1 ever writes (Vol 8_4 §2, §3: this
 *   backend never stores anything else about a business).
 * - Signs the local session out afterwards.
 * - Does NOT delete the underlying Supabase Auth user record itself.
 *   Deleting an auth user requires Supabase's admin API, which needs a
 *   service-role key -- a secret that must never be embedded in a client
 *   app (this project's own strict security rule, and Vol 8_2's general
 *   principle). That action has to happen server-side (e.g. an
 *   authenticated Edge Function the client calls, which holds the
 *   service-role key itself) -- a real, undone piece of backend work,
 *   not a client-side gap. Flagged here rather than silently pretending
 *   "delete account" fully removes the auth record.
 * - Never throws when there is no signed-in user at all -- Local
 *   deletion (deletionRepository.ts) must never be blocked on this step,
 *   per Vol 4_4 §2's local-first principle and this sprint's own risk
 *   register (deletion must work even for an owner who never connected an
 *   account).
 */
import { supabase } from "@/lib/supabaseClient";

const BACKUP_BUCKET = "backups";

export interface RemoteDeletionResult {
  attempted: boolean;
  ok: boolean;
  error: string | null;
}

/**
 * Best-effort: deletes this owner's backup rows/objects and signs out.
 * Returns `{ attempted: false, ok: true, error: null }` when there is no
 * signed-in account -- a no-op, not a failure, since there is nothing
 * remote to delete in the first place.
 */
export async function deleteRemoteAccountData(): Promise<RemoteDeletionResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { attempted: false, ok: true, error: null };
  }
  const userId = userData.user.id;

  try {
    const { data: backups, error: listError } = await supabase
      .from("backups")
      .select("storage_path")
      .eq("user_id", userId);
    if (listError) throw listError;

    const storagePaths = (backups ?? []).map(
      (row) => row.storage_path as string,
    );
    if (storagePaths.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(BACKUP_BUCKET)
        .remove(storagePaths);
      if (removeError) throw removeError;
    }

    const { error: deleteRowsError } = await supabase
      .from("backups")
      .delete()
      .eq("user_id", userId);
    if (deleteRowsError) throw deleteRowsError;

    await supabase.auth.signOut();

    return { attempted: true, ok: true, error: null };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      error: err instanceof Error ? err.message : "Remote deletion failed.",
    };
  }
}
