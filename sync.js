/**
 * Supabase sync layer — offline-first with localStorage cache.
 * Requires @supabase/supabase-js (loaded via CDN) and config.js.
 */
const NotesSync = (() => {
  const QUEUE_KEY = 'student_notes_sync_queue';
  const LAST_SYNC_KEY = 'student_notes_last_sync';

  let client = null;
  let session = null;
  let realtimeChannel = null;
  let syncRunning = false;
  let onStatusChange = null;
  let onDataChange = null;

  function isConfigured() {
    const cfg = window.SUPABASE_CONFIG;
    return !!(cfg && cfg.url && cfg.anonKey && cfg.url !== 'https://YOUR_PROJECT_REF.supabase.co');
  }

  function setStatus(status, message) {
    if (onStatusChange) onStatusChange(status, message);
  }

  function toMs(ts) {
    if (!ts) return 0;
    return typeof ts === 'number' ? ts : new Date(ts).getTime();
  }

  function toIso(ms) {
    return new Date(ms).toISOString();
  }

  function studentToRow(s, userId, deleted = false) {
    return {
      id: s.id,
      user_id: userId,
      name: s.name,
      created_at: toIso(s.createdAt),
      updated_at: toIso(s.updatedAt || s.createdAt),
      deleted_at: deleted ? new Date().toISOString() : null
    };
  }

  function noteToRow(n, userId, deleted = false) {
    return {
      id: n.id,
      user_id: userId,
      student_id: n.studentId,
      title: n.title || '',
      content: n.content || '',
      created_at: toIso(n.createdAt),
      updated_at: toIso(n.updatedAt || n.createdAt),
      deleted_at: deleted ? new Date().toISOString() : null
    };
  }

  function rowToStudent(r) {
    return {
      id: r.id,
      name: r.name,
      createdAt: toMs(r.created_at),
      updatedAt: toMs(r.updated_at),
      deletedAt: r.deleted_at ? toMs(r.deleted_at) : null
    };
  }

  function rowToNote(r) {
    return {
      id: r.id,
      studentId: r.student_id,
      title: r.title || '',
      content: r.content || '',
      createdAt: toMs(r.created_at),
      updatedAt: toMs(r.updated_at),
      deletedAt: r.deleted_at ? toMs(r.deleted_at) : null
    };
  }

  function loadQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function enqueue(type, id, payload, deleted = false) {
    if (!isConfigured()) return;
    const queue = loadQueue();
    const existing = queue.findIndex((q) => q.type === type && q.id === id);
    const item = { type, id, payload, deleted, at: Date.now() };
    if (existing >= 0) queue[existing] = item;
    else queue.push(item);
    saveQueue(queue);
    if (session) schedulePush();
  }

  function queueInitialLocalData() {
    if (localStorage.getItem(LAST_SYNC_KEY)) return;

    try {
      const parsed = JSON.parse(localStorage.getItem('student_notes_data') || '{}');
      const queue = loadQueue();

      for (const student of parsed.students || []) {
        if (!queue.some((item) => item.type === 'student' && item.id === student.id)) {
          queue.push({
            type: 'student',
            id: student.id,
            payload: student,
            deleted: false,
            at: Date.now()
          });
        }
      }

      for (const note of parsed.notes || []) {
        if (!queue.some((item) => item.type === 'note' && item.id === note.id)) {
          queue.push({
            type: 'note',
            id: note.id,
            payload: note,
            deleted: false,
            at: Date.now()
          });
        }
      }

      if (queue.length > 0) {
        queue.sort((a, b) => (a.type === b.type ? 0 : a.type === 'student' ? -1 : 1));
        saveQueue(queue);
      }
    } catch (err) {
      console.error('Could not prepare local data for first sync', err);
    }
  }

  let pushTimer = null;
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushQueue(), 800);
  }

  async function init() {
    if (!isConfigured()) return false;
    if (!window.supabase) {
      console.warn('Supabase JS not loaded');
      return false;
    }

    const cfg = window.SUPABASE_CONFIG;
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    const { data } = await client.auth.getSession();
    session = data.session;

    client.auth.onAuthStateChange((_event, newSession) => {
      session = newSession;
      if (isPermanentUser()) {
        setTimeout(() => {
          fullSync().catch(console.error);
          subscribeRealtime();
        }, 0);
      } else {
        unsubscribeRealtime();
        setStatus('auth', 'Connect to sync');
      }
    });

    if (!isPermanentUser()) {
      setStatus('auth', 'Connect to sync');
      return true;
    }

    await fullSync();
    subscribeRealtime();
    return true;
  }

  function getClient() {
    return client;
  }

  function getSession() {
    return session;
  }

  function isSignedIn() {
    return !!session;
  }

  function isPermanentUser() {
    return !!(session?.user && !session.user.is_anonymous);
  }

  async function sendMagicLink(email) {
    if (!client) throw new Error('Supabase not configured');
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Enter your email address');

    const { data, error } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + '/'
      }
    });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password) {
    if (!client) throw new Error('Supabase not configured');
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    session = data.session;
    if (session) {
      setStatus('syncing', 'Syncing…');
      await fullSync();
      subscribeRealtime();
    }
    return data;
  }

  async function signIn(email, password) {
    if (!client) throw new Error('Supabase not configured');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    session = data.session;
    setStatus('syncing', 'Syncing…');
    await fullSync();
    subscribeRealtime();
    return data;
  }

  async function signOut() {
    if (!client) return;
    unsubscribeRealtime();
    await client.auth.signOut();
    session = null;
    setStatus('auth', 'Sign in to sync');
  }

  async function connectDevices(email, password) {
    if (!client || !session) throw new Error('Sync is not ready yet');
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || String(password || '').length < 8) {
      throw new Error('Enter a valid email and a password of at least 8 characters');
    }

    // Existing account: join it. New account: upgrade the current anonymous
    // user in place so its notes keep the same user_id and never need copying.
    const signedIn = await client.auth.signInWithPassword({ email: normalizedEmail, password });
    if (!signedIn.error) {
      session = signedIn.data.session;
      await fullSync();
      subscribeRealtime();
      return { connected: true, needsConfirmation: false };
    }

    if (!session.user?.is_anonymous) throw signedIn.error;
    const { data, error } = await client.auth.updateUser({ email: normalizedEmail, password });
    if (error) throw error;
    session = data.user ? { ...session, user: data.user } : session;
    return { connected: false, needsConfirmation: true };
  }

  function mergeRecords(localItems, remoteItems) {
    const map = new Map();

    for (const item of localItems) {
      map.set(item.id, { ...item });
    }

    for (const remote of remoteItems) {
      const existing = map.get(remote.id);
      if (!existing) {
        if (!remote.deletedAt) map.set(remote.id, remote);
        continue;
      }
      const localTs = existing.updatedAt || existing.createdAt || 0;
      const remoteTs = remote.updatedAt || remote.createdAt || 0;
      if (remoteTs >= localTs) {
        if (remote.deletedAt) map.delete(remote.id);
        else map.set(remote.id, remote);
      }
    }

    return Array.from(map.values());
  }

  async function pullRemote() {
    if (!client || !session) return { students: [], notes: [] };

    const [studentsRes, notesRes] = await Promise.all([
      client.from('students').select('*').eq('user_id', session.user.id),
      client.from('notes').select('*').eq('user_id', session.user.id)
    ]);

    if (studentsRes.error) throw studentsRes.error;
    if (notesRes.error) throw notesRes.error;

    const students = (studentsRes.data || [])
      .map(rowToStudent)
      .filter((s) => !s.deletedAt);
    const notes = (notesRes.data || [])
      .map(rowToNote)
      .filter((n) => !n.deletedAt);

    return { students, notes };
  }

  async function pushQueue() {
    if (!client || !session || syncRunning) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    syncRunning = true;
    setStatus('syncing', 'Syncing…');

    const remaining = [];
    const userId = session.user.id;

    for (const item of queue) {
      try {
        if (item.type === 'student') {
          const row = studentToRow(item.payload, userId, item.deleted);
          if (item.deleted) {
            await client.from('students').delete().eq('id', item.id).eq('user_id', userId);
          } else {
            const { error } = await client.from('students').upsert(row, { onConflict: 'id' });
            if (error) throw error;
          }
        } else if (item.type === 'note') {
          const row = noteToRow(item.payload, userId, item.deleted);
          if (item.deleted) {
            await client.from('notes').delete().eq('id', item.id).eq('user_id', userId);
          } else {
            const { error } = await client.from('notes').upsert(row, { onConflict: 'id' });
            if (error) throw error;
          }
        }
      } catch (err) {
        console.error('Sync push failed', item, err);
        remaining.push(item);
      }
    }

    saveQueue(remaining);
    syncRunning = false;

    if (remaining.length === 0) {
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      setStatus('synced', 'Synced');
    } else {
      setStatus('error', 'Sync pending');
    }
  }

  async function fullSync() {
    if (!client || !session) return null;

    setStatus('syncing', 'Syncing…');
    try {
      queueInitialLocalData();
      await pushQueue();

      const remote = await pullRemote();
      const localRaw = localStorage.getItem('student_notes_data');
      let localStudents = [];
      let localNotes = [];

      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        localStudents = parsed.students || [];
        localNotes = parsed.notes || [];
      }

      const mergedStudents = mergeRecords(localStudents, remote.students);
      const mergedNotes = mergeRecords(localNotes, remote.notes);

      localStorage.setItem(
        'student_notes_data',
        JSON.stringify({ students: mergedStudents, notes: mergedNotes })
      );
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      setStatus('synced', 'Synced');

      if (onDataChange) onDataChange({ students: mergedStudents, notes: mergedNotes });
      return { students: mergedStudents, notes: mergedNotes };
    } catch (err) {
      console.error('Full sync failed', err);
      setStatus('error', 'Sync failed');
      throw err;
    }
  }

  function trackStudent(student, deleted = false) {
    if (!student) return;
    const payload = {
      ...student,
      updatedAt: student.updatedAt || student.createdAt || Date.now()
    };
    enqueue('student', student.id, payload, deleted);
  }

  function trackNote(note, deleted = false) {
    if (!note) return;
    const payload = {
      ...note,
      updatedAt: note.updatedAt || note.createdAt || Date.now()
    };
    enqueue('note', note.id, payload, deleted);
  }

  function subscribeRealtime() {
    if (!client || !session) return;
    unsubscribeRealtime();

    realtimeChannel = client
      .channel('notes-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'students', filter: `user_id=eq.${session.user.id}` },
        () => fullSync().catch(console.error)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${session.user.id}` },
        () => fullSync().catch(console.error)
      )
      .subscribe();
  }

  function unsubscribeRealtime() {
    if (realtimeChannel && client) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  function onStatus(cb) {
    onStatusChange = cb;
  }

  function onRemoteData(cb) {
    onDataChange = cb;
  }

  window.addEventListener('online', () => {
    if (session) pushQueue().catch(console.error);
  });

  return {
    isConfigured,
    init,
    getClient,
    getSession,
    isSignedIn,
    isPermanentUser,
    sendMagicLink,
    signUp,
    signIn,
    signOut,
    connectDevices,
    fullSync,
    trackStudent,
    trackNote,
    onStatus,
    onRemoteData
  };
})();
