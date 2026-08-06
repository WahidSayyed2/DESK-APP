'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Role = 'director' | 'ea';
type AppRole = 'director' | 'ea' | 'admin';
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
type ChatMessage = { id: string; from_role: Role; text: string; created_at: string; attachment_url?: string | null; attachment_name?: string | null };
type Notif = { id: string; recipient_role: Role; text: string; task_id: string | null; seen: boolean; created_at: string };
type Profile = { id: string; role: AppRole; name: string };

type Tab = 'overview' | 'newtask' | 'tasks' | 'reminders' | 'ai' | 'chat' | 'attendance' | 'wishlist' | 'expense';
type AttendanceRow = { id: string; role: Role; punch_in: string; punch_out: string | null; created_at: string };
type WishlistItem = { id: string; text: string; added_by: Role; done: boolean; created_at: string };
type Expense = { id: string; uploaded_by: Role; description: string | null; amount: number; receipt_url: string | null; receipt_name: string | null; expense_date: string; created_at: string };
type CostTicketOption = { id: string; ticket_id: string; vendor_name: string; rate: number; created_at: string };
type CostTicket = { id: string; item_name: string; quantity: number; existing_vendor: string | null; existing_rate: number; selected_option_id: string | null; created_by: Role; created_at: string; options: CostTicketOption[] };

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authError, setAuthError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem('desk_theme')) as 'dark' | 'light' | null;
    const initial = saved || 'dark';
    setTheme(initial);
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', initial);
  }, []);
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('desk_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  }

  const [tab, setTab] = useState<Tab>('overview');
  const [taskFocus, setTaskFocus] = useState<{ kind: 'ring' | 'single'; key?: string; label?: string; id?: string } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [costTickets, setCostTickets] = useState<CostTicket[]>([]);
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

  // audible alarm — three ascending beeps, no external audio file needed
  function playAlarm() {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const beep = (time: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.35, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + 0.4);
      };
      const now = ctx.currentTime;
      beep(now, 740);
      beep(now + 0.45, 880);
      beep(now + 0.9, 1046);
    } catch (e) { /* audio not available, ignore */ }
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

  // prominent on-screen alert that stays until dismissed — for reminders specifically
  const [reminderAlerts, setReminderAlerts] = useState<{ id: string; title: string; taskId: string }[]>([]);
  function fireReminderAlert(taskId: string, title: string) {
    playAlarm();
    pushNotify('⏰ Reminder', title);
    setReminderAlerts((a) => [...a, { id: taskId + Date.now(), title, taskId }]);
  }
  function dismissReminderAlert(id: string) {
    setReminderAlerts((a) => a.filter((r) => r.id !== id));
  }
  async function snoozeReminder(alertId: string, taskId: string, minutes: number) {
    const when = new Date(Date.now() + minutes * 60000).toISOString();
    await supabase.from('tasks').update({ reminder_at: when }).eq('id', taskId);
    dismissReminderAlert(alertId);
    toast(`Snoozed — will remind again in ${minutes} min.`);
    loadTasks();
  }

  function sendTestNotification() {
    if (typeof window === 'undefined' || !('Notification' in window)) { toast('This browser does not support notifications.'); return; }
    if (Notification.permission !== 'granted') { toast('Click "Enable notifications" first.'); return; }
    try {
      playAlarm();
      new Notification('🔔 Test notification', { body: 'If you see this pop up from your OS (not just this toast), notifications are fully working.' });
      toast('Test sent — check for an OS-level popup and an alarm sound.');
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
  const prevNotifCount = useRef<number | null>(null);
  async function loadNotifs() {
    if (!profile) return;
    const { data, error } = await supabase.from('notifications').select('*').eq('recipient_role', profile.role).order('created_at', { ascending: false });
    if (error) { console.error('loadNotifs failed:', error.message); return; }
    if (data) {
      const unseenNow = data.filter((n: any) => !n.seen).length;
      if (prevNotifCount.current !== null && unseenNow > prevNotifCount.current) {
        const newest = data.find((n: any) => !n.seen);
        if (newest) pushNotify('🔔 ' + newest.text, '');
      }
      prevNotifCount.current = unseenNow;
      setNotifs(data as Notif[]);
    }
  }
  async function notifyRole(recipientRole: Role, text: string, taskId: string | null = null) {
    const { error } = await supabase.from('notifications').insert({ recipient_role: recipientRole, text, task_id: taskId });
    if (error) {
      toast('⚠️ Notification not saved: ' + error.message + ' — has the notifications migration been run in Supabase?');
      console.error('notifyRole failed:', error.message);
    } else {
      loadNotifs();
    }
  }
  async function markNotifSeen(id: string) {
    await supabase.from('notifications').update({ seen: true }).eq('id', id);
    loadNotifs();
  }
  async function markAllNotifsSeen() {
    if (!profile) return;
    await supabase.from('notifications').update({ seen: true }).eq('recipient_role', profile.role).eq('seen', false);
    loadNotifs();
  }
  async function deleteNotif(id: string) {
    await supabase.from('notifications').delete().eq('id', id);
    loadNotifs();
  }

  async function loadAttendance() {
    const { data, error } = await supabase.from('attendance').select('*').order('punch_in', { ascending: false });
    if (error) { console.error('loadAttendance failed:', error.message); return; }
    if (data) {
      setAttendance(data as AttendanceRow[]);
      // auto-close any session left open from a previous day — a punch-in
      // should never be punched out on a different calendar day
      const todayStr = new Date().toISOString().slice(0, 10);
      const stale = (data as AttendanceRow[]).filter((a) => !a.punch_out && a.punch_in.slice(0, 10) < todayStr);
      for (const s of stale) {
        const endOfDay = s.punch_in.slice(0, 10) + 'T23:59:59.000Z';
        await supabase.from('attendance').update({ punch_out: endOfDay }).eq('id', s.id);
      }
      if (stale.length) {
        const { data: fresh } = await supabase.from('attendance').select('*').order('punch_in', { ascending: false });
        if (fresh) setAttendance(fresh as AttendanceRow[]);
      }
    }
  }
  async function punchIn() {
    if (!profile) return;
    const { error } = await supabase.from('attendance').insert({ role: profile.role, punch_in: new Date().toISOString() });
    if (error) { toast('⚠️ Punch in failed: ' + error.message); return; }
    toast('Punched in.');
    loadAttendance();
  }
  async function punchOut(id: string) {
    const rec = attendance.find((a) => a.id === id);
    const todayStr = new Date().toISOString().slice(0, 10);
    if (rec && rec.punch_in.slice(0, 10) !== todayStr) {
      toast("That punch-in was from a previous day and has been auto-closed at midnight. Punch in fresh for today.");
      loadAttendance();
      return;
    }
    const { error } = await supabase.from('attendance').update({ punch_out: new Date().toISOString() }).eq('id', id);
    if (error) { toast('⚠️ Punch out failed: ' + error.message); return; }
    toast('Punched out.');
    loadAttendance();
  }

  async function loadWishlist() {
    const { data, error } = await supabase.from('wishlist_items').select('*').order('created_at', { ascending: false });
    if (error) { console.error('loadWishlist failed:', error.message); return; }
    if (data) setWishlist(data as WishlistItem[]);
  }
  async function addWishlistItem(text: string) {
    if (!profile || !text.trim()) return;
    const { error } = await supabase.from('wishlist_items').insert({ text: text.trim(), added_by: profile.role });
    if (error) { toast('⚠️ Could not add: ' + error.message); return; }
    loadWishlist();
  }
  async function toggleWishlistItem(id: string, done: boolean) {
    await supabase.from('wishlist_items').update({ done }).eq('id', id);
    loadWishlist();
  }
  async function deleteWishlistItem(id: string) {
    await supabase.from('wishlist_items').delete().eq('id', id);
    loadWishlist();
  }

  async function loadExpenses() {
    const { data, error } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false });
    if (error) { console.error('loadExpenses failed:', error.message); return; }
    if (data) setExpenses(data as Expense[]);
  }
  async function addExpense(payload: { description: string; amount: number; expense_date: string; receipt_url: string | null; receipt_name: string | null }) {
    if (!profile) return;
    const { error } = await supabase.from('expenses').insert({ ...payload, uploaded_by: profile.role });
    if (error) { toast('⚠️ Could not save expense: ' + error.message); return; }
    toast('Expense logged.');
    loadExpenses();
  }
  async function deleteExpense(id: string) {
    await supabase.from('expenses').delete().eq('id', id);
    loadExpenses();
  }

  async function loadCostTickets() {
    const { data: tickets, error } = await supabase.from('cost_tickets').select('*').order('created_at', { ascending: false });
    if (error) { console.error('loadCostTickets failed:', error.message); return; }
    const { data: options, error: optErr } = await supabase.from('cost_ticket_options').select('*').order('created_at', { ascending: true });
    if (optErr) { console.error('loadCostTickets options failed:', optErr.message); return; }
    if (tickets) {
      const merged = (tickets as any[]).map((t) => ({
        ...t,
        options: (options || []).filter((o: any) => o.ticket_id === t.id),
      }));
      setCostTickets(merged as CostTicket[]);
    }
  }
  async function addCostTicket(payload: { item_name: string; quantity: number; existing_vendor: string; existing_rate: number }) {
    if (!profile) return;
    const { error } = await supabase.from('cost_tickets').insert({ ...payload, created_by: profile.role });
    if (error) { toast('⚠️ Could not create ticket: ' + error.message); return; }
    toast('Comparison ticket created.');
    loadCostTickets();
  }
  async function addTicketOption(ticketId: string, vendorName: string, rate: number) {
    const { error } = await supabase.from('cost_ticket_options').insert({ ticket_id: ticketId, vendor_name: vendorName, rate });
    if (error) { toast('⚠️ Could not add vendor option: ' + error.message); return; }
    loadCostTickets();
  }
  async function selectFinalVendor(ticketId: string, optionId: string) {
    const { error } = await supabase.from('cost_tickets').update({ selected_option_id: optionId }).eq('id', ticketId);
    if (error) { toast('⚠️ Could not select vendor: ' + error.message); return; }
    toast('Final vendor selected — savings recorded.');
    loadCostTickets();
  }
  async function deleteCostTicket(id: string) {
    await supabase.from('cost_tickets').delete().eq('id', id);
    loadCostTickets();
  }

  useEffect(() => {
    if (!profile) return;
    loadTasks();
    loadReminders();
    loadChat();
    loadNotifs();
    loadAttendance();
    loadWishlist();
    loadExpenses();
    loadCostTickets();
    const lastRead = Number(localStorage.getItem('desk_notif_read_' + profile.role) || 0);

    const channel = supabase
      .channel('desk-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadTasks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_updates' }, () => loadTasks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => loadChat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, () => loadReminders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => loadNotifs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => loadAttendance())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist_items' }, () => loadWishlist())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => loadExpenses())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cost_tickets' }, () => loadCostTickets())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cost_ticket_options' }, () => loadCostTickets())
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
          fireReminderAlert(t.id, t.title);
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
  async function loginWithGoogle() {
    setAuthError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    if (error) setAuthError(error.message);
  }
  async function logout() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  if (loading) return <div className="center-loading">Loading The Desk…</div>;
  if (!session || !profile) {
    return <LoginGate onLogin={login} onLoginGoogle={loginWithGoogle} error={authError} busy={loginBusy} needsProfile={!!session && !profile} onLogout={logout} theme={theme} toggleTheme={toggleTheme} />;
  }

  if (profile.role === 'admin') {
    return <AdminPanel profile={profile} onLogout={logout} theme={theme} toggleTheme={toggleTheme} toast={toast} toasts={toasts} />;
  }

  return (
    <>
      <Shell
        role={profile.role as Role}
        tab={tab}
        setTab={(t: Tab) => { setTab(t); if (t === 'tasks') markTasksRead(); if (t !== 'tasks') setTaskFocus(null); }}
        goToTasks={(focus: any) => { setTab('tasks'); setTaskFocus(focus || null); markTasksRead(); }}
        taskFocus={taskFocus}
        setTaskFocus={setTaskFocus}
        unread={unread}
        onLogout={logout}
        tasks={tasks}
        updates={updates}
        reminders={reminders}
        chat={chat}
        notifs={notifs}
        markNotifSeen={markNotifSeen}
        deleteNotif={deleteNotif}
        markAllNotifsSeen={markAllNotifsSeen}
        notifyRole={notifyRole}
        attendance={attendance}
        punchIn={punchIn}
        punchOut={punchOut}
        wishlist={wishlist}
        addWishlistItem={addWishlistItem}
        toggleWishlistItem={toggleWishlistItem}
        deleteWishlistItem={deleteWishlistItem}
        expenses={expenses}
        addExpense={addExpense}
        deleteExpense={deleteExpense}
        costTickets={costTickets}
        addCostTicket={addCostTicket}
        addTicketOption={addTicketOption}
        selectFinalVendor={selectFinalVendor}
        deleteCostTicket={deleteCostTicket}
        profile={profile}
        toast={toast}
        reload={{ loadTasks, loadReminders, loadChat, loadNotifs }}
        toasts={toasts}
        notifPermission={notifPermission}
        requestNotifPermission={requestNotifPermission}
        theme={theme}
        toggleTheme={toggleTheme}
      />
      {reminderAlerts.length > 0 && (
        <div className="reminder-alert-stack">
          {reminderAlerts.map((r) => (
            <ReminderAlertCard
              key={r.id}
              alert={r}
              onView={() => { setTab('tasks'); setTaskFocus({ kind: 'single', id: r.taskId }); dismissReminderAlert(r.id); }}
              onDismiss={() => dismissReminderAlert(r.id)}
              onSnooze={(minutes: number) => snoozeReminder(r.id, r.taskId, minutes)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// =========================================================
// Login gate
// =========================================================
// =========================================================
// Reminder alert card — with a snooze picker (5/10/15/30 min)
// =========================================================
function ReminderAlertCard({ alert, onView, onDismiss, onSnooze }: any) {
  const [showSnooze, setShowSnooze] = useState(false);
  return (
    <div className="reminder-alert">
      <div className="reminder-alert-icon">⏰</div>
      <div className="reminder-alert-body">
        <div className="reminder-alert-title">Reminder</div>
        <div className="reminder-alert-text">{alert.title}</div>
        {showSnooze && (
          <div className="snooze-row">
            {[5, 10, 15, 30].map((m) => (
              <button key={m} className="tiny-btn" onClick={() => onSnooze(m)}>{m}m</button>
            ))}
          </div>
        )}
      </div>
      <div className="reminder-alert-actions">
        <button className="acid-btn" onClick={onView}>View task</button>
        <button className="soft-btn" onClick={() => setShowSnooze((s) => !s)}>Snooze</button>
        <button className="soft-btn" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function LoginGate({ onLogin, onLoginGoogle, error, busy, needsProfile, onLogout, theme, toggleTheme }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="gate">
      <button className="theme-toggle" onClick={toggleTheme} style={{ position: 'absolute', top: 24, right: 24, width: 'auto', padding: '9px 15px' }}>
        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
      </button>
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
            <button className="google-btn" onClick={onLoginGoogle} style={{ marginBottom: 18 }}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92a8.8 8.8 0 0 0 2.68-6.61z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.95a9 9 0 0 0 0 8.08l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.96l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
              Sign in with Google
            </button>
            <div className="or-divider"><span>or continue with email</span></div>
            <div style={{ marginBottom: 12, marginTop: 18 }}>
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
// Super Admin — full backend visibility and data management
// =========================================================
const ADMIN_TABLES = [
  { key: 'tasks', label: 'Tasks', note: 'Also clears their updates and linked notifications automatically.' },
  { key: 'chat_messages', label: 'Chat messages', note: 'Director \u2194 EA direct chat history.' },
  { key: 'attendance', label: 'Attendance', note: 'All punch in/out records.' },
  { key: 'expenses', label: 'Expenses', note: 'Logged invoices/bills (does not delete uploaded files in storage).' },
  { key: 'cost_tickets', label: 'Cost improvement tickets', note: 'Also clears their vendor quote options automatically.' },
  { key: 'wishlist_items', label: 'Wishlist items', note: 'Shared wishlist entries.' },
  { key: 'reminders', label: 'Reminders', note: 'Personal reminders for both desks.' },
  { key: 'notifications', label: 'Notifications', note: 'Bell notification history for both desks.' },
];

function AdminPanel({ profile, onLogout, theme, toggleTheme, toast, toasts }: any) {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'director' | 'ea' | 'admin'>('ea');
  const [creating, setCreating] = useState(false);

  async function loadAll() {
    setLoadingCounts(true);
    const next: Record<string, number | null> = {};
    for (const t of ADMIN_TABLES) {
      const { count, error } = await supabase.from(t.key).select('*', { count: 'exact', head: true });
      next[t.key] = error ? null : (count ?? 0);
    }
    setCounts(next);
    const { data: profs } = await supabase.from('profiles').select('*').order('role', { ascending: true });
    setProfiles(profs || []);
    setLoadingCounts(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function createUser() {
    if (!newEmail.trim() || !newPassword) { toast('Enter an email and password.'); return; }
    if (newPassword.length < 6) { toast('Password needs to be at least 6 characters.'); return; }
    setCreating(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const resp = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail.trim(), password: newPassword, name: newName.trim(), role: newRole, accessToken }),
    });
    const data = await resp.json();
    setCreating(false);
    if (!resp.ok || data.error) { toast('⚠️ ' + (data.error || 'Could not create the account.')); return; }
    toast(`Account created for ${newEmail} as ${newRole}.`);
    setNewName(''); setNewEmail(''); setNewPassword(''); setNewRole('ea');
    loadAll();
  }

  async function clearTable(key: string) {
    setBusyKey(key);
    const { error } = await supabase.from(key).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setBusyKey(null);
    setConfirmKey(null);
    setConfirmText('');
    if (error) { toast('⚠️ Failed to clear: ' + error.message); return; }
    toast(`Cleared all rows in "${key}".`);
    loadAll();
  }

  const confirmTable = ADMIN_TABLES.find((t) => t.key === confirmKey);

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div className="brand"><div className="brandmark">A</div> SUPER ADMIN</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="theme-toggle" onClick={toggleTheme} style={{ width: 'auto', padding: '9px 15px' }}>
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <span className="live"><i /> {profile.name || 'Admin'}</span>
          <button className="soft-btn" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <section className="section" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div className="eyebrow">Full backend access</div>
        <h2>Everything, in one place.</h2>
        <p className="sub">Live row counts across every table. Clearing data here is permanent — each action requires typing the table name to confirm.</p>

        <div className="glass hero" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 6 }}>Create a new login</h3>
          <p className="sub" style={{ fontSize: 12, marginBottom: 18 }}>
            Add as many Directors and EAs as you need — each gets their own real email/password login and role, no need to touch Supabase directly.
          </p>
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div>
              <label className="field-label">Full name</label>
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Priya Shah" />
            </div>
            <div>
              <label className="field-label">Role</label>
              <select className="select" value={newRole} onChange={(e) => setNewRole(e.target.value as any)}>
                <option value="director">Director</option>
                <option value="ea">Executive Assistant</option>
                <option value="admin">Super Admin</option>
              </select>
            </div>
            <div>
              <label className="field-label">Email</label>
              <input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@company.com" />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input className="input" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" />
            </div>
          </div>
          <button className="acid-btn" disabled={creating} onClick={createUser}>
            {creating ? 'Creating…' : 'Create login →'}
          </button>
        </div>

        <div className="glass card-block" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 14 }}>Registered accounts ({profiles.length})</h3>
          <div className="scroll-box">
            {profiles.length ? profiles.map((p) => (
              <div key={p.id} className="leverage-row">
                <div>
                  <div className="leverage-title">{p.name || '(no name set)'}</div>
                  <div className="leverage-sub">{p.role} · {p.id}</div>
                </div>
              </div>
            )) : <div className="empty">{loadingCounts ? 'Loading…' : 'No profiles found.'}</div>}
          </div>
        </div>

        <div className="admin-grid">
          {ADMIN_TABLES.map((t) => (
            <div key={t.key} className="glass card-block admin-card">
              <div className="admin-card-count">{loadingCounts ? '…' : counts[t.key] === null ? '—' : counts[t.key]}</div>
              <div className="admin-card-label">{t.label}</div>
              <p className="sub" style={{ fontSize: 11, marginBottom: 16, minHeight: 32 }}>{t.note}</p>
              <button
                className="danger-btn"
                style={{ width: '100%' }}
                disabled={!counts[t.key]}
                onClick={() => { setConfirmKey(t.key); setConfirmText(''); }}
              >
                Clear all
              </button>
            </div>
          ))}
        </div>
      </section>

      {confirmKey && confirmTable && (
        <div className="admin-modal-backdrop" onClick={() => setConfirmKey(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 8 }}>Clear "{confirmTable.label}"?</h3>
            <p className="sub" style={{ fontSize: 12.5, marginBottom: 16 }}>
              This permanently deletes all {counts[confirmKey]} row{counts[confirmKey] === 1 ? '' : 's'} in <code>{confirmKey}</code>. {confirmTable.note} This cannot be undone.
            </p>
            <label className="field-label">Type <b>{confirmKey}</b> to confirm</label>
            <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} style={{ marginBottom: 16 }} autoFocus />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="soft-btn" onClick={() => setConfirmKey(null)}>Cancel</button>
              <button
                className="danger-btn"
                disabled={confirmText !== confirmKey || busyKey === confirmKey}
                onClick={() => clearTable(confirmKey)}
              >
                {busyKey === confirmKey ? 'Clearing…' : 'Permanently clear'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {(toasts || []).map((t: any) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </div>
  );
}

// =========================================================
// App shell
// =========================================================
function Shell({ role, tab, setTab, goToTasks, taskFocus, setTaskFocus, unread, onLogout, tasks, updates, reminders, chat, notifs, markNotifSeen, deleteNotif, markAllNotifsSeen, notifyRole, attendance, punchIn, punchOut, wishlist, addWishlistItem, toggleWishlistItem, deleteWishlistItem, expenses, addExpense, deleteExpense, costTickets, addCostTicket, addTicketOption, selectFinalVendor, deleteCostTicket, profile, toast, reload, toasts, notifPermission, requestNotifPermission, theme, toggleTheme }: any) {
  const [collapsed, setCollapsed] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const navItems =
    role === 'director'
      ? [
          { id: 'overview', label: 'Dashboard', ic: '◈' },
          { id: 'newtask', label: 'Capture', ic: '✎' },
          { id: 'tasks', label: 'All Tasks', ic: '☰' },
          { id: 'reminders', label: 'Reminders', ic: '◷' },
          { id: 'attendance', label: 'Attendance', ic: '🕐' },
          { id: 'expense', label: 'Expense', ic: '₹' },
          { id: 'costimprovement', label: 'Cost Improvement', ic: '↓' },
          { id: 'wishlist', label: 'Wishlist', ic: '★' },
          { id: 'ai', label: 'AI', ic: '✦' },
          { id: 'chat', label: 'Chat', ic: '✉' },
        ]
      : [
          { id: 'overview', label: 'Dashboard', ic: '◈' },
          { id: 'newtask', label: 'Capture', ic: '✎' },
          { id: 'tasks', label: 'My Tasks', ic: '☰', badge: true },
          { id: 'reminders', label: 'Reminders', ic: '◷' },
          { id: 'attendance', label: 'Attendance', ic: '🕐' },
          { id: 'expense', label: 'Expense', ic: '₹' },
          { id: 'costimprovement', label: 'Cost Improvement', ic: '↓' },
          { id: 'wishlist', label: 'Wishlist', ic: '★' },
          { id: 'ai', label: 'AI', ic: '✦' },
          { id: 'chat', label: 'Chat', ic: '✉' },
        ];

  const unseenNotifs = (notifs || []).filter((n: Notif) => !n.seen);

  return (
    <>
    <div className={'app-shell' + (collapsed ? ' sidebar-collapsed' : '')}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">D</div>
          {!collapsed && <span>THE DESK</span>}
          <button className="sidebar-toggle" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <nav className="nav">
          {navItems.map((item: any) => (
            <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} title={collapsed ? item.label : undefined}>
              <span>{item.ic}</span>{!collapsed && <span>{item.label}</span>}
              {item.badge && unread > 0 && <span className="badge">{unread}</span>}
            </button>
          ))}
        </nav>
        {!collapsed && (
          <div className="sidebar-foot">
            <button className="theme-toggle" onClick={toggleTheme}>
              {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
            </button>
            {notifPermission !== 'granted' && (
              <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={requestNotifPermission}>🔔 Enable notifications</button>
            )}
            <span className="live"><i /> {role === 'director' ? 'Managing Director' : 'Executive Assistant'} · {profile.name || profile.id.slice(0, 6)}</span>
            <button className="soft-btn" style={{ padding: '9px 13px', fontSize: 11 }} onClick={onLogout}>Sign out</button>
          </div>
        )}
      </aside>
      <div className="main-content">
        <button className="bell-fab" onClick={() => setBellOpen((b) => !b)} title="Notifications">
          🔔
          {unseenNotifs.length > 0 && <span className="badge">{unseenNotifs.length}</span>}
        </button>
        {bellOpen && (
          <div className="bell-panel bell-panel-fixed">
            <div className="bell-panel-head">
              <span>Notifications</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {unseenNotifs.length > 0 && <button className="tiny-btn" onClick={markAllNotifsSeen}>Mark all seen</button>}
                <button className="bell-dismiss" onClick={() => setBellOpen(false)} title="Close" style={{ fontSize: 15 }}>✕</button>
              </div>
            </div>
            <div className="bell-panel-list">
              {(notifs || []).length ? notifs.map((n: Notif) => (
                <div key={n.id} className={'bell-item' + (n.seen ? ' seen' : '')}>
                  <div className="bell-item-text" onClick={() => { if (n.task_id) { setTab('tasks'); setTaskFocus({ kind: 'single', id: n.task_id }); setBellOpen(false); } }}>
                    {n.text}
                    <div className="bell-item-time">{new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <div className="bell-actions">
                    {!n.seen && <button className="bell-tick" onClick={() => markNotifSeen(n.id)} title="Mark as read">✓</button>}
                    <button className="bell-cross" onClick={() => deleteNotif(n.id)} title="Remove">✕</button>
                  </div>
                </div>
              )) : <div className="empty" style={{ padding: 20 }}>Nothing yet.</div>}
            </div>
          </div>
        )}
        <main>
          <section className="section">
            {tab === 'overview' && <Dashboard role={role} tasks={tasks} updates={updates} setTab={setTab} goToTasks={goToTasks} unread={unread} expenses={expenses} costTickets={costTickets} />}
            {tab === 'newtask' && <NewTask role={role} toast={toast} reload={reload} notifyRole={notifyRole} />}
            {tab === 'tasks' && <Tasks role={role} tasks={tasks} updates={updates} reload={reload} toast={toast} focus={taskFocus} setFocus={setTaskFocus} notifyRole={notifyRole} />}
            {tab === 'reminders' && <Reminders role={role} reminders={reminders} reload={reload} />}
            {tab === 'ai' && <AIPortal role={role} />}
            {tab === 'chat' && <Chat role={role} chat={chat} reload={reload} />}
            {tab === 'attendance' && <Attendance role={role} attendance={attendance} punchIn={punchIn} punchOut={punchOut} profile={profile} />}
            {tab === 'wishlist' && <Wishlist role={role} wishlist={wishlist} addWishlistItem={addWishlistItem} toggleWishlistItem={toggleWishlistItem} deleteWishlistItem={deleteWishlistItem} />}
            {tab === 'expense' && <ExpensePage role={role} profile={profile} expenses={expenses} addExpense={addExpense} deleteExpense={deleteExpense} toast={toast} />}
            {tab === 'costimprovement' && <CostImprovementPage role={role} costTickets={costTickets} addCostTicket={addCostTicket} addTicketOption={addTicketOption} selectFinalVendor={selectFinalVendor} deleteCostTicket={deleteCostTicket} toast={toast} />}
          </section>
        </main>
      </div>
      <div className="toast-stack">
        {toasts.map((t: any) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </div>
    </>
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
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize="26" fontWeight="800" fill="var(--text-main)">{value}</text>
      </svg>
      <div className="ring-label">{label}</div>
      {sub && <div className="ring-sub">{sub}</div>}
    </div>
  );
}

// =========================================================
// Dashboard — shared landing page for both Director and EA
// =========================================================
function Dashboard({ role, tasks, updates, setTab, goToTasks, unread, expenses, costTickets }: any) {
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

  const weight: any = { critical: 4, high: 3, medium: 2, low: 1 };
  const leverage = tasks
    .filter((t: Task) => t.status !== 'completed')
    .slice()
    .sort((a: Task, b: Task) => {
      const w = (weight[b.priority] || 0) - (weight[a.priority] || 0);
      if (w !== 0) return w;
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return ad - bd;
    })
    .slice(0, 4);

  function taskCode(t: Task) {
    const prefix: any = { Tasks: 'TSK', Operations: 'OPS', Development: 'DEV', 'Cost Improvement': 'COST' };
    const year = new Date(t.created_at).getFullYear();
    return `${prefix[t.category] || 'TSK'}-${year}-${t.id.slice(0, 4).toUpperCase()}`;
  }
  function lastUpdateText(t: Task) {
    const tUpdates = updates.filter((u: TaskUpdate) => u.task_id === t.id).sort((a: TaskUpdate, b: TaskUpdate) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return tUpdates[0]?.text || (t.due_date ? `Due ${t.due_date}` : 'No updates yet');
  }
  function completionTime(t: Task) {
    const latest = updates.filter((u: TaskUpdate) => u.task_id === t.id).sort((a: TaskUpdate, b: TaskUpdate) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return latest ? new Date(latest.created_at).getTime() : new Date(t.created_at).getTime();
  }
  function fmtDuration(ms: number) {
    if (ms < 60 * 60 * 1000) return Math.max(1, Math.round(ms / 60000)) + 'm';
    if (ms < 24 * 60 * 60 * 1000) return Math.round(ms / 3600000) + 'h';
    return Math.round(ms / 86400000) + 'd';
  }

  const nowExecuting = leverage[0] as Task | undefined;
  const followUpsDueTodayCount = tasks.filter((t: Task) => t.status === 'followup').length;
  const waitingResponseCount = tasks.filter((t: Task) => t.status === 'update').length;
  const resultsReadyCount = tasks.filter((t: Task) => t.status === 'closure').length;
  const progressUpdatesToday = updates.filter((u: TaskUpdate) => new Date(u.created_at).toDateString() === new Date().toDateString()).length;

  const attentionCount = overdue + critical + dueToday;
  const movedBeyondCapturePct = total > 0 ? Math.round((tasks.filter((t: Task) => t.status !== 'captured').length / total) * 100) : 0;
  const activeReminders = tasks.filter((t: Task) => t.reminder_at && new Date(t.reminder_at).getTime() > Date.now()).length;
  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const completedThisWeek = tasks.filter((t: Task) => t.status === 'completed' && completionTime(t) > now - oneWeek).length;
  const completedLastWeek = tasks.filter((t: Task) => t.status === 'completed' && completionTime(t) <= now - oneWeek && completionTime(t) > now - 2 * oneWeek).length;
  const weekDelta = completedThisWeek - completedLastWeek;

  // average time spent in each stage, derived from the "Moved to X" trail in task_updates
  const stageDurations: Record<string, { total: number; count: number }> = {};
  STAGES.forEach((s) => { stageDurations[s] = { total: 0, count: 0 }; });
  tasks.forEach((t: Task) => {
    const trail = updates
      .filter((u: TaskUpdate) => u.task_id === t.id && u.text.startsWith('Moved to "'))
      .sort((a: TaskUpdate, b: TaskUpdate) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const events: { ts: number; stage: Stage }[] = [{ ts: new Date(t.created_at).getTime(), stage: 'captured' }];
    trail.forEach((u: TaskUpdate) => {
      const m = u.text.match(/Moved to "([^"]+)"/);
      const found = m && (Object.keys(STAGE_LABELS) as Stage[]).find((k) => STAGE_LABELS[k] === m[1]);
      if (found) events.push({ ts: new Date(u.created_at).getTime(), stage: found });
    });
    for (let i = 0; i < events.length; i++) {
      const start = events[i].ts;
      const end = i + 1 < events.length ? events[i + 1].ts : now;
      stageDurations[events[i].stage].total += end - start;
      stageDurations[events[i].stage].count += 1;
    }
  });

  // overdue tasks sorted by how long they've been stuck, not just a binary count
  const overdueAged = tasks
    .filter((t: Task) => t.due_date && t.due_date < today && t.status !== 'completed')
    .map((t: Task) => ({ t, days: Math.floor((now - new Date(t.due_date as string).getTime()) / 86400000) }))
    .sort((a: { days: number }, b: { days: number }) => b.days - a.days)
    .slice(0, 5);

  return (
    <>
      <div className="eyebrow">Command</div>
      <h2>{role === 'director' ? "Director's dashboard." : 'Your dashboard.'}</h2>
      <p className="sub">{role === 'director' ? 'Everything the EA is executing, live — no need to ask.' : 'Everything on your plate, at a glance.'}</p>

      <div className="ring-strip">
        <Ring value={total} total={total || 1} color="var(--blue)" label="Total tasks" sub="All time" onClick={() => setTab('tasks')} />
        <Ring value={fresh} total={total || 1} color="var(--rose)" label="Not picked up" sub="Needs action" onClick={() => goToTasks({ kind: 'ring', key: 'captured', label: 'Not picked up' })} />
        <Ring value={progress} total={total || 1} color="var(--amber)" label="In progress" sub="Being worked on" onClick={() => goToTasks({ kind: 'ring', key: 'progress', label: 'In progress' })} />
        <Ring value={critical} total={total || 1} color="#ff2d55" label="Critical" sub="Needs urgent attention" onClick={() => goToTasks({ kind: 'ring', key: 'critical', label: 'Critical' })} />
        <Ring value={done} total={total || 1} color="var(--mint)" label="Completed" sub="Closed out" onClick={() => goToTasks({ kind: 'ring', key: 'completed', label: 'Completed' })} />
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="glass card-block attention-card">
          <div className="eyebrow" style={{ color: 'var(--violet)' }}>Today's attention</div>
          <h3 style={{ fontSize: 24, margin: '4px 0 8px' }}>Only what needs your eyes.</h3>
          <p className="sub" style={{ fontSize: 12, marginBottom: 18 }}>
            {role === 'director' ? 'Everything else stays with the EA until the result is delivered.' : 'Everything else keeps moving without needing a check-in.'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div className="alert-num">{String(attentionCount).padStart(2, '0')}</div>
            <div className="alert-breakdown">
              <div><span className="pill status-captured">{overdue} overdue</span></div>
              <div><span className="pill prio-critical">{critical} critical</span></div>
              <div><span className="pill status-progress">{dueToday} due today</span></div>
            </div>
            <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff', marginLeft: 'auto' }} onClick={() => goToTasks({ kind: 'ring', key: 'overdue', label: 'Overdue' })}>Review →</button>
          </div>
        </div>
        <div className="glass card-block">
          <span className="pill" style={{ color: 'var(--mint)', borderColor: 'rgba(101,237,189,.3)', marginBottom: 16 }}>
            <i className="dot" style={{ background: 'var(--mint)', boxShadow: 'none' }} /> Execution pulse
          </span>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.3, margin: '10px 0' }}>
            {movedBeyondCapturePct}% of work has moved beyond capture.
          </div>
          <p className="sub" style={{ fontSize: 12 }}>
            {activeReminders} reminder{activeReminders !== 1 ? 's' : ''} currently active · {completedThisWeek} completed this week
          </p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="glass card-block">
          <h3 style={{ marginBottom: 4 }}>Weekly digest</h3>
          <p className="sub" style={{ fontSize: 11.5, marginBottom: 16 }}>This week vs last week — is work speeding up or slowing down.</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
            <div style={{ fontSize: 32, fontWeight: 900 }}>{completedThisWeek}</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>completed this week</div>
            <span
              className="pill"
              style={{
                marginLeft: 'auto',
                color: weekDelta > 0 ? 'var(--mint)' : weekDelta < 0 ? 'var(--rose)' : '#8f9ba7',
                borderColor: weekDelta > 0 ? 'rgba(101,237,189,.3)' : weekDelta < 0 ? 'rgba(255,125,150,.3)' : 'var(--line)',
              }}
            >
              {weekDelta > 0 ? `▲ +${weekDelta} vs last week` : weekDelta < 0 ? `▼ ${weekDelta} vs last week` : '— same as last week'}
            </span>
          </div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800, color: 'var(--text-faint)', marginBottom: 10 }}>
            Average time per stage
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {STAGES.filter((s) => s !== 'completed').map((s) => {
              const d = stageDurations[s];
              return (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-mid)' }}>
                  <span>{STAGE_LABELS[s]}</span>
                  <span style={{ color: 'var(--text-faint)', fontFamily: 'ui-monospace, monospace' }}>{d.count ? fmtDuration(d.total / d.count) + ' avg' : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="glass card-block">
          <h3 style={{ marginBottom: 4 }}>Overdue aging</h3>
          <p className="sub" style={{ fontSize: 11.5, marginBottom: 16 }}>Sorted by how long they've been stuck — not just that they're late.</p>
          {overdueAged.length ? overdueAged.map(({ t, days }: { t: Task; days: number }) => (
            <div key={t.id} className="leverage-row">
              <div>
                <div className="leverage-title">{t.title}</div>
                <div className="leverage-sub">
                  <span style={{ color: days > 7 ? '#ff2d55' : days > 2 ? 'var(--amber)' : 'var(--rose)', fontWeight: 800 }}>
                    {days} day{days !== 1 ? 's' : ''} overdue
                  </span> · {STAGE_LABELS[t.status]} · {t.priority}
                </div>
              </div>
              <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff', flexShrink: 0 }} onClick={() => goToTasks({ kind: 'single', id: t.id })}>Open</button>
            </div>
          )) : <div className="empty">Nothing overdue right now.</div>}
        </div>
      </div>

      <div className="category-strip">
        {CATEGORIES.map((c: Category, i: number) => {
          const count = tasks.filter((t: Task) => (t.category || 'Tasks') === c && t.status !== 'completed').length;
          const meta: any = {
            Tasks: { icon: '✓', accent: '#5798ff' },
            Operations: { icon: '⚙', accent: '#65edbd' },
            Development: { icon: '</>' , accent: '#a99cff' },
            'Cost Improvement': { icon: '↓', accent: '#ffbd64' },
          };
          const m = meta[c] || meta.Tasks;
          const savedHere = c === 'Cost Improvement'
            ? (costTickets || []).reduce((sum: number, t: CostTicket) => {
                if (!t.selected_option_id) return sum;
                const opt = t.options.find((o) => o.id === t.selected_option_id);
                return opt ? sum + (t.existing_rate - opt.rate) * t.quantity : sum;
              }, 0)
            : null;
          return (
            <button key={c} className="category-card" style={{ borderTop: `4px solid ${m.accent}` }} onClick={() => c === 'Cost Improvement' ? setTab('costimprovement') : goToTasks({ kind: 'ring', key: 'category:' + c, label: c })}>
              <div className="cc-top">
                <span className="cc-index">{String(i + 1).padStart(2, '0')} / CORE</span>
                <span className="cc-icon" style={{ background: m.accent + '22', color: m.accent }}>{m.icon}</span>
              </div>
              <span className="cc-name">{c}</span>
              <span className="cc-count">
                {count} open{savedHere !== null ? ` · ₹${savedHere.toLocaleString('en-IN', { maximumFractionDigits: 0 })} saved` : ''}
              </span>
            </button>
          );
        })}
      </div>

      {(expenses !== undefined) && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          <div className="glass card-block">
            <span className="pill" style={{ color: '#ffbd64', borderColor: 'rgba(255,189,100,.3)', marginBottom: 14 }}>
              <i className="dot" style={{ background: '#ffbd64', boxShadow: 'none' }} /> Expenses this month
            </span>
            <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 4 }}>
              ₹{(expenses || []).filter((e: Expense) => e.expense_date.startsWith(new Date().toISOString().slice(0, 7))).reduce((s: number, e: Expense) => s + Number(e.amount), 0).toLocaleString('en-IN')}
            </div>
            <p className="sub" style={{ fontSize: 12 }}>
              {(expenses || []).filter((e: Expense) => e.expense_date.startsWith(new Date().toISOString().slice(0, 7))).length} invoices uploaded
              {' · '}<span onClick={() => setTab('expense')} style={{ cursor: 'pointer', color: 'var(--acid)' }}>View all →</span>
            </p>
          </div>
          <div className="glass card-block">
            <span className="pill" style={{ color: 'var(--mint)', borderColor: 'rgba(101,237,189,.3)', marginBottom: 14 }}>
              <i className="dot" style={{ background: 'var(--mint)', boxShadow: 'none' }} /> Cost savings identified
            </span>
            <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 4 }}>
              ₹{(costTickets || []).reduce((s: number, t: CostTicket) => {
                if (!t.selected_option_id) return s;
                const opt = t.options.find((o) => o.id === t.selected_option_id);
                return opt ? s + (t.existing_rate - opt.rate) * t.quantity : s;
              }, 0).toLocaleString('en-IN')}
            </div>
            <p className="sub" style={{ fontSize: 12 }}>
              {(costTickets || []).filter((t: CostTicket) => t.selected_option_id).length} of {(costTickets || []).length} comparison{(costTickets || []).length !== 1 ? 's' : ''} finalized
              {' · '}<span onClick={() => setTab('costimprovement')} style={{ cursor: 'pointer', color: 'var(--acid)' }}>Review →</span>
            </p>
          </div>
        </div>
      )}

      {nowExecuting && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          <div className="glass hero now-executing">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span className="eyebrow" style={{ color: 'var(--amber)', margin: 0 }}>Now executing · {nowExecuting.priority === 'critical' || nowExecuting.priority === 'high' ? 'P1' : 'P2'}</span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{nowExecuting.category} · {STAGE_LABELS[nowExecuting.status]}</span>
            </div>
            <h3 style={{ fontSize: 26, marginBottom: 10, lineHeight: 1.25 }}>{nowExecuting.title}</h3>
            <p className="sub" style={{ fontSize: 12.5, marginBottom: 20 }}>{nowExecuting.description || 'No description provided.'}</p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button className="acid-btn" onClick={() => goToTasks({ kind: 'single', id: nowExecuting.id })}>Complete next action</button>
              <button className="soft-btn" onClick={() => setTab('tasks')}>Open full work</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, height: 8, borderRadius: 20, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                <div style={{ width: movedBeyondCapturePct + '%', height: '100%', background: 'linear-gradient(90deg, var(--amber), var(--acid))' }} />
              </div>
              <span style={{ fontSize: 22, fontWeight: 900 }}>{movedBeyondCapturePct}%</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="glass card-block" style={{ flex: 1 }}>
              <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 6 }}>{followUpsDueTodayCount}</div>
              <div className="sub" style={{ fontSize: 12, marginBottom: 14 }}>follow-ups in progress</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--text-faint)' }}>Overdue dependencies</span><b>{overdue}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--text-faint)' }}>Waiting response</span><b>{waitingResponseCount}</b>
              </div>
            </div>
            <div className="glass card-block" style={{ flex: 1 }}>
              <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 6 }}>{resultsReadyCount}</div>
              <div className="sub" style={{ fontSize: 12, marginBottom: 14 }}>results ready for review</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--text-faint)' }}>Completed this week</span><b>{completedThisWeek}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--text-faint)' }}>Progress updates today</span><b>{progressUpdatesToday}</b>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="glass card-block" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Highest-leverage work now</h3>
          <button className="dark-btn" onClick={() => setTab('tasks')}>Open full execution cockpit</button>
        </div>
        {leverage.length ? leverage.map((t: Task) => (
          <div key={t.id} className="leverage-row">
            <div>
              <div className="leverage-title">{t.title}</div>
              <div className="leverage-sub">{taskCode(t)} · {STAGE_LABELS[t.status]} · {t.priority} · {lastUpdateText(t)}</div>
            </div>
            <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff', flexShrink: 0 }} onClick={() => goToTasks({ kind: 'single', id: t.id })}>Open</button>
          </div>
        )) : <div className="empty">Nothing open right now.</div>}
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
function NewTask({ role, toast, reload, notifyRole }: any) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<Category>('Tasks');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<any>(null);

  const [bulkRows, setBulkRows] = useState<any[]>([]);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkFileRef = useRef<HTMLInputElement>(null);

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
    const { data: inserted, error } = await supabase.from('tasks').insert({
      title: deriveTitle(text),
      description: text.trim(),
      category,
      priority,
      due_date: dueDate || null,
      status: 'captured',
      created_by: userData.user?.id,
    }).select().single();
    setBusy(false);
    if (error) { toast('Could not save task: ' + error.message); return; }
    const otherRole = role === 'director' ? 'ea' : 'director';
    if (inserted) await notifyRole(otherRole, `New task: "${inserted.title}"`, inserted.id);
    setText(''); setCategory('Tasks'); setPriority('medium'); setDueDate('');
    toast(role === 'director' ? 'Task sent to the EA.' : 'Task added — Director will see it live.');
    reload.loadTasks();
  }

  // ---------- bulk CSV import ----------
  function downloadTemplate() {
    const csv = 'title,description,category,priority,due_date\n' +
      'Prep board deck,Slides for the quarterly review,Tasks,high,2026-08-15\n' +
      'Renew office AMC,Follow up with vendor,Operations,medium,\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'the-desk-bulk-task-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    const Papa = (await import('papaparse')).default;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: any) => {
        const rows = (results.data as any[])
          .filter((r) => r.title && r.title.trim())
          .map((r) => ({
            title: r.title.trim(),
            description: (r.description || '').trim(),
            category: (CATEGORIES as string[]).includes(r.category) ? r.category : 'Tasks',
            priority: ['low', 'medium', 'high', 'critical'].includes((r.priority || '').toLowerCase()) ? r.priority.toLowerCase() : 'medium',
            due_date: r.due_date && r.due_date.trim() ? r.due_date.trim() : null,
          }));
        setBulkRows(rows);
        if (!rows.length) toast('No valid rows found — make sure each row has a "title" column filled in.');
      },
      error: (err: any) => toast('⚠️ Could not read that file: ' + err.message),
    });
  }

  async function importBulk() {
    if (!bulkRows.length) return;
    setBulkBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const payload = bulkRows.map((r) => ({ ...r, status: 'captured', created_by: userData.user?.id }));
    const { data: inserted, error } = await supabase.from('tasks').insert(payload).select();
    setBulkBusy(false);
    if (error) { toast('⚠️ Bulk import failed: ' + error.message); return; }
    const otherRole = role === 'director' ? 'ea' : 'director';
    await notifyRole(otherRole, `${inserted?.length || bulkRows.length} tasks imported in bulk`, null);
    toast(`Imported ${inserted?.length || bulkRows.length} tasks — all in Captured.`);
    setBulkRows([]); setBulkFileName('');
    if (bulkFileRef.current) bulkFileRef.current.value = '';
    reload.loadTasks();
  }

  return (
    <>
      <div className="eyebrow">Capture</div>
      <h2>Turn a thought into a task.</h2>
      <p className="sub">{role === 'director' ? 'Type it or speak it — it goes straight to the EA, instantly.' : 'Type it or speak it — it lands on the shared board instantly, and the Director sees it live.'}</p>
      <div className="glass hero">
        <div className="capture">
          <button className={'mic-btn' + (listening ? ' live' : '')} onClick={toggleMic} title="Speak">🎙️</button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Prep the board deck by Friday, high priority, and confirm the venue for the offsite..." />
          <button className="acid-btn" disabled={busy} onClick={createTask}>{busy ? 'Sending…' : 'Create task →'}</button>
        </div>
        {listening && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10 }}>Listening…</div>}

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

      <div className="glass card-block" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Bulk import</h3>
          <button className="soft-btn" onClick={downloadTemplate}>⬇ Download CSV template</button>
        </div>
        <p className="sub" style={{ fontSize: 12, marginBottom: 16 }}>
          Upload a CSV to add many tasks at once — every row lands straight in "Captured." Columns: <code>title</code> (required), <code>description</code>, <code>category</code>, <code>priority</code>, <code>due_date</code>.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="soft-btn" onClick={() => bulkFileRef.current?.click()}>
            {bulkFileName ? `📎 ${bulkFileName}` : '📎 Choose CSV file'}
          </button>
          <input ref={bulkFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleBulkFile} />
          {bulkRows.length > 0 && (
            <button className="acid-btn" disabled={bulkBusy} onClick={importBulk}>
              {bulkBusy ? 'Importing…' : `Import ${bulkRows.length} task${bulkRows.length !== 1 ? 's' : ''} →`}
            </button>
          )}
        </div>

        {bulkRows.length > 0 && (
          <div style={{ marginTop: 16, maxHeight: 260, overflowY: 'auto' }}>
            {bulkRows.map((r, i) => (
              <div key={i} className="leverage-row">
                <div>
                  <div className="leverage-title">{r.title}</div>
                  <div className="leverage-sub">{r.category} · {r.priority}{r.due_date ? ' · Due ' + r.due_date : ''}</div>
                </div>
                <button className="tiny-btn" onClick={() => setBulkRows((rows) => rows.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// =========================================================
// Tasks — kanban pipeline (Captured -> Progress -> Follow-up -> Update -> Closure -> Completed)
// =========================================================
function Tasks({ role, tasks, updates, reload, toast, focus, setFocus, notifyRole }: any) {
  const otherRole: Role = role === 'ea' ? 'director' : 'ea';
  async function moveStage(id: string, dir: 1 | -1) {
    const t = tasks.find((x: Task) => x.id === id);
    if (!t) return;
    const idx = STAGES.indexOf(t.status);
    const next = STAGES[idx + dir];
    if (!next) return;
    await supabase.from('tasks').update({ status: next }).eq('id', id);
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text: `Moved to "${STAGE_LABELS[next]}"` });
    await notifyRole(otherRole, `"${t.title}" moved to ${STAGE_LABELS[next]}`, id);
    reload.loadTasks();
  }
  async function moveToStage(id: string, targetStage: Stage) {
    const t = tasks.find((x: Task) => x.id === id);
    if (!t || t.status === targetStage) return;
    await supabase.from('tasks').update({ status: targetStage }).eq('id', id);
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text: `Moved to "${STAGE_LABELS[targetStage]}"` });
    await notifyRole(otherRole, `"${t.title}" moved to ${STAGE_LABELS[targetStage]}`, id);
    reload.loadTasks();
  }
  async function postUpdate(id: string, text: string) {
    if (!text.trim()) return;
    await supabase.from('task_updates').insert({ task_id: id, by_role: role, text });
    const t = tasks.find((x: Task) => x.id === id);
    if (t && t.status === 'captured') await supabase.from('tasks').update({ status: 'progress' }).eq('id', id);
    if (t) await notifyRole(otherRole, `Update on "${t.title}": ${text}`, id);
    reload.loadTasks();
    toast('Update posted — Director will see it live.');
  }
  async function setReminder(id: string, when: string | null) {
    await supabase.from('tasks').update({ reminder_at: when }).eq('id', id);
    reload.loadTasks();
    toast(when ? 'Reminder set for this task.' : 'Reminder removed.');
  }

  function exportCSV() {
    const rows: string[][] = [['Timestamp', 'Task', 'Category', 'Priority', 'Event', 'Details']];
    const events: { ts: number; row: string[] }[] = [];
    tasks.forEach((t: Task) => {
      events.push({
        ts: new Date(t.created_at).getTime(),
        row: [t.created_at, t.title, t.category || 'Tasks', t.priority, 'Task created', t.description || ''],
      });
      updates.filter((u: TaskUpdate) => u.task_id === t.id).forEach((u: TaskUpdate) => {
        events.push({
          ts: new Date(u.created_at).getTime(),
          row: [u.created_at, t.title, t.category || 'Tasks', t.priority, u.by_role === 'ea' ? 'EA update' : 'Director update', u.text],
        });
      });
    });
    events.sort((a, b) => a.ts - b.ts);
    events.forEach((e) => rows.push(e.row));

    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `the-desk-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Exported — check your downloads.');
  }

  // ---- single-task focus: full detail, everything visible, nothing hidden ----
  if (focus?.kind === 'single') {
    const t = tasks.find((x: Task) => x.id === focus.id);
    const tUpdates = t ? updates.filter((u: TaskUpdate) => u.task_id === t.id).sort((a: TaskUpdate, b: TaskUpdate) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) : [];
    return (
      <>
        <div className="eyebrow">Focused view</div>
        <h2>Full task detail.</h2>
        <p className="sub">Everything about this card — nothing hidden.</p>
        <button className="soft-btn" style={{ marginBottom: 18 }} onClick={() => setFocus(null)}>← Back to full pipeline</button>
        {t ? (
          <TaskDetail t={t} role={role} tUpdates={tUpdates} moveStage={moveStage} postUpdate={postUpdate} setReminder={setReminder} />
        ) : <div className="empty">That task isn't around anymore.</div>}
      </>
    );
  }

  // ---- ring focus: filter the whole board down to a matching subset ----
  const today = new Date().toISOString().slice(0, 10);
  let filtered = tasks;
  let filterLabel = '';
  if (focus?.kind === 'ring') {
    filterLabel = focus.label || '';
    if (focus.key === 'captured') filtered = tasks.filter((t: Task) => t.status === 'captured');
    else if (focus.key === 'progress') filtered = tasks.filter((t: Task) => !['captured', 'completed'].includes(t.status));
    else if (focus.key === 'critical') filtered = tasks.filter((t: Task) => t.priority === 'critical' && t.status !== 'completed');
    else if (focus.key === 'completed') filtered = tasks.filter((t: Task) => t.status === 'completed');
    else if (focus.key === 'overdue') filtered = tasks.filter((t: Task) => t.due_date && t.due_date < today && t.status !== 'completed');
    else if (focus.key?.startsWith('category:')) filtered = tasks.filter((t: Task) => (t.category || 'Tasks') === focus.key.slice(9) && t.status !== 'completed');
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">{role === 'ea' ? 'Execute' : 'Oversight'}</div>
          <h2>{role === 'ea' ? 'Live execution pipeline.' : "Director's pipeline view."}</h2>
          <p className="sub">{role === 'ea' ? 'Drag a card to move it — or use the buttons. Set reminders on anything time-sensitive.' : 'Everything the EA is executing, stage by stage.'}</p>
        </div>
        {role === 'director' && (
          <button className="soft-btn" onClick={exportCSV} title="Download every task and update with exact timestamps">
            ⬇ Export activity log
          </button>
        )}
      </div>

      {focus?.kind === 'ring' && (
        <div className="filter-bar">
          <span>Showing: <b>{filterLabel}</b> ({filtered.length})</span>
          <button className="tiny-btn" onClick={() => setFocus(null)}>Clear filter ✕</button>
        </div>
      )}

      <div className="pipeline-board" style={{ marginTop: 22 }}>
        {STAGES.map((stage) => {
          const stageTasks = filtered.filter((t: Task) => t.status === stage);
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

// =========================================================
// TaskDetail — the full, nothing-hidden view of a single task
// =========================================================
function TaskDetail({ t, role, tUpdates, moveStage, postUpdate, setReminder }: { t: Task; role: Role; tUpdates: TaskUpdate[]; moveStage: any; postUpdate: any; setReminder: any }) {
  const [val, setVal] = useState('');
  const [remVal, setRemVal] = useState(t.reminder_at ? t.reminder_at.slice(0, 16) : '');
  const idx = STAGES.indexOf(t.status);
  const canGoBack = idx > 0;
  const canAdvance = idx < STAGES.length - 1;
  const isCritical = t.priority === 'critical' && t.status !== 'completed';
  const today = new Date().toISOString().slice(0, 10);
  const daysOverdue = t.due_date && t.due_date < today && t.status !== 'completed' ? Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000) : 0;

  return (
    <div className="paper card-block" style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="pill cat-pill">{t.category || 'Tasks'}</span>
        <span className={'pill prio-' + t.priority}>{t.priority}</span>
        <span className={'pill status-' + t.status}>{STAGE_LABELS[t.status]}</span>
        {daysOverdue > 0 && <span className="pill" style={{ color: '#ff2d55', borderColor: 'rgba(255,45,85,.4)', fontWeight: 800 }}>{daysOverdue}d overdue</span>}
      </div>
      <h3 style={{ fontSize: 24, marginBottom: 10 }}>{t.title}</h3>
      <p style={{ fontSize: 13.5, color: '#4a545c', lineHeight: 1.6, marginBottom: 16 }}>{t.description || 'No description.'}</p>

      <div className="form-grid" style={{ marginBottom: 18 }}>
        <div>
          <label className="field-label">Due date</label>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{t.due_date || 'Not set'}</div>
        </div>
        <div>
          <label className="field-label">Reminder</label>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{t.reminder_at ? new Date(t.reminder_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'None set'}</div>
        </div>
      </div>

      <div className="actions-row" style={{ marginBottom: 18 }}>
        {canGoBack && <button className="tiny-btn" onClick={() => moveStage(t.id, -1)}>← Back a stage</button>}
        {canAdvance && <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => moveStage(t.id, 1)}>Advance →</button>}
      </div>

      <div style={{ marginBottom: 18 }}>
        <label className="field-label">Remind at</label>
        <input type="datetime-local" className="reminder-input" value={remVal} onChange={(e) => setRemVal(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => setReminder(t.id, remVal ? new Date(remVal).toISOString() : null)}>Save reminder</button>
          {t.reminder_at && <button className="tiny-btn" onClick={() => { setReminder(t.id, null); setRemVal(''); }}>Clear reminder</button>}
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(12,18,24,.1)', paddingTop: 16 }}>
        <label className="field-label" style={{ marginBottom: 10 }}>Full activity timeline ({tUpdates.length})</label>
        {tUpdates.length ? tUpdates.map((u: TaskUpdate) => (
          <div className="upd-line" key={u.id} style={{ marginBottom: 8 }}>
            <b>{u.by_role === 'ea' ? 'EA' : 'Director'}:</b> {u.text}
            <span style={{ color: 'var(--text-faint)' }}> · {new Date(u.created_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )) : <div className="upd-line" style={{ color: 'var(--text-faint)' }}>No activity yet.</div>}
        <div className="upd-form" style={{ marginTop: 12 }}>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Post an update..." onKeyDown={(e) => { if (e.key === 'Enter') { postUpdate(t.id, val); setVal(''); } }} />
          <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => { postUpdate(t.id, val); setVal(''); }}>Post</button>
        </div>
      </div>
    </div>
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
  const todayStr = new Date().toISOString().slice(0, 10);
  const daysOverdue = t.due_date && t.due_date < todayStr && t.status !== 'completed'
    ? Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000)
    : 0;

  return (
    <div
      className={'work' + (isCritical ? ' work-critical' : '')}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
    >
      <div className="drag-handle" title="Drag to move this card">⠿⠿ drag to move</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="pill cat-pill">{t.category || 'Tasks'}</span>
        <span className={'pill prio-' + t.priority}>{t.priority}</span>
        {daysOverdue > 0 && (
          <span className="pill" style={{ color: daysOverdue > 7 ? '#ff2d55' : 'var(--rose)', borderColor: daysOverdue > 7 ? 'rgba(255,45,85,.4)' : 'rgba(255,125,150,.3)', fontWeight: 800 }}>
            {daysOverdue}d overdue
          </span>
        )}
      </div>
      <strong className="w-title">{t.title}</strong>
      <div className="w-desc">{t.description}</div>
      <div className="w-meta" style={{ marginTop: 8 }}>
        <span className="w-due">{t.due_date ? 'DUE ' + t.due_date : 'NO DUE DATE'}</span>
      </div>

      {t.reminder_at && (
        <div className="reminder-badge" onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowReminder((s) => !s)}>
          ⏰ {new Date(t.reminder_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      <div className="actions-row" style={{ marginTop: 10 }} onMouseDown={(e) => e.stopPropagation()}>
        {canGoBack && <button className="tiny-btn" onClick={() => moveStage(t.id, -1)}>← Back</button>}
        {canAdvance && <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => moveStage(t.id, 1)}>Advance →</button>}
        <button className="tiny-btn" onClick={() => setShowReminder((s) => !s)}>⏰ Remind</button>
        <button className="tiny-btn" onClick={() => setShowUpdates((s) => !s)}>💬 {updates.length}</button>
      </div>

      {showReminder && (
        <div className="reminder-form" onMouseDown={(e) => e.stopPropagation()}>
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
        <div className="w-updates" onMouseDown={(e) => e.stopPropagation()}>
          {updates.length ? updates.map((u: TaskUpdate) => (
            <div className="upd-line" key={u.id}><b>{u.by_role === 'ea' ? 'EA' : 'Director'}:</b> {u.text} <span style={{ color: 'var(--text-faint)' }}>· {new Date(u.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
          )) : <div className="upd-line" style={{ color: 'var(--text-faint)' }}>No updates yet.</div>}
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
      <div className="scroll-box" style={{ marginTop: 20 }}>
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
// =========================================================
// Shared speech-to-text hook — used by AI Portal and Chat
// =========================================================
function useSpeechToText(onResult: (text: string) => void) {
  const recRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);

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
      if (final) onResult(final);
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setSupported(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    if (!recRef.current) return;
    if (listening) { recRef.current.stop(); setListening(false); }
    else { recRef.current.start(); setListening(true); }
  }

  return { listening, toggle, supported };
}

// =========================================================
// Real voice-note recording (not speech-to-text) — records
// actual audio and hands back a playable blob, like a
// WhatsApp voice message.
// =========================================================
function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!navigator.mediaDevices && !!(window as any).MediaRecorder);
  }, []);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mediaRecorderRef.current = mr;
    mr.start();
    setRecording(true);
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr) { resolve(new Blob()); return; }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        mr.stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        resolve(blob);
      };
      mr.stop();
    });
  }

  return { recording, supported, start, stop };
}

function AIPortal({ role }: any) {
  const [history, setHistory] = useState<{ role: string; text: string; audioUrl?: string }[]>([]);
  const [input, setInput] = useState('');
  const [sendingVoice, setSendingVoice] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceRecorder();

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

  async function toggleVoice() {
    if (!voice.supported) { alert('Voice recording is not supported in this browser.'); return; }
    if (voice.recording) {
      const blob = await voice.stop();
      setSendingVoice(true);
      const audioUrl = URL.createObjectURL(blob);
      const next = [...history, { role: 'user', text: '🎤 Voice message', audioUrl }];
      setHistory(next);
      setHistory((h) => [...h, { role: 'assistant', text: '…listening' }]);
      try {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });
        const resp = await fetch('/api/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, history: next.slice(0, -1), audioBase64: base64, audioMimeType: 'audio/webm' }),
        });
        const data = await resp.json();
        const replyText = data.reply || (data.error ? `⚠️ ${data.error}` : 'Sorry, no reply.');
        setHistory((h) => [...h.slice(0, -1), { role: 'assistant', text: replyText }]);
      } catch {
        setHistory((h) => [...h.slice(0, -1), { role: 'assistant', text: 'Sorry, I could not reach the AI just now.' }]);
      }
      setSendingVoice(false);
    } else {
      try { await voice.start(); } catch { alert('Could not access your microphone.'); }
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
          {history.map((m, i) => (
            <div key={i} className={'bubble ' + (m.role === 'user' ? 'user' : 'ai')}>
              {m.text}
              {m.audioUrl && <audio controls src={m.audioUrl} className="voice-note-player" />}
            </div>
          ))}
        </div>
        <div className="chat-compose">
          {voice.supported && (
            <button
              className={'mic-btn' + (voice.recording ? ' live' : '')}
              onClick={toggleVoice}
              disabled={sendingVoice}
              title={voice.recording ? 'Stop and send voice note' : 'Record a voice note'}
              style={{ width: 44, height: 44 }}
            >
              {voice.recording ? '⏹️' : '🎙️'}
            </button>
          )}
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
  const [uploading, setUploading] = useState(false);
  const [sendingVoice, setSendingVoice] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();

  async function send() {
    const text = input.trim();
    if (!text) return;
    await supabase.from('chat_messages').insert({ from_role: role, text });
    setInput('');
    reload.loadChat();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file);
    if (upErr) {
      setUploading(false);
      alert('Upload failed: ' + upErr.message);
      return;
    }
    const { data: pub } = supabase.storage.from('attachments').getPublicUrl(path);
    await supabase.from('chat_messages').insert({
      from_role: role,
      text: input.trim() || `📎 ${file.name}`,
      attachment_url: pub.publicUrl,
      attachment_name: file.name,
    });
    setInput('');
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    reload.loadChat();
  }

  async function toggleVoice() {
    if (!voice.supported) { alert('Voice recording is not supported in this browser.'); return; }
    if (voice.recording) {
      const blob = await voice.stop();
      setSendingVoice(true);
      const path = `voice-notes/${Date.now()}-note.webm`;
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, blob, { contentType: 'audio/webm' });
      setSendingVoice(false);
      if (upErr) { alert('Could not send voice note: ' + upErr.message); return; }
      const { data: pub } = supabase.storage.from('attachments').getPublicUrl(path);
      await supabase.from('chat_messages').insert({
        from_role: role,
        text: '🎤 Voice note',
        attachment_url: pub.publicUrl,
        attachment_name: 'voice-note.webm',
      });
      reload.loadChat();
    } else {
      try { await voice.start(); } catch { alert('Could not access your microphone.'); }
    }
  }

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [chat]);

  function isImage(name?: string | null) {
    return !!name && /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
  }
  function isAudio(name?: string | null) {
    return !!name && /\.(webm|mp3|wav|m4a|ogg)$/i.test(name);
  }

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
              {isAudio(m.attachment_name) ? null : m.text}
              {m.attachment_url && (
                isAudio(m.attachment_name) ? (
                  <audio controls src={m.attachment_url} className="voice-note-player" />
                ) : isImage(m.attachment_name) ? (
                  <a href={m.attachment_url} target="_blank" rel="noreferrer"><img src={m.attachment_url} alt={m.attachment_name || 'attachment'} className="chat-attachment-img" /></a>
                ) : (
                  <a href={m.attachment_url} target="_blank" rel="noreferrer" className="chat-attachment-file">📎 {m.attachment_name || 'Download attachment'}</a>
                )
              )}
              <small>{m.from_role === 'director' ? 'Director' : 'EA'} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
          ))}
        </div>
        <div className="chat-compose">
          {voice.supported && (
            <button
              className={'mic-btn' + (voice.recording ? ' live' : '')}
              onClick={toggleVoice}
              disabled={sendingVoice}
              title={voice.recording ? 'Stop and send voice note' : 'Record a voice note'}
              style={{ width: 44, height: 44 }}
            >
              {voice.recording ? '⏹️' : '🎙️'}
            </button>
          )}
          <button className="mic-btn" style={{ width: 44, height: 44 }} onClick={() => fileRef.current?.click()} title="Attach a file" disabled={uploading}>
            {uploading ? '…' : '📎'}
          </button>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleFile} />
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message..." onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="acid-btn" onClick={send}>Send</button>
        </div>
      </div>
    </>
  );
}

// =========================================================
// Attendance — punch in/out, daily log, monthly totals, CSV report
// =========================================================
function Attendance({ role, attendance, punchIn, punchOut, profile }: any) {
  const isEA = role === 'ea';
  const eaRecords = (attendance || []).filter((a: AttendanceRow) => a.role === 'ea');
  const myOpen = eaRecords.find((a: AttendanceRow) => !a.punch_out);
  const now = Date.now();
  const [monthOffset, setMonthOffset] = useState(0);
  const [generating, setGenerating] = useState(false);

  function fmtHours(ms: number) {
    return Math.max(0, ms / 3600000).toFixed(1) + 'h';
  }
  function dayTotalMs(records: AttendanceRow[]) {
    return records.reduce((sum, r) => sum + ((r.punch_out ? new Date(r.punch_out).getTime() : now) - new Date(r.punch_in).getTime()), 0);
  }

  const byDate: Record<string, AttendanceRow[]> = {};
  eaRecords.forEach((a: AttendanceRow) => {
    const d = a.punch_in.slice(0, 10);
    (byDate[d] = byDate[d] || []).push(a);
  });
  const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthStr = new Date().toISOString().slice(0, 7);
  const todayTotal = byDate[todayStr] ? dayTotalMs(byDate[todayStr]) : 0;
  const thisMonthTotal = allDates.filter((d) => d.startsWith(thisMonthStr)).reduce((sum, d) => sum + dayTotalMs(byDate[d]), 0);

  // ---- calendar month being viewed ----
  const viewDate = new Date();
  viewDate.setDate(1);
  viewDate.setMonth(viewDate.getMonth() + monthOffset);
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const viewMonthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const monthDatesPresent = allDates.filter((d) => d.startsWith(viewMonthStr));
  const monthTotalViewed = monthDatesPresent.reduce((sum, d) => sum + dayTotalMs(byDate[d]), 0);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function exportCSV() {
    const rows: string[][] = [['Date', 'Punch In', 'Punch Out', 'Hours']];
    allDates.forEach((d) => {
      byDate[d].slice().sort((a, b) => new Date(a.punch_in).getTime() - new Date(b.punch_in).getTime()).forEach((r) => {
        const ms = (r.punch_out ? new Date(r.punch_out).getTime() : now) - new Date(r.punch_in).getTime();
        rows.push([d, new Date(r.punch_in).toLocaleTimeString(), r.punch_out ? new Date(r.punch_out).toLocaleTimeString() : 'Still in', fmtHours(ms)]);
      });
    });
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${todayStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportPDF() {
    setGenerating(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      await import('jspdf-autotable');
      const doc = new jsPDF() as any;
      const pageWidth = doc.internal.pageSize.getWidth();

      // header band
      doc.setFillColor(13, 24, 38);
      doc.rect(0, 0, pageWidth, 38, 'F');
      doc.setFillColor(216, 255, 98);
      doc.roundedRect(14, 10, 18, 18, 4, 4, 'F');
      doc.setTextColor(13, 24, 38);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('D', 20.5, 22);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text('THE DESK', 38, 19);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 210, 220);
      doc.text('Attendance Report', 38, 26);

      doc.setTextColor(30, 30, 30);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(profile?.name || 'Executive Assistant', 14, 50);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      doc.text('Executive Assistant', 14, 56);
      doc.text(monthLabel, pageWidth - 14, 50, { align: 'right' });
      doc.text('Generated ' + new Date().toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }), pageWidth - 14, 56, { align: 'right' });

      // summary boxes
      const boxY = 64;
      const boxW = (pageWidth - 28 - 16) / 3;
      const summary = [
        { label: 'Days present', value: String(monthDatesPresent.length) },
        { label: 'Total hours', value: fmtHours(monthTotalViewed) },
        { label: 'Avg hrs / day', value: monthDatesPresent.length ? (monthTotalViewed / 3600000 / monthDatesPresent.length).toFixed(1) + 'h' : '0.0h' },
      ];
      summary.forEach((s, i) => {
        const x = 14 + i * (boxW + 8);
        doc.setFillColor(244, 241, 235);
        doc.roundedRect(x, boxY, boxW, 24, 3, 3, 'F');
        doc.setTextColor(20, 20, 20);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text(s.value, x + boxW / 2, boxY + 12, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(s.label, x + boxW / 2, boxY + 19, { align: 'center' });
      });

      const rows = monthDatesPresent
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .map((d) => {
          const records = byDate[d].slice().sort((a, b) => new Date(a.punch_in).getTime() - new Date(b.punch_in).getTime());
          const first = records[0];
          const last = records[records.length - 1];
          return [
            new Date(d + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
            new Date(first.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            last.punch_out ? new Date(last.punch_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Still in',
            fmtHours(dayTotalMs(records)),
          ];
        });

      doc.autoTable({
        startY: boxY + 32,
        head: [['Date', 'Punch In', 'Punch Out', 'Hours']],
        body: rows,
        theme: 'plain',
        headStyles: { fillColor: [13, 24, 38], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9, textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [248, 247, 244] },
        styles: { cellPadding: 5 },
      });

      doc.save(`attendance-${profile?.name || 'ea'}-${monthLabel.replace(' ', '-')}.pdf`);
    } catch (e) {
      alert('Could not generate PDF: ' + (e as Error).message);
    }
    setGenerating(false);
  }

  return (
    <>
      <div className="eyebrow">Attendance</div>
      <h2>{isEA ? 'Your attendance.' : "EA's attendance."}</h2>
      <p className="sub">{isEA ? 'Punch in and out — the Director sees this in real time.' : "Live view of the EA's punch in/out log."}</p>

      {isEA && (
        <div className="glass hero" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>{myOpen ? 'Currently punched in since' : 'Not punched in'}</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{myOpen ? new Date(myOpen.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
            </div>
            <button className="acid-btn" style={{ marginLeft: 'auto' }} onClick={() => (myOpen ? punchOut(myOpen.id) : punchIn())}>
              {myOpen ? 'Punch Out' : 'Punch In'}
            </button>
          </div>
        </div>
      )}

      <div className="kpi-strip">
        <div className="kpi"><small>Today</small><strong>{fmtHours(todayTotal)}</strong><span>worked so far</span></div>
        <div className="kpi"><small>This month</small><strong>{fmtHours(thisMonthTotal)}</strong><span>total hours</span></div>
      </div>

      <div className="glass card-block" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="tiny-btn" onClick={() => setMonthOffset((m) => m - 1)}>←</button>
            <h3 style={{ margin: 0, minWidth: 150, textAlign: 'center' }}>{monthLabel}</h3>
            <button className="tiny-btn" onClick={() => setMonthOffset((m) => m + 1)} disabled={monthOffset >= 0}>→</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="soft-btn" onClick={exportCSV}>⬇ CSV</button>
            <button className="soft-btn" onClick={exportPDF} disabled={generating}>{generating ? 'Generating…' : '⬇ PDF report'}</button>
          </div>
        </div>

        <div className="cal-wrap">
          <div className="cal-grid cal-dow">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="cal-dow-label">{d}</div>)}
          </div>
          <div className="cal-grid">
            {cells.map((day, i) => {
              if (day === null) return <div key={'e' + i} className="cal-cell empty-cell" />;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const records = byDate[dateStr];
              const isPast = dateStr < todayStr;
              const isToday = dateStr === todayStr;
              const present = !!records;
              const absent = !present && (isPast || isToday);
              let inTime = '', outTime = '';
              if (records) {
                const sorted = records.slice().sort((a, b) => new Date(a.punch_in).getTime() - new Date(b.punch_in).getTime());
                inTime = new Date(sorted[0].punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const last = sorted[sorted.length - 1];
                outTime = last.punch_out ? new Date(last.punch_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In progress';
              }
              return (
                <div key={dateStr} className={'cal-cell' + (present ? ' present' : '') + (absent ? ' absent' : '') + (isToday ? ' today' : '')}>
                  <div className="cal-daynum">{day}</div>
                  {present && (
                    <div className="cal-times">
                      <div>{inTime}</div>
                      <div style={{ opacity: .7 }}>{outTime}</div>
                    </div>
                  )}
                  {absent && <div className="cal-absent-label">Absent</div>}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: 10.5, color: 'var(--text-faint)', justifyContent: 'center' }}>
            <span><span className="cal-legend-dot present" /> Present</span>
            <span><span className="cal-legend-dot absent" /> Absent</span>
            <span><span className="cal-legend-dot today" /> Today</span>
          </div>
        </div>
      </div>
    </>
  );
}

// =========================================================
// Wishlist — shared between Director and EA
// =========================================================
function Wishlist({ role, wishlist, addWishlistItem, toggleWishlistItem, deleteWishlistItem }: any) {
  const [text, setText] = useState('');
  const pending = (wishlist || []).filter((w: WishlistItem) => !w.done);
  const done = (wishlist || []).filter((w: WishlistItem) => w.done);

  function submit() {
    if (!text.trim()) return;
    addWishlistItem(text);
    setText('');
  }

  return (
    <>
      <div className="eyebrow">Shared</div>
      <h2>My wishlist.</h2>
      <p className="sub">Anything either of you wants to add — visible to both desks.</p>
      <div className="glass hero" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something to the wishlist..." onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <button className="acid-btn" style={{ flexShrink: 0 }} onClick={submit}>Add</button>
        </div>
      </div>
      <div className="glass card-block">
        <div className="scroll-box">
          <h3 style={{ marginBottom: 14 }}>Pending ({pending.length})</h3>
          {pending.length ? pending.map((w: WishlistItem) => (
            <div key={w.id} className="rem-item">
              <span onClick={() => toggleWishlistItem(w.id, true)} style={{ cursor: 'pointer', flex: 1 }}>
                ☐ {w.text} <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>— added by {w.added_by === 'director' ? 'Director' : 'EA'}</span>
              </span>
              <button onClick={() => deleteWishlistItem(w.id)}>✕</button>
            </div>
          )) : <div className="empty">Nothing pending.</div>}
          {done.length > 0 && (
            <>
              <h3 style={{ margin: '22px 0 14px' }}>Done ({done.length})</h3>
              {done.map((w: WishlistItem) => (
                <div key={w.id} className="rem-item" style={{ opacity: .55 }}>
                  <span onClick={() => toggleWishlistItem(w.id, false)} style={{ cursor: 'pointer', flex: 1, textDecoration: 'line-through' }}>☑ {w.text}</span>
                  <button onClick={() => deleteWishlistItem(w.id)}>✕</button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// =========================================================
// Expense — invoice/bill uploads + vendor cost comparison
// =========================================================
function ExpensePage({ role, profile, expenses, addExpense, deleteExpense, toast }: any) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<'day' | 'week' | 'month' | 'all'>('month');
  const [generating, setGenerating] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const path = `receipts/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file);
    if (upErr) { setUploading(false); toast('⚠️ Upload failed: ' + upErr.message); return; }
    const { data: pub } = supabase.storage.from('attachments').getPublicUrl(path);
    setReceiptUrl(pub.publicUrl);
    setReceiptName(file.name);
    setUploading(false);
  }

  function submitExpense() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast('Enter a valid amount.'); return; }
    addExpense({ description: desc.trim(), amount: amt, expense_date: expenseDate, receipt_url: receiptUrl, receipt_name: receiptName });
    setDesc(''); setAmount(''); setReceiptUrl(null); setReceiptName(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);

  const filtered = (expenses || []).filter((e: Expense) => {
    if (filter === 'day') return e.expense_date === todayStr;
    if (filter === 'week') return e.expense_date >= weekAgo;
    if (filter === 'month') return e.expense_date.startsWith(monthStr);
    return true;
  });
  const filteredTotal = filtered.reduce((sum: number, e: Expense) => sum + Number(e.amount), 0);

  function isImage(name?: string | null) {
    return !!name && /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
  }
  function fmtMoney(n: number) {
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  async function exportExpensePDF() {
    setGenerating(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      await import('jspdf-autotable');
      const doc = new jsPDF() as any;
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFillColor(13, 24, 38);
      doc.rect(0, 0, pageWidth, 38, 'F');
      doc.setFillColor(216, 255, 98);
      doc.roundedRect(14, 10, 18, 18, 4, 4, 'F');
      doc.setTextColor(13, 24, 38);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('D', 20.5, 22);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text('THE DESK', 38, 19);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 210, 220);
      doc.text('Expense Report', 38, 26);

      const filterLabel = { day: 'Today', week: 'Last 7 days', month: 'This month', all: 'All time' }[filter];
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 90, 90);
      doc.text('Period: ' + filterLabel, 14, 50);
      doc.text('Generated ' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }), pageWidth - 14, 50, { align: 'right' });

      const boxY = 58;
      const boxW = (pageWidth - 28 - 16) / 3;
      const summary = [
        { label: 'Total invoices', value: String(filtered.length) },
        { label: 'Total amount', value: fmtMoney(filteredTotal) },
        { label: 'Avg per invoice', value: filtered.length ? fmtMoney(filteredTotal / filtered.length) : '₹0' },
      ];
      summary.forEach((s: any, i: number) => {
        const x = 14 + i * (boxW + 8);
        doc.setFillColor(244, 241, 235);
        doc.roundedRect(x, boxY, boxW, 24, 3, 3, 'F');
        doc.setTextColor(20, 20, 20);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(s.value, x + boxW / 2, boxY + 12, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(s.label, x + boxW / 2, boxY + 19, { align: 'center' });
      });

      const rows = filtered
        .slice()
        .sort((a: Expense, b: Expense) => a.expense_date.localeCompare(b.expense_date))
        .map((e: Expense) => [
          new Date(e.expense_date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
          e.description || '—',
          e.uploaded_by === 'ea' ? 'EA' : 'Director',
          fmtMoney(Number(e.amount)),
        ]);

      doc.autoTable({
        startY: boxY + 32,
        head: [['Date', 'Description', 'Uploaded by', 'Amount']],
        body: rows,
        theme: 'plain',
        headStyles: { fillColor: [13, 24, 38], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9, textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [248, 247, 244] },
        styles: { cellPadding: 5 },
      });

      doc.save(`expenses-${filterLabel.replace(/\s/g, '-')}-${todayStr}.pdf`);
    } catch (e) {
      alert('Could not generate PDF: ' + (e as Error).message);
    }
    setGenerating(false);
  }

  return (
    <>
      <div className="eyebrow">Finance</div>
      <h2>Expense log.</h2>
      <p className="sub">Every invoice the EA uploads — visible to the Director in real time, filterable by period.</p>

      <div className="glass hero" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 14 }}>Log an expense</h3>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div className="full">
            <label className="field-label">Description</label>
            <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Courier charges, office supplies..." />
          </div>
          <div>
            <label className="field-label">Amount (₹)</label>
            <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="field-label">Date</label>
            <input className="input" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="soft-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : receiptUrl ? '✓ Receipt attached' : '📎 Attach invoice/bill'}
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFile} />
          <button className="acid-btn" style={{ marginLeft: 'auto' }} onClick={submitExpense}>Save expense →</button>
        </div>
      </div>

      <div className="glass card-block">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Expense log</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['day', 'week', 'month', 'all'] as const).map((f) => (
              <button key={f} className={filter === f ? 'acid-btn' : 'soft-btn'} style={{ padding: '7px 13px', fontSize: 11 }} onClick={() => setFilter(f)}>
                {{ day: 'Daily', week: 'Weekly', month: 'Monthly', all: 'All' }[f]}
              </button>
            ))}
            <button className="soft-btn" onClick={exportExpensePDF} disabled={generating}>{generating ? 'Generating…' : '⬇ PDF'}</button>
          </div>
        </div>
        <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 4 }}>{fmtMoney(filteredTotal)}</div>
        <div className="sub" style={{ fontSize: 12, marginBottom: 18 }}>{filtered.length} invoice{filtered.length !== 1 ? 's' : ''} in this period</div>

        <div className="scroll-box">
          {filtered.length ? filtered.map((e: Expense) => (
            <div key={e.id} className="leverage-row">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {e.receipt_url && isImage(e.receipt_name) && (
                  <a href={e.receipt_url} target="_blank" rel="noreferrer"><img src={e.receipt_url} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover' }} /></a>
                )}
                <div>
                  <div className="leverage-title">{e.description || 'Expense'}</div>
                  <div className="leverage-sub">
                    {new Date(e.expense_date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · {e.uploaded_by === 'ea' ? 'EA' : 'Director'}
                    {e.receipt_url && !isImage(e.receipt_name) && <> · <a href={e.receipt_url} target="_blank" rel="noreferrer" style={{ color: 'var(--acid)' }}>📎 receipt</a></>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <b>{fmtMoney(Number(e.amount))}</b>
                <button className="tiny-btn" onClick={() => deleteExpense(e.id)}>✕</button>
              </div>
            </div>
          )) : <div className="empty">No expenses in this period.</div>}
        </div>
      </div>
    </>
  );
}

// =========================================================
// Cost Improvement — multi-vendor comparison tickets
// Existing vendor is fixed; add several alternative vendor
// quotes, then pick the final winner to lock in the savings.
// =========================================================
function CostImprovementPage({ role, costTickets, addCostTicket, addTicketOption, selectFinalVendor, deleteCostTicket, toast }: any) {
  const [itemName, setItemName] = useState('');
  const [qty, setQty] = useState('1');
  const [existingVendor, setExistingVendor] = useState('');
  const [existingRate, setExistingRate] = useState('');

  function fmtMoney(n: number) {
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function submitTicket() {
    const q = parseFloat(qty) || 1;
    const er = parseFloat(existingRate);
    if (!itemName.trim() || !er) { toast('Enter the item name and the existing rate.'); return; }
    addCostTicket({ item_name: itemName.trim(), quantity: q, existing_vendor: existingVendor.trim(), existing_rate: er });
    setItemName(''); setQty('1'); setExistingVendor(''); setExistingRate('');
  }

  const totalSaved = (costTickets || []).reduce((sum: number, t: CostTicket) => {
    if (!t.selected_option_id) return sum;
    const opt = t.options.find((o) => o.id === t.selected_option_id);
    return opt ? sum + (t.existing_rate - opt.rate) * t.quantity : sum;
  }, 0);
  const finalizedCount = (costTickets || []).filter((t: CostTicket) => t.selected_option_id).length;

  return (
    <>
      <div className="eyebrow">Finance</div>
      <h2>Cost improvement.</h2>
      <p className="sub">Compare the current vendor against several alternatives for the same purchase — pick a winner to lock in the savings.</p>

      <div className="kpi-strip">
        <div className="kpi"><small>Savings identified</small><strong style={{ color: 'var(--mint)' }}>{fmtMoney(totalSaved)}</strong><span>from finalized tickets</span></div>
        <div className="kpi"><small>Tickets</small><strong>{finalizedCount} / {(costTickets || []).length}</strong><span>finalized</span></div>
      </div>

      <div className="glass hero" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 14 }}>New comparison ticket</h3>
        <p className="sub" style={{ fontSize: 12, marginBottom: 16 }}>Start with what you're already buying and from whom — you'll add alternative vendor quotes to it next.</p>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div className="full">
            <label className="field-label">Item / service</label>
            <input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. A4 paper (500-sheet ream)" />
          </div>
          <div>
            <label className="field-label">Quantity</label>
            <input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" />
          </div>
          <div></div>
          <div>
            <label className="field-label">Existing vendor</label>
            <input className="input" value={existingVendor} onChange={(e) => setExistingVendor(e.target.value)} placeholder="Where you buy this today" />
          </div>
          <div>
            <label className="field-label">Existing rate (₹ / unit)</label>
            <input className="input" type="number" value={existingRate} onChange={(e) => setExistingRate(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <button className="acid-btn" onClick={submitTicket}>Create ticket →</button>
      </div>

      <div className="scroll-box" style={{ maxHeight: 640 }}>
        {(costTickets || []).length ? costTickets.map((t: CostTicket) => (
          <CostTicketCard key={t.id} ticket={t} addTicketOption={addTicketOption} selectFinalVendor={selectFinalVendor} deleteCostTicket={deleteCostTicket} fmtMoney={fmtMoney} />
        )) : <div className="empty">No comparison tickets yet.</div>}
      </div>
    </>
  );
}

function CostTicketCard({ ticket, addTicketOption, selectFinalVendor, deleteCostTicket, fmtMoney }: any) {
  const [vendorName, setVendorName] = useState('');
  const [rate, setRate] = useState('');
  const finalized = !!ticket.selected_option_id;
  const selectedOption = finalized ? ticket.options.find((o: CostTicketOption) => o.id === ticket.selected_option_id) : null;
  const savings = selectedOption ? (ticket.existing_rate - selectedOption.rate) * ticket.quantity : null;

  function submitOption() {
    const r = parseFloat(rate);
    if (!vendorName.trim() || !r) return;
    addTicketOption(ticket.id, vendorName.trim(), r);
    setVendorName(''); setRate('');
  }

  return (
    <div className="glass card-block" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0 }}>{ticket.item_name} <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontSize: 14 }}>× {ticket.quantity}</span></h3>
          <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>
            Existing: <b>{ticket.existing_vendor || 'Current vendor'}</b> @ ₹{ticket.existing_rate}/unit
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {finalized && <span className="pill status-completed">✓ Finalized</span>}
          <button className="tiny-btn" onClick={() => deleteCostTicket(ticket.id)}>✕</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,.04)', borderRadius: 12, border: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5 }}>{ticket.existing_vendor || 'Current vendor'} <span style={{ color: 'var(--text-faint)' }}>(existing)</span></span>
          <b>₹{ticket.existing_rate}</b>
        </div>
        {ticket.options.map((o: CostTicketOption) => {
          const isSelected = o.id === ticket.selected_option_id;
          const optSavings = (ticket.existing_rate - o.rate) * ticket.quantity;
          return (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: isSelected ? 'rgba(101,237,189,.10)' : 'rgba(255,255,255,.04)', borderRadius: 12, border: isSelected ? '1px solid rgba(101,237,189,.4)' : '1px solid var(--line)' }}>
              <span style={{ fontSize: 12.5 }}>{o.vendor_name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: optSavings >= 0 ? 'var(--mint)' : 'var(--rose)' }}>
                  {optSavings >= 0 ? 'saves' : 'costs +'} {fmtMoney(Math.abs(optSavings))}
                </span>
                <b>₹{o.rate}</b>
                {!ticket.selected_option_id ? (
                  <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={() => selectFinalVendor(ticket.id, o.id)}>Select</button>
                ) : isSelected ? (
                  <span className="pill status-completed" style={{ padding: '3px 9px' }}>Winner</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {finalized ? (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mint)' }}>
          Finalized with {selectedOption?.vendor_name} — saved {fmtMoney(savings || 0)}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 140 }} value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Alternative vendor name" />
          <input className="input" type="number" style={{ maxWidth: 130 }} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate (₹/unit)" />
          <button className="tiny-btn" style={{ background: '#0e151d', color: '#fff' }} onClick={submitOption}>+ Add quote</button>
        </div>
      )}
    </div>
  );
}
