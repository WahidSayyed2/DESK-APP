import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, role, accessToken } = await req.json();

    if (!email || !password || !role) {
      return NextResponse.json({ error: 'Email, password, and role are required.' }, { status: 400 });
    }
    if (!['director', 'ea', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Role must be director, ea, or admin.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server. Add it in Vercel Project Settings > Environment Variables, then redeploy.' }, { status: 500 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    // verify the caller is genuinely logged in, using their own token (no admin powers yet)
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: callerAuth, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerAuth.user) {
      return NextResponse.json({ error: 'Could not verify your session. Please sign in again.' }, { status: 401 });
    }

    // service-role client — full backend power, never exposed to the browser
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // confirm the caller is actually an admin before letting them create anyone
    const { data: callerProfile, error: profileCheckErr } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();
    if (profileCheckErr || !callerProfile || callerProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Only an admin account can create new users.' }, { status: 403 });
    }

    // create the real login
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      return NextResponse.json({ error: createErr?.message || 'Failed to create the account.' }, { status: 500 });
    }

    // give them a role
    const { error: insertErr } = await adminClient.from('profiles').insert({
      id: created.user.id,
      role,
      name: name || '',
    });
    if (insertErr) {
      return NextResponse.json({ error: `Account created, but assigning the role failed: ${insertErr.message}. The login exists but has no role yet.` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: created.user.id, email });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
