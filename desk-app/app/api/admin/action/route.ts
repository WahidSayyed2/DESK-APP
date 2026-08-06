import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Tables the Super Admin is allowed to wipe from the Admin Console.
// (Kept as an explicit allow-list so this endpoint can never be tricked
// into touching auth/storage internals.)
const CLEARABLE_TABLES = [
  'tasks',
  'task_updates',
  'chat_messages',
  'attendance',
  'expenses',
  'cost_comparisons',
  'cost_tickets',
  'cost_ticket_options',
  'wishlist_items',
  'reminders',
  'notifications',
];

const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { op, accessToken } = body || {};

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server. Add it in Vercel Project Settings > Environment Variables, then redeploy.' },
        { status: 500 },
      );
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    // 1) verify the caller is genuinely logged in (using their own token, no admin powers)
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: callerAuth, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerAuth.user) {
      return NextResponse.json({ error: 'Could not verify your session. Please sign in again.' }, { status: 401 });
    }

    // 2) service-role client — full backend power, never exposed to the browser
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 3) confirm the caller is actually a Super Admin before doing anything privileged
    const { data: callerProfile, error: profileErr } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();
    if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Only a Super Admin account can perform this action.' }, { status: 403 });
    }

    const callerId = callerAuth.user.id;

    // -------------------------------------------------------------------
    switch (op) {
      // ---- wipe every row of an allow-listed table --------------------
      case 'clearTable': {
        const table = String(body.table || '');
        if (!CLEARABLE_TABLES.includes(table)) {
          return NextResponse.json({ error: `Table "${table}" is not clearable.` }, { status: 400 });
        }
        const { error, count } = await admin
          .from(table)
          .delete({ count: 'exact' })
          .neq('id', IMPOSSIBLE_ID);
        if (error) {
          return NextResponse.json({ error: `Failed to clear ${table}: ${error.message}` }, { status: 500 });
        }
        return NextResponse.json({ ok: true, cleared: count ?? 0, table });
      }

      // ---- fully remove a user: profile row + their auth login --------
      case 'deleteUser': {
        const id = String(body.id || '');
        if (!id) return NextResponse.json({ error: 'A user id is required.' }, { status: 400 });
        if (id === callerId) {
          return NextResponse.json({ error: "You can't delete your own account while signed in." }, { status: 400 });
        }
        // remove the role/profile row first
        const { error: profDelErr } = await admin.from('profiles').delete().eq('id', id);
        if (profDelErr) {
          return NextResponse.json({ error: `Could not remove the profile: ${profDelErr.message}` }, { status: 500 });
        }
        // then delete the actual auth login so it can no longer sign in
        const { error: authDelErr } = await admin.auth.admin.deleteUser(id);
        if (authDelErr) {
          return NextResponse.json(
            { error: `Profile removed, but deleting the login failed: ${authDelErr.message}` },
            { status: 500 },
          );
        }
        return NextResponse.json({ ok: true, id });
      }

      // ---- change an attendance record's punch in / punch out ---------
      case 'updateAttendance': {
        const id = String(body.id || '');
        if (!id) return NextResponse.json({ error: 'An attendance id is required.' }, { status: 400 });
        const patch: Record<string, string | null> = {};
        if (body.punch_in !== undefined) patch.punch_in = body.punch_in;
        if (body.punch_out !== undefined) patch.punch_out = body.punch_out; // may be null
        if (!Object.keys(patch).length) {
          return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
        }
        const { error } = await admin.from('attendance').update(patch).eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, id });
      }

      // ---- regularize / add an attendance record for a day ------------
      case 'insertAttendance': {
        const role = String(body.role || 'ea');
        if (!['director', 'ea'].includes(role)) {
          return NextResponse.json({ error: 'Role must be director or ea.' }, { status: 400 });
        }
        if (!body.punch_in) return NextResponse.json({ error: 'A punch-in time is required.' }, { status: 400 });
        const { data, error } = await admin
          .from('attendance')
          .insert({ role, punch_in: body.punch_in, punch_out: body.punch_out ?? null })
          .select()
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, row: data });
      }

      // ---- delete a single attendance record --------------------------
      case 'deleteAttendance': {
        const id = String(body.id || '');
        if (!id) return NextResponse.json({ error: 'An attendance id is required.' }, { status: 400 });
        const { error } = await admin.from('attendance').delete().eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, id });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${op}".` }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
