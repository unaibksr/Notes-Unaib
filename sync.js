/**
 * Supabase sync layer — offline-first with localStorage cache.
 * Requires @supabase/supabase-js (loaded via CDN) and config.js.
 */
const NotesSync = (() => {
  const QUEUE_KEY = 'student_notes_sync_queue';
  const LAST_SYNC_KEY = 'student_notes_last_sync';
  const SHARED_SYNC_KEY = 'student_notes_shared_sync_v1';
  const SHARED_USER_ID = 'ee6bf612-7aae-450c-a3d7-53aa97a513fc';

  let client = null;
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
    if (client) schedulePush();
  }

  function queueInitialLocalData() {
    if (localStorage.getItem(SHARED_SYNC_KEY)) return;

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
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    await fullSync();
    subscribeRealtime();
    return true;
  }

  function getClient() {
    return client;
  }

  function isSignedIn() {
    return !!client;
  }

  function isPermanentUser() {
    return !!client;
  }

  async function pullRemote() {
    if (!client) return { students: [], notes: [] };

    const [studentsRes, notesRes] = await Promise.all([
      client.from('students').select('*').eq('user_id', SHARED_USER_ID),
      client.from('notes').select('*').eq('user_id', SHARED_USER_ID)
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
    if (!client || syncRunning) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    syncRunning = true;
    setStatus('syncing', 'Syncing…');

    const remaining = [];
    const userId = SHARED_USER_ID;

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
      localStorage.setItem(SHARED_SYNC_KEY, String(Date.now()));
      setStatus('synced', 'Synced');
    } else {
      setStatus('error', 'Sync pending');
    }
  }

  async function fullSync() {
    if (!client) return null;

    setStatus('syncing', 'Syncing…');
    try {
      queueInitialLocalData();
      await pushQueue();

      const remote = await pullRemote();
      localStorage.setItem(
        'student_notes_data',
        JSON.stringify({ students: remote.students, notes: remote.notes })
      );
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      // Mark every successful first pull, including an empty local device, so
      // downloaded records are never mistaken for unsynced local additions.
      localStorage.setItem(SHARED_SYNC_KEY, String(Date.now()));
      setStatus('synced', 'Synced');

      if (onDataChange) onDataChange(remote);
      return remote;
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
    if (!client) return;
    unsubscribeRealtime();

    realtimeChannel = client
      .channel('notes-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'students' },
        () => fullSync().catch(console.error)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes' },
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
    if (client) fullSync().catch(console.error);
  });

  return {
    isConfigured,
    init,
    getClient,
    isSignedIn,
    isPermanentUser,
    fullSync,
    trackStudent,
    trackNote,
    onStatus,
    onRemoteData
  };
})();
