'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Role = 'director' | 'ea';
type Category = 'Tasks' | 'Operations' | 'Development' | 'Cost Improvement';
const CATEGORIES: Category[] = ['Tasks', 'Operations', 'Development', 'Cost Improvement'];
type Stage = 'captured' | 'progress' | 'followup' | 'update' | 'closure' | 'completed';
const STAGES: Stage[] = ['captured', 'progress', 'followup', 'update', 'closure', 'completed'];
const STAGE_LABELS: Record<Stage, string> = { captured: 'Captured', progress: 'In Progress', followup: 'Follow-up', update: 'Update', closure: 'Closure', completed: 'Completed' };
type Task = {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  priority: 'low' | 'medium' | 'high' | 'critical';
  due_date: string | null;
  reminder_at: string | null;
  status: Stage;
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
      setTab('overview');
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

  // per-task reminders: fire a real notification the moment a reminder time arrives
  const firedReminders = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!profile) return;
    const check = () => {
      const now = Date.now();
      tasks.forEach((t) => {
        if (!t.reminder_at) return;
        const due = new Date(t.reminder_at).getTime();
        if (due <= now && due > now - 5 * 60 * 1000 && !firedReminders.current.has(t.id + t.reminder_at)) {
          firedReminders.current.add(t.id + t.reminder_at);
          pushNotify('⏰ Reminder', t.title);
        }
      });
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          { id: 'overview', label: 'Dashboard', ic: '◈' },
          { id: 'newtask', label: 'Capture', ic: '✎' },
          { id: 'tasks', label: 'All Tasks', ic: '☰' },
          { id: 'reminders', label: 'Reminders', ic: '◷' },
          { id: 'ai', label: 'AI', ic: '✦' },
          { id: 'chat', label: 'Chat', ic: '✉' },
        ]
      : [
          { id: 'overview', label: 'Dashboard', ic: '◈' },
          { id: 'tasks', label: 'My Tasks', ic: '☰', badge: true },
          { id: 'reminders', label: 'Reminders', ic: '◷' },
          { id: 'ai', label: 'AI', ic: '✦' },
          { id: 'chat', label: 'Chat', ic: '✉' },
        ];

  const statusLabel = notifPermission === 'granted' ? 'Notifications on' : notifPermission === 'denied' ? 'Notifications blocked' : 'Notifications off';
  const statusColor = notifPermission === 'granted' ? 'var(--mint)' : notifPermission === 'denied' ? 'var(--rose)' : 'var(--amber)';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandmark">D</div> THE DESK</div>
        <nav className="nav">
          {navItems.map((item: any) => (
            <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
              <span>{item.ic}</span><span>{item.label}</span>
              {item.badge && unread > 0 && <span className="badge">{unread}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="pill" style={{ color: statusColor, borderColor: statusColor }} title="This is a per-browser setting — shared across every tab/login using this browser">
            <i className="dot" style={{ background: statusColor, boxShadow: 'none' }} /> {statusLabel}
          </span>
          <div className="top-actions">
            {notifPermission !== 'granted' && (
              <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={requestNotifPermission}>Enable notifications</button>
            )}
            {notifPermission === 'granted' && (
              <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={sendTestNotification}>Send test</button>
            )}
          </div>
          <span className="live"><i /> {role === 'director' ? 'Managing Director' : 'Executive Assistant'} · {profile.name || profile.id.slice(0, 6)}</span>
          <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <div className="main-content">
        <main>
          <section className="section">
            {tab === 'overview' && <Dashboard role={role} tasks={tasks} updates={updates} setTab={setTab} unread={unread} />}
            {tab === 'newtask' && <NewTask toast={toast} reload={reload} />}
            {tab === 'tasks' && <Tasks role={role} tasks={tasks} updates={updates} reload={reload} toast={toast} />}
            {tab === 'reminders' && <Reminders role={role} reminders={reminders} reload={reload} />}
            {tab === 'ai' && <AIPortal role={role} />}
            {tab === 'chat' && <Chat role={role} chat={chat} reload={reload} />}
          </section>
        </main>
      </div>
      <div className="toast-stack">
        {toasts.map((t: any) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </div>
  );
}

// =========================================================
// Ring stat (circular progress) — small reusable SVG component
// =========================================================
function Ring({ value, total, color, label, sub, onClick }: any) {
  const size = 104, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const offset = c * (1 - pct);
  return (
    <div className={'ring-card' + (onClick ? ' clickable' : '')} onClick={onClick}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize="26" fontWeight="800" fill="#fff">{value}</text>
      </svg>
      <div className="ring-label">{label}</div>
      {sub && <div className="ring-sub">{sub}</div>}
    </div>
  );
}

// =========================================================
// Dashboard — shared landing page for both Director and EA
// =========================================================
function Dashboard({ role, tasks, updates, setTab, unread }: any) {
  const total = tasks.length;
  const done = tasks.filter((t: Task) => t.status === 'completed').length;
  const progress = tasks.filter((t: Task) => !['captured', 'completed'].includes(t.status)).length;
  const fresh = tasks.filter((t: Task) => t.status === 'captured').length;
  const critical = tasks.filter((t: Task) => t.priority === 'critical' && t.status !== 'completed').length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter((t: Task) => t.due_date && t.due_date < today && t.status !== 'completed').length;
  const dueToday = tasks.filter((t: Task) => t.due_date === today && t.status !== 'completed').length;

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
      <h2>{role === 'director' ? "Director's dashboard." : 'Your dashboard.'}</h2>
      <p className="sub">{role === 'director' ? 'Everything the EA is executing, live — no need to ask.' : 'Everything on your plate, at a glance.'}</p>

      <div className="ring-strip">
        <Ring value={total} total={total || 1} color="var(--blue)" label="Total tasks" sub="All time" />
        <Ring value={fresh} total={total || 1} color="var(--rose)" label="Not picked up" sub="Needs action" onClick={() => setTab('tasks')} />
        <Ring value={progress} total={total || 1} color="var(--amber)" label="In progress" sub="Being worked on" onClick={() => setTab('tasks')} />
        <Ring value={critical} total={total || 1} color="#ff2d55" label="Critical" sub="Needs urgent attention" onClick={() => setTab('tasks')} />
        <Ring value={done} total={total || 1} color="var(--mint)" label="Completed" sub="Closed out" onClick={() => setTab('tasks')} />
      </div>

      {(overdue > 0 || critical > 0 || dueToday > 0) && (
        <div className="glass card-block alert-box" style={{ marginBottom: 20 }}>
          <div className="alert-num">{overdue}</div>
          <div className="alert-breakdown">
            <div><span className="pill status-captured">{overdue} overdue</span></div>
            <div><span className="pill prio-critical">{critical} critical</span></div>
            <div><span className="pill status-progress">{dueToday} due today</span></div>
          </div>
          <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff', marginLeft: 'auto' }} onClick={() => setTab('tasks')}>Review →</button>
        </div>
      )}

      <div className="category-strip">
        {CATEGORIES.map((c: Category, i: number) => {
          const count = tasks.filter((t: Task) => (t.category || 'Tasks') === c && t.status !== 'completed').length;
          return (
            <button key={c} className="category-card" onClick={() => setTab('tasks')}>
              <span className="cc-index">{String(i + 1).padStart(2, '0')} / CORE</span>
              <span className="cc-name">{c}</span>
              <span className="cc-count">{count} open</span>
            </button>
          );
        })}
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
            )) : <div className="empty">No activity yet.</div>}
          </div>
        </div>
        <div className="glass card-block">
          {role === 'director' ? (
            <>
              <h3>Quick capture</h3>
              <p className="sub" style={{ fontSize: 12, marginBottom: 16 }}>Type or speak — it becomes a task instantly, no AI in between.</p>
              <button className="acid-btn" style={{ width: '100%' }} onClick={() => setTab('newtask')}>Open capture tool →</button>
            </>
          ) : (
            <>
              <h3>Ready to work</h3>
              <p className="sub" style={{ fontSize: 12, marginBottom: 16 }}>
                {unread > 0 ? `${unread} new task${unread > 1 ? 's' : ''} waiting for you.` : 'All caught up — nothing new right now.'}
              </p>
              <button className="acid-btn" style={{ width: '100%' }} onClick={() => setTab('tasks')}>Open my tasks →</button>
            </>
          )}
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
  const [category, setCategory] = useState<Category>('Tasks');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
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
      category,
      priority,
      due_date: dueDate || null,
      status: 'captured',
      created_by: userData.user?.id,
    });
    setBusy(false);
    if (error) { toast('Could not save task: ' + error.message); return; }
    setText(''); setCategory('Tasks'); setPriority('medium'); setDueDate('');
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

        <div style={{ marginTop: 18 }}>
          <label className="field-label">Category</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={category === c ? 'acid-btn' : 'soft-btn'}
                style={{ padding: '8px 14px', fontSize: 11.5 }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 16, maxWidth: 460 }}>
          <div>
            <label className="field-label">Priority</label>
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as any)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
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
// Tasks — kanban pipeline (Captured -> Progress -> Follow-up -> Update -> Closure -> Completed)
// =========================================================
function Tasks({ role, tasks, updates, reload, toast }: any) {
  async function moveStage(id: string, dir: 1 | -1) {
    const t = tasks.find((x: Task) => x.id === id);
    if (!t) return;
    const idx = STAGES.indexOf(t.status);
    const next = STAGES[idx + dir];
    if (!next) return;
    await supabase.from('tasks').update({ status: next }).eq('id', id);
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text: `Moved to "${STAGE_LABELS[next]}"` });
    reload.loadTasks();
  }
  async function moveToStage(id: string, targetStage: Stage) {
    const t = tasks.find((x: Task) => x.id === id);
    if (!t || t.status === targetStage) return;
    await supabase.from('tasks').update({ status: targetStage }).eq('id', id);
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text: `Moved to "${STAGE_LABELS[targetStage]}"` });
    reload.loadTasks();
  }
  async function postUpdate(id: string, text: string) {
    if (!text.trim()) return;
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text });
    const t = tasks.find((x: Task) => x.id === id);
    if (t && t.status === 'captured') await supabase.from('tasks').update({ status: 'progress' }).eq('id', id);
    reload.loadTasks();
    toast('Update posted — Director will see it live.');
  }
  async function setReminder(id: string, when: string | null) {
    await supabase.from('tasks').update({ reminder_at: when }).eq('id', id);
    reload.loadTasks();
    toast(when ? 'Reminder set for this task.' : 'Reminder removed.');
  }

  return (
    <>
      <div className="eyebrow">{role === 'ea' ? 'Execute' : 'Oversight'}</div>
      <h2>{role === 'ea' ? 'Live execution pipeline.' : "Director's pipeline view."}</h2>
      <p className="sub">{role === 'ea' ? 'Drag a card to move it — or use the buttons. Set reminders on anything time-sensitive.' : 'Everything the EA is executing, stage by stage.'}</p>

      <div className="pipeline-board" style={{ marginTop: 22 }}>
        {STAGES.map((stage) => {
          const stageTasks = tasks.filter((t: Task) => t.status === stage);
          return (
            <div
              className="pipeline-col"
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) moveToStage(id, stage);
              }}
            >
              <div className="pipeline-col-head">
                <span>{STAGE_LABELS[stage]}</span>
                <span className="pipeline-count">{stageTasks.length}</span>
              </div>
              <div className="pipeline-col-body">
                {stageTasks.length === 0 && <div className="empty" style={{ padding: 16, fontSize: 11 }}>Drop a card here</div>}
                {stageTasks.map((t: Task) => (
                  <TaskCard
                    key={t.id}
                    t={t}
                    role={role}
                    stage={stage}
                    updates={updates.filter((u: TaskUpdate) => u.task_id === t.id)}
                    moveStage={moveStage}
                    postUpdate={postUpdate}
                    setReminder={setReminder}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TaskCard({ t, role, stage, updates, moveStage, postUpdate, setReminder }: any) {
  const [val, setVal] = useState('');
  const [showUpdates, setShowUpdates] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [remVal, setRemVal] = useState(t.reminder_at ? t.reminder_at.slice(0, 16) : '');
  const idx = STAGES.indexOf(stage);
  const canGoBack = idx > 0;
  const canAdvance = idx < STAGES.length - 1;
  const isCritical = t.priority === 'critical' && t.status !== 'completed';

  return (
    <div
      className={'work' + (isCritical ? ' work-critical' : '')}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="pill cat-pill">{t.category || 'Tasks'}</span>
        <span className={'pill prio-' + t.priority}>{t.priority}</span>
      </div>
      <strong className="w-title">{t.title}</strong>
      <div className="w-desc">{t.description}</div>
      <div className="w-meta" style={{ marginTop: 8 }}>
        <span className="w-due">{t.due_date ? 'DUE ' + t.due_date : 'NO DUE DATE'}</span>
      </div>

      {t.reminder_at && (
        <div className="reminder-badge" onClick={() => setShowReminder((s) => !s)}>
          ⏰ {new Date(t.reminder_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      <div className="actions-row" style={{ marginTop: 10 }}>
        {canGoBack && <button className="tiny-btn" onClick={() => moveStage(t.id, -1)}>← Back</button>}
        {canAdvance && <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => moveStage(t.id, 1)}>Advance →</button>}
        <button className="tiny-btn" onClick={() => setShowReminder((s) => !s)}>⏰ Remind</button>
        <button className="tiny-btn" onClick={() => setShowUpdates((s) => !s)}>💬 {updates.length}</button>
      </div>

      {showReminder && (
        <div className="reminder-form">
          <label style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, color: '#5b656e', display: 'block', marginBottom: 6 }}>
            Remind at
          </label>
          <input
            type="datetime-local"
            className="reminder-input"
            value={remVal}
            onChange={(e) => setRemVal(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => { setReminder(t.id, remVal ? new Date(remVal).toISOString() : null); setShowReminder(false); }}>Save</button>
            {t.reminder_at && <button className="tiny-btn" onClick={() => { setReminder(t.id, null); setRemVal(''); setShowReminder(false); }}>Clear</button>}
          </div>
        </div>
      )}

      {showUpdates && (
        <div className="w-updates">
          {updates.length ? updates.map((u: TaskUpdate) => (
            <div className="upd-line" key={u.id}><b>{u.by_role === 'ea' ? 'EA' : 'Director'}:</b> {u.text} <span style={{ color: '#9aa2a9' }}>· {new Date(u.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
          )) : <div className="upd-line" style={{ color: '#9aa2a9' }}>No updates yet.</div>}
          <div className="upd-form">
            <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Post an update..." onKeyDown={(e) => { if (e.key === 'Enter') { postUpdate(t.id, val); setVal(''); } }} />
            <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => { postUpdate(t.id, val); setVal(''); }}>Post</button>
          </div>
        </div>
      )}
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
      const replyText = data.reply || (data.error ? `⚠️ ${data.error}` : 'Sorry, no reply.');
      setHistory((h) => [...h.slice(0, -1), { role: 'assistant', text: replyText }]);
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
