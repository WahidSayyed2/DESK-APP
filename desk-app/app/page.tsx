'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Role = 'director' | 'ea';
type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  status: 'new' | 'progress' | 'done';
  created_by: string | null;
  created_at: string;
};
type TaskUpdate = { id: string; task_id: string; by_role: Role; text: string; created_at: string };
type Reminder = { id: string; owner_role: Role; text: string; freq: 'day' | 'week' | 'month'; created_at: string };
type ChatMessage = { id: string; from_role: Role; text: string; created_at: string };
type Profile = { id: string; role: Role; name: string };

type Tab = 'overview' | 'newtask' | 'tasks' | 'reminders' | 'ai' | 'chat';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authError, setAuthError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [tab, setTab] = useState<Tab>('overview');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [unread, setUnread] = useState(0);

  const toastId = useRef(0);
  const prevTaskCount = useRef<number | null>(null);
  const prevUpdateCount = useRef<number | null>(null);
  const prevChatCount = useRef<number | null>(null);
  const initialTabSet = useRef(false);
  const tabRef = useRef<Tab>('overview');
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  useEffect(() => { tabRef.current = tab; }, [tab]);

  function toast(text: string) {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }

  // real OS/browser-level notification (shows even if the tab isn't focused)
  function pushNotify(title: string, body: string) {
    toast(title);
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body }); }
      catch (e) { toast('Browser blocked the notification — check your OS notification settings for Chrome.'); }
    }
  }

  function sendTestNotification() {
    if (typeof window === 'undefined' || !('Notification' in window)) { toast('This browser does not support notifications.'); return; }
    if (Notification.permission !== 'granted') { toast('Click "Enable notifications" first.'); return; }
    try {
      new Notification('🔔 Test notification', { body: 'If you see this pop up from your OS (not just this toast), notifications are fully working.' });
      toast('Test sent — check for an OS-level popup, not just this message.');
    } catch (e) {
      toast('Failed to send — your OS or browser is blocking it. Check Windows notification settings for Chrome, and make sure Focus Assist / Do Not Disturb is off.');
    }
  }

  function requestNotifPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) { toast('This browser does not support notifications.'); return; }
    Notification.requestPermission().then((p) => {
      setNotifPermission(p);
      if (p === 'granted') toast('Notifications enabled on this browser.');
      if (p === 'denied') toast('Notifications blocked. Click the padlock icon in the address bar → Notifications → Allow.');
    });
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) setNotifPermission(Notification.permission);
  }, []);

  // ---------- auth bootstrap ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data, error }) => {
        if (error || !data) { setAuthError('This login has no role assigned yet. Ask your admin to add a profiles row for this account.'); return; }
        setProfile(data as Profile);
      });
  }, [session]);

  // Land each role on the right home tab (EA never sees the Director overview)
  useEffect(() => {
    if (profile && !initialTabSet.current) {
      initialTabSet.current = true;
      setTab(profile.role === 'ea' ? 'tasks' : 'overview');
    }
  }, [profile]);

  // ---------- data loading ----------
  async function loadTasks() {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (data) {
      if (profile?.role === 'ea' && prevTaskCount.current !== null && data.length > prevTaskCount.current) {
        const newest = [...data].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        pushNotify('📌 New task from the Director', newest?.title || '');
      }
      prevTaskCount.current = data.length;
      setTasks(data as Task[]);
    }
    const { data: upd } = await supabase.from('task_updates').select('*').order('created_at', { ascending: true });
    if (upd) {
      if (profile?.role === 'director' && prevUpdateCount.current !== null && upd.length > prevUpdateCount.current) {
        const newOnes = upd.slice(prevUpdateCount.current).filter((u: any) => u.by_role === 'ea');
        if (newOnes.length) {
          const t = data?.find((x: any) => x.id === newOnes[newOnes.length - 1].task_id);
          pushNotify('✅ Update from the EA', `${t ? t.title + ' — ' : ''}${newOnes[newOnes.length - 1].text}`);
        }
      }
      prevUpdateCount.current = upd.length;
      setUpdates(upd as TaskUpdate[]);
    }
  }
  async function loadReminders() {
    if (!profile) return;
    const { data } = await supabase.from('reminders').select('*').eq('owner_role', profile.role).order('created_at', { ascending: true });
    if (data) setReminders(data as Reminder[]);
  }
  async function loadChat() {
    const { data } = await supabase.from('chat_messages').select('*').order('created_at', { ascending: true });
    if (data) {
      if (prevChatCount.current !== null && data.length > prevChatCount.current) {
        const newest = data[data.length - 1] as any;
        if (newest.from_role !== profile?.role && tabRef.current !== 'chat') pushNotify('💬 New message', newest.text);
      }
      prevChatCount.current = data.length;
      setChat(data as ChatMessage[]);
    }
  }

  useEffect(() => {
    if (!profile) return;
    loadTasks();
    loadReminders();
    loadChat();
    const lastRead = Number(localStorage.getItem('desk_notif_read_' + profile.role) || 0);

    const channel = supabase
      .channel('desk-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadTasks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_updates' }, () => loadTasks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => loadChat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, () => loadReminders())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    if (!profile || profile.role !== 'ea') return;
    const lastRead = Number(localStorage.getItem('desk_notif_read_ea') || 0);
    const n = tasks.filter((t) => new Date(t.created_at).getTime() > lastRead).length;
    setUnread(n);
  }, [tasks, profile]);

  function markTasksRead() {
    if (profile?.role === 'ea') localStorage.setItem('desk_notif_read_ea', String(Date.now()));
    setUnread(0);
  }

  // ---------- auth actions ----------
  async function login(email: string, password: string) {
    setLoginBusy(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setLoginBusy(false);
  }
  async function logout() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  if (loading) return <div className="center-loading">Loading The Desk…</div>;
  if (!session || !profile) {
    return <LoginGate onLogin={login} error={authError} busy={loginBusy} needsProfile={!!session && !profile} onLogout={logout} />;
  }

  return (
    <Shell
      role={profile.role}
      tab={tab}
      setTab={(t: Tab) => { setTab(t); if (t === 'tasks') markTasksRead(); }}
      unread={unread}
      onLogout={logout}
      tasks={tasks}
      updates={updates}
      reminders={reminders}
      chat={chat}
      profile={profile}
      toast={toast}
      reload={{ loadTasks, loadReminders, loadChat }}
      toasts={toasts}
      notifPermission={notifPermission}
      requestNotifPermission={requestNotifPermission}
      sendTestNotification={sendTestNotification}
    />
  );
}

// =========================================================
// Login gate
// =========================================================
function LoginGate({ onLogin, error, busy, needsProfile, onLogout }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="gate">
      <div className="welcome-card">
        <span className="pill"><i className="dot" /> The Desk — secure sign in</span>
        <h1>Sign in to your desk.</h1>
        <p className="sub">Director and EA each sign in with their own account. Everything syncs instantly between both.</p>
        {needsProfile ? (
          <>
            <p className="sub" style={{ color: '#ff9aaa' }}>{error}</p>
            <button className="soft-btn" onClick={onLogout}>Sign out</button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label className="field-label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && onLogin(email, password)} />
            </div>
            <div className="error">{error}</div>
            <button className="acid-btn" style={{ width: '100%' }} disabled={busy} onClick={() => onLogin(email, password)}>
              {busy ? 'Signing in…' : 'Sign in →'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// =========================================================
// App shell
// =========================================================
function Shell({ role, tab, setTab, unread, onLogout, tasks, updates, reminders, chat, profile, toast, reload, toasts, notifPermission, requestNotifPermission, sendTestNotification }: any) {
  const navItems =
    role === 'director'
      ? [
          { id: 'overview', label: 'Overview' },
          { id: 'newtask', label: 'Capture' },
          { id: 'tasks', label: 'All Tasks' },
          { id: 'reminders', label: 'Reminders' },
          { id: 'ai', label: 'AI' },
          { id: 'chat', label: 'Chat' },
        ]
      : [
          { id: 'tasks', label: 'My Tasks', badge: true },
          { id: 'reminders', label: 'Reminders' },
          { id: 'ai', label: 'AI' },
          { id: 'chat', label: 'Chat' },
        ];

  const statusLabel = notifPermission === 'granted' ? 'Notifications on' : notifPermission === 'denied' ? 'Notifications blocked' : 'Notifications off';
  const statusColor = notifPermission === 'granted' ? 'var(--mint)' : notifPermission === 'denied' ? 'var(--rose)' : 'var(--amber)';

  return (
    <div>
      <header className="top">
        <div className="brand"><div className="brandmark">D</div> THE DESK / EXECUTION</div>
        <nav className="nav">
          {navItems.map((item: any) => (
            <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
              <span>{item.label}</span>
              {item.badge && unread > 0 && <span className="badge">{unread}</span>}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <span className="pill" style={{ color: statusColor, borderColor: statusColor }} title="This is a per-browser setting — shared across every tab/login using this browser">
            <i className="dot" style={{ background: statusColor, boxShadow: 'none' }} /> {statusLabel}
          </span>
          {notifPermission !== 'granted' && (
            <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={requestNotifPermission}>
              Enable
            </button>
          )}
          {notifPermission === 'granted' && (
            <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={sendTestNotification}>
              Send test
            </button>
          )}
          <span className="live"><i /> {role === 'director' ? 'Managing Director' : 'Executive Assistant'} · {profile.name || profile.id.slice(0, 6)}</span>
          <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <main>
        <section className="section">
          {tab === 'overview' && <Overview tasks={tasks} updates={updates} setTab={setTab} />}
          {tab === 'newtask' && <NewTask toast={toast} reload={reload} />}
          {tab === 'tasks' && <Tasks role={role} tasks={tasks} updates={updates} reload={reload} toast={toast} />}
          {tab === 'reminders' && <Reminders role={role} reminders={reminders} reload={reload} />}
          {tab === 'ai' && <AIPortal role={role} />}
          {tab === 'chat' && <Chat role={role} chat={chat} reload={reload} />}
        </section>
      </main>
      <div className="toast-stack">
        {toasts.map((t: any) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </div>
  );
}

// =========================================================
// Overview
// =========================================================
function Overview({ tasks, updates, setTab }: any) {
  const total = tasks.length;
  const done = tasks.filter((t: Task) => t.status === 'done').length;
  const progress = tasks.filter((t: Task) => t.status === 'progress').length;
  const fresh = tasks.filter((t: Task) => t.status === 'new').length;

  const feed: { ts: number; who: string; text: string }[] = [];
  tasks.forEach((t: Task) => feed.push({ ts: new Date(t.created_at).getTime(), who: 'DIRECTOR', text: `New task assigned — "${t.title}"` }));
  updates.forEach((u: TaskUpdate) => {
    const t = tasks.find((x: Task) => x.id === u.task_id);
    feed.push({ ts: new Date(u.created_at).getTime(), who: u.by_role === 'ea' ? 'EA' : 'DIRECTOR', text: `${t ? t.title : 'Task'} — ${u.text}` });
  });
  feed.sort((a, b) => b.ts - a.ts);

  return (
    <>
      <div className="eyebrow">Command</div>
      <h2>Director's overview.</h2>
      <p className="sub">Everything the EA is executing, live — no need to ask.</p>
      <div className="kpi-strip">
        <div className="kpi"><small>Total tasks</small><strong>{total}</strong><span>All time</span></div>
        <div className="kpi"><small>Awaiting pickup</small><strong style={{ color: 'var(--rose)' }}>{fresh}</strong><span>Needs EA action</span></div>
        <div className="kpi"><small>In progress</small><strong style={{ color: 'var(--amber)' }}>{progress}</strong><span>Being worked on</span></div>
        <div className="kpi"><small>Completed</small><strong style={{ color: 'var(--mint)' }}>{done}</strong><span>Closed out</span></div>
      </div>
      <div className="grid-2">
        <div className="glass card-block">
          <h3>Activity feed</h3>
          <div className="feed">
            {feed.length ? feed.slice(0, 14).map((f, i) => (
              <div className="feed-item" key={i}>
                <div className="f-time">{new Date(f.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                <div className="f-who">{f.who}</div>
                <div className="f-text">{f.text}</div>
              </div>
            )) : <div className="empty">No activity yet. Capture your first task.</div>}
          </div>
        </div>
        <div className="glass card-block">
          <h3>Quick capture</h3>
          <p className="sub" style={{ fontSize: 12, marginBottom: 16 }}>Type or speak — it becomes a task instantly, no AI in between.</p>
          <button className="acid-btn" style={{ width: '100%' }} onClick={() => setTab('newtask')}>Open capture tool →</button>
        </div>
      </div>
    </>
  );
}

// =========================================================
// New task capture (voice/text -> task, direct, no AI)
// =========================================================
function NewTask({ toast, reload }: any) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
      if (final) setText((t) => (t + ' ' + final).trim());
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
  }, []);

  function toggleMic() {
    if (!recRef.current) { toast('Speech recognition is not supported in this browser. Try Chrome.'); return; }
    if (listening) { recRef.current.stop(); setListening(false); }
    else { recRef.current.start(); setListening(true); }
  }

  function deriveTitle(raw: string) {
    const clean = raw.trim().replace(/\s+/g, ' ');
    const words = clean.split(' ');
    return words.length > 10 ? words.slice(0, 10).join(' ') + '…' : clean;
  }

  async function createTask() {
    if (!text.trim()) { toast('Type or speak the instruction first.'); return; }
    if (listening) { recRef.current.stop(); setListening(false); }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('tasks').insert({
      title: deriveTitle(text),
      description: text.trim(),
      priority,
      due_date: dueDate || null,
      status: 'new',
      created_by: userData.user?.id,
    });
    setBusy(false);
    if (error) { toast('Could not save task: ' + error.message); return; }
    setText(''); setPriority('medium'); setDueDate('');
    toast('Task sent to the EA.');
    reload.loadTasks();
  }

  return (
    <>
      <div className="eyebrow">Capture</div>
      <h2>Turn a thought into a task.</h2>
      <p className="sub">Type it or speak it — it goes straight to the EA, instantly.</p>
      <div className="glass hero">
        <div className="capture">
          <button className={'mic-btn' + (listening ? ' live' : '')} onClick={toggleMic} title="Speak">🎙️</button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Prep the board deck by Friday, high priority, and confirm the venue for the offsite..." />
          <button className="acid-btn" disabled={busy} onClick={createTask}>{busy ? 'Sending…' : 'Create task →'}</button>
        </div>
        {listening && <div style={{ fontSize: 11, color: '#8f9ba7', marginTop: 10 }}>Listening…</div>}
        <div className="form-grid" style={{ marginTop: 16, maxWidth: 460 }}>
          <div>
            <label className="field-label">Priority</label>
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as any)}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </div>
          <div>
            <label className="field-label">Due date (optional)</label>
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </div>
    </>
  );
}

// =========================================================
// Tasks list
// =========================================================
function Tasks({ role, tasks, updates, reload, toast }: any) {
  async function setStatus(id: string, status: string) {
    await supabase.from('tasks').update({ status }).eq('id', id);
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text: `Status changed to "${status === 'progress' ? 'In progress' : status}"` });
    reload.loadTasks();
  }
  async function postUpdate(id: string, text: string, wasNew: boolean) {
    if (!text.trim()) return;
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text });
    if (wasNew) await supabase.from('tasks').update({ status: 'progress' }).eq('id', id);
    reload.loadTasks();
    toast('Update posted — Director will see it live.');
  }

  return (
    <>
      <div className="eyebrow">{role === 'ea' ? 'Execute' : 'Oversight'}</div>
      <h2>{role === 'ea' ? 'My tasks.' : 'All tasks.'}</h2>
      <p className="sub">{role === 'ea' ? 'Pick up new work and post updates as you go.' : 'Everything assigned to the EA, with live status.'}</p>
      <div className="task-list" style={{ marginTop: 22 }}>
        {!tasks.length && <div className="empty">No tasks yet.</div>}
        {tasks.map((t: Task) => (
          <TaskCard key={t.id} t={t} role={role} updates={updates.filter((u: TaskUpdate) => u.task_id === t.id)} setStatus={setStatus} postUpdate={postUpdate} />
        ))}
      </div>
    </>
  );
}

function TaskCard({ t, role, updates, setStatus, postUpdate }: any) {
  const [val, setVal] = useState('');
  const statusLabel: any = { new: 'New', progress: 'In progress', done: 'Done' };
  return (
    <div className="work">
      <div className="w-top">
        <div>
          <strong className="w-title">{t.title}</strong>
          <div className="w-desc">{t.description}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
          <span className={'pill status-' + t.status}>{statusLabel[t.status]}</span>
          <span className={'pill prio-' + t.priority}>{t.priority}</span>
        </div>
      </div>
      <div className="w-meta">
        <span className="w-due">{t.due_date ? 'DUE ' + t.due_date : 'NO DUE DATE'}</span>
        <div className="actions-row" style={{ marginLeft: 'auto' }}>
          {role === 'ea' && t.status !== 'done' && (
            <>
              {t.status === 'new' && <button className="tiny-btn" onClick={() => setStatus(t.id, 'progress')}>Start</button>}
              <button className="tiny-btn" onClick={() => setStatus(t.id, 'done')}>Mark done</button>
            </>
          )}
          {role === 'director' && t.status === 'done' && <button className="tiny-btn" onClick={() => setStatus(t.id, 'progress')}>Reopen</button>}
        </div>
      </div>
      <div className="w-updates">
        {updates.length ? updates.map((u: TaskUpdate) => (
          <div className="upd-line" key={u.id}><b>{u.by_role === 'ea' ? 'EA' : 'Director'}:</b> {u.text} <span style={{ color: '#9aa2a9' }}>· {new Date(u.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
        )) : <div className="upd-line" style={{ color: '#9aa2a9' }}>No updates yet.</div>}
        {role === 'ea' && (
          <div className="upd-form">
            <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Post an update on this task..." onKeyDown={(e) => { if (e.key === 'Enter') { postUpdate(t.id, val, t.status === 'new'); setVal(''); } }} />
            <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => { postUpdate(t.id, val, t.status === 'new'); setVal(''); }}>Post</button>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================
// Reminders
// =========================================================
function Reminders({ role, reminders, reload }: any) {
  const [text, setText] = useState('');
  const [freq, setFreq] = useState<'day' | 'week' | 'month'>('day');

  async function add() {
    if (!text.trim()) return;
    await supabase.from('reminders').insert({ owner_role: role, text, freq });
    setText('');
    reload.loadReminders();
  }
  async function del(id: string) {
    await supabase.from('reminders').delete().eq('id', id);
    reload.loadReminders();
  }

  const groups: any = { day: [], week: [], month: [] };
  reminders.forEach((r: Reminder) => groups[r.freq]?.push(r));
  const labels: any = { day: 'Today', week: 'This week', month: 'This month' };

  return (
    <>
      <div className="eyebrow">Reminders</div>
      <h2>Keep yourself on track.</h2>
      <p className="sub">Personal reminders — visible only on your desk.</p>
      <div className="glass hero" style={{ padding: 24 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Remind me to..." onKeyDown={(e) => e.key === 'Enter' && add()} />
          <select className="select" value={freq} onChange={(e) => setFreq(e.target.value as any)} style={{ maxWidth: 150 }}>
            <option value="day">Today</option><option value="week">This week</option><option value="month">This month</option>
          </select>
          <button className="acid-btn" style={{ flexShrink: 0 }} onClick={add}>Add</button>
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        {!reminders.length && <div className="empty">No reminders yet.</div>}
        {['day', 'week', 'month'].map((f) => groups[f].length ? (
          <div className="rem-group" key={f}>
            <h4>{labels[f]}</h4>
            {groups[f].map((r: Reminder) => (
              <div className="rem-item" key={r.id}><span>{r.text}</span><button onClick={() => del(r.id)}>✕</button></div>
            ))}
          </div>
        ) : null)}
      </div>
    </>
  );
}

// =========================================================
// AI Portal
// =========================================================
function AIPortal({ role }: any) {
  const [history, setHistory] = useState<{ role: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text) return;
    const next = [...history, { role: 'user', text }];
    setHistory(next);
    setInput('');
    setHistory((h) => [...h, { role: 'assistant', text: '…thinking' }]);
    try {
      const resp = await fetch('/api/ai-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, role, history: next }) });
      const data = await resp.json();
      setHistory((h) => [...h.slice(0, -1), { role: 'assistant', text: data.reply || 'Sorry, no reply.' }]);
    } catch {
      setHistory((h) => [...h.slice(0, -1), { role: 'assistant', text: 'Sorry, I could not reach the AI just now.' }]);
    }
  }

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [history]);

  return (
    <>
      <div className="eyebrow">AI</div>
      <h2>Ask the AI portal.</h2>
      <p className="sub">Drafting, planning, summarizing, thinking things through.</p>
      <div className="glass chat-shell" style={{ marginTop: 20 }}>
        <div className="chat-list" ref={logRef}>
          {!history.length && <div className="empty">Ask something to get started.</div>}
          {history.map((m, i) => <div key={i} className={'bubble ' + (m.role === 'user' ? 'user' : 'ai')}>{m.text}</div>)}
        </div>
        <div className="chat-compose">
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the AI anything..." onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="acid-btn" onClick={send}>Send</button>
        </div>
      </div>
    </>
  );
}

// =========================================================
// Director <-> EA chat
// =========================================================
function Chat({ role, chat, reload }: any) {
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text) return;
    await supabase.from('chat_messages').insert({ from_role: role, text });
    setInput('');
    reload.loadChat();
  }
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [chat]);

  return (
    <>
      <div className="eyebrow">Direct line</div>
      <h2>{role === 'director' ? 'Chat with EA.' : 'Chat with Director.'}</h2>
      <p className="sub">Straight talk between both desks.</p>
      <div className="glass chat-shell" style={{ marginTop: 20 }}>
        <div className="chat-list" ref={logRef}>
          {!chat.length && <div className="empty">No messages yet — say hello.</div>}
          {chat.map((m: ChatMessage) => (
            <div key={m.id} className={'bubble ' + (m.from_role === role ? 'user' : 'ai')}>
              {m.text}
              <small>{m.from_role === 'director' ? 'Director' : 'EA'} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
          ))}
        </div>
        <div className="chat-compose">
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message..." onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="acid-btn" onClick={send}>Send</button>
        </div>
      </div>
    </>
  );
}
