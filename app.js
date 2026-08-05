const DB_KEY = 'student_notes_data';
const CURRENT_STUDENT_KEY = 'current_student_id';
const THEME_KEY = 'theme';

let students = [];
let notes = [];
let currentStudentId = null;
let currentNoteId = null;
let persistTimeout = null;
let editorSaveTimeout = null;
let searchTimeout = null;
let currentTheme = 'light';
let activeView = 'students';

function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      students = Array.isArray(data.students) ? data.students : [];
      notes = Array.isArray(data.notes) ? data.notes : [];
    }
    currentStudentId = localStorage.getItem(CURRENT_STUDENT_KEY) || null;
    if (currentStudentId && !students.some((s) => s.id === currentStudentId)) {
      currentStudentId = null;
      persistStudentId();
    }
  } catch (e) {
    console.error('Failed to load data', e);
    students = [];
    notes = [];
  }
}

function applyRemoteData(data) {
  students = data.students || [];
  notes = data.notes || [];
  if (currentStudentId && !students.some((s) => s.id === currentStudentId)) {
    currentStudentId = students[0]?.id || null;
    persistStudentId();
  }
  refreshCurrentView();
}

function saveData(immediate = false) {
  clearTimeout(persistTimeout);

  const doSave = () => {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify({ students, notes }));
    } catch (e) {
      console.error('Failed to save data', e);
      if (e.name === 'QuotaExceededError') {
        alert('Storage is full. Please delete some notes.');
      }
    }
  };

  if (immediate) doSave();
  else persistTimeout = setTimeout(doSave, 500);
}

function persistStudentId() {
  if (currentStudentId) localStorage.setItem(CURRENT_STUDENT_KEY, currentStudentId);
  else localStorage.removeItem(CURRENT_STUDENT_KEY);
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') {
    currentTheme = saved;
  } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    currentTheme = 'dark';
  }
  applyTheme();
}

function saveTheme() {
  localStorage.setItem(THEME_KEY, currentTheme);
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', currentTheme === 'dark' ? '#0f172a' : '#ffffff');
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  saveTheme();
  applyTheme();
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getStudentNotes(studentId) {
  return notes
    .filter((n) => n.studentId === studentId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getCurrentStudent() {
  return students.find((s) => s.id === currentStudentId) || null;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || tmp.innerText || '').trim();
}

function getNotePreview(note) {
  const text = stripHtml(note.content);
  return text.slice(0, 120) || 'Empty note';
}

function isNoteEmpty(note) {
  if (!note) return true;
  return !note.title?.trim() && !stripHtml(note.content);
}

function refreshCurrentView() {
  if (activeView === 'students') renderStudents();
  else if (activeView === 'notes') renderNotes();
  else if (activeView === 'editor' && currentNoteId) {
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note) {
      currentNoteId = null;
      showView('notes');
    }
  } else if (activeView === 'reader' && currentNoteId) {
    const note = notes.find((n) => n.id === currentNoteId);
    if (note) openReader(false);
    else showView('notes');
  }
  const title = document.getElementById('header-title');
  if (title) {
    if (activeView === 'students') title.textContent = 'Student Notes';
    else if (activeView === 'notes') updateHeader();
    else if (activeView === 'editor') title.textContent = 'Edit Note';
    else if (activeView === 'reader') title.textContent = 'Reading Mode';
  }
}

function showView(name) {
  activeView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + name)?.classList.add('active');

  const backBtn = document.getElementById('header-back');
  const deleteBtn = document.getElementById('delete-note-btn');
  const editBtn = document.getElementById('edit-note-btn');
  const fab = document.getElementById('fab');

  if (name === 'students') {
    backBtn.style.display = 'none';
    deleteBtn.style.display = 'none';
    editBtn.style.display = 'none';
    fab.style.display = 'flex';
    fab.onclick = openAddStudent;
    document.getElementById('header-title').textContent = 'Student Notes';
    renderStudents();
  } else if (name === 'notes') {
    backBtn.style.display = 'block';
    backBtn.onclick = () => showView('students');
    deleteBtn.style.display = 'none';
    editBtn.style.display = 'none';
    fab.style.display = 'flex';
    fab.onclick = openAddNote;
    updateHeader();
    renderNotes();
  } else if (name === 'editor') {
    backBtn.style.display = 'block';
    deleteBtn.style.display = 'block';
    editBtn.style.display = 'none';
    fab.style.display = 'none';
    backBtn.onclick = closeEditor;
    document.getElementById('header-title').textContent = 'Edit Note';
  } else if (name === 'reader') {
    backBtn.style.display = 'block';
    deleteBtn.style.display = 'none';
    editBtn.style.display = 'block';
    fab.style.display = 'none';
    backBtn.onclick = closeReader;
    document.getElementById('header-title').textContent = 'Reading Mode';
  }
}

function showModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;
  overlay.classList.add('show');
  const input = overlay.querySelector('input[type="text"], input[type="email"], input[type="password"]');
  if (input) setTimeout(() => input.focus(), 300);
}

function hideModal(modalId) {
  document.getElementById(modalId)?.classList.remove('show');
}

function openAddStudent() {
  const input = document.getElementById('student-name-input');
  if (input) input.value = '';
  showModal('modal-student');
}

function addStudent() {
  const input = document.getElementById('student-name-input');
  const name = input.value.trim();
  if (!name) return;

  const normalized = name.toLowerCase();
  if (students.some((s) => s.name.toLowerCase() === normalized)) {
    alert('A student with this name already exists.');
    return;
  }

  const student = {
    id: generateId(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  students.push(student);
  saveData(true);
  NotesSync.trackStudent(student);
  hideModal('modal-student');
  renderStudents();
}

function deleteStudent(id) {
  if (!confirm('Delete this student and all their notes?')) return;

  const student = students.find((s) => s.id === id);
  const removedNotes = notes.filter((n) => n.studentId === id);
  students = students.filter((s) => s.id !== id);
  notes = notes.filter((n) => n.studentId !== id);

  if (student) NotesSync.trackStudent({ ...student, updatedAt: Date.now() }, true);
  removedNotes.forEach((n) => NotesSync.trackNote(n, true));

  if (currentStudentId === id) {
    currentStudentId = null;
    persistStudentId();
  }
  saveData(true);
  renderStudents();
}

function selectStudent(id) {
  currentStudentId = id;
  persistStudentId();
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  showView('notes');
}

function updateHeader() {
  const student = getCurrentStudent();
  const title = document.getElementById('header-title');
  if (title) title.textContent = student ? student.name : 'Student Notes';
}

function renderStudents() {
  const container = document.getElementById('students-list');
  if (!container) return;

  if (students.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">👥</div>
        <h2>No students yet</h2>
        <p>Add your first student to get started</p>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  students.forEach((s) => {
    const count = getStudentNotes(s.id).length;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.position = 'relative';
    card.innerHTML = `
      <button class="card-delete" title="Delete student">&times;</button>
      <h3>${escapeHtml(s.name)}</h3>
      <div class="meta">${count} note${count !== 1 ? 's' : ''} · Added ${formatDate(s.createdAt)}</div>`;
    card.addEventListener('click', () => selectStudent(s.id));
    card.querySelector('.card-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteStudent(s.id);
    });
    frag.appendChild(card);
  });
  container.replaceChildren(frag);
}

function renderNotes(searchQuery) {
  const container = document.getElementById('notes-list');
  if (!container) return;

  const student = getCurrentStudent();
  if (!student) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📚</div>
        <h2>No student selected</h2>
        <p>Select a student to view their notes</p>
      </div>`;
    return;
  }

  const query = searchQuery ?? document.getElementById('search-input')?.value.trim() ?? '';
  let studentNotes = getStudentNotes(student.id);

  if (query) {
    const q = query.toLowerCase();
    studentNotes = studentNotes.filter((n) => {
      const text = ((n.title || '') + ' ' + stripHtml(n.content)).toLowerCase();
      return text.includes(q);
    });
  }

  const listHeader = document.getElementById('notes-list-header');
  if (listHeader) {
    listHeader.innerHTML = `
      <div class="list-header">
        <h2>${escapeHtml(student.name)}'s Notes</h2>
        <span class="badge">${studentNotes.length}</span>
      </div>`;
  }

  if (studentNotes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📝</div>
        <h2>${query ? 'No matches' : 'No notes yet'}</h2>
        <p>${query ? 'Try a different search term' : 'Tap + to create the first note'}</p>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  studentNotes.forEach((n) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${escapeHtml(n.title || 'Untitled')}</h3>
      <p>${escapeHtml(getNotePreview(n))}</p>
      <div class="meta">Updated ${formatDate(n.updatedAt)}</div>`;
    card.addEventListener('click', () => openNoteForReading(n.id));
    frag.appendChild(card);
  });
  container.replaceChildren(frag);
}

function openAddNote() {
  const student = getCurrentStudent();
  if (!student) {
    alert('Please select a student first');
    return;
  }

  const note = {
    id: generateId(),
    studentId: student.id,
    title: '',
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  notes.push(note);
  saveData(true);
  NotesSync.trackNote(note);
  openNote(note.id);
}

function openNoteForReading(id) {
  currentNoteId = id;
  openReader(false);
}

function openNote(id) {
  currentNoteId = id;
  const note = notes.find((n) => n.id === id);
  if (!note) return;

  document.getElementById('note-title').value = note.title || '';
  document.getElementById('editor-content').innerHTML = note.content || '';
  showView('editor');
}

function saveCurrentNote(immediate = false) {
  if (!currentNoteId) return;
  const note = notes.find((n) => n.id === currentNoteId);
  if (!note) return;

  const titleInput = document.getElementById('note-title');
  const contentInput = document.getElementById('editor-content');

  if (titleInput) note.title = titleInput.value;
  if (contentInput) note.content = contentInput.innerHTML;
  note.updatedAt = Date.now();

  saveData(immediate);
  NotesSync.trackNote(note);
}

function removeNoteById(id) {
  const note = notes.find((n) => n.id === id);
  notes = notes.filter((n) => n.id !== id);
  saveData(true);
  if (note) NotesSync.trackNote(note, true);
}

function closeEditor() {
  if (currentNoteId) {
    saveCurrentNote(true);
    const note = notes.find((n) => n.id === currentNoteId);
    if (isNoteEmpty(note)) removeNoteById(currentNoteId);
  }
  currentNoteId = null;
  showView('notes');
}

function openReader(saveFirst = true) {
  if (saveFirst) saveCurrentNote(true);
  const note = notes.find((n) => n.id === currentNoteId);
  if (!note) return;

  document.getElementById('reader-title').textContent = note.title || 'Untitled';
  document.getElementById('reader-content').innerHTML =
    note.content || '<p class="empty-note">Empty note</p>';
  showView('reader');
}

function closeReader() {
  showView('notes');
}

function deleteCurrentNote() {
  if (!currentNoteId) return;
  if (!confirm('Delete this note?')) return;
  removeNoteById(currentNoteId);
  currentNoteId = null;
  showView('notes');
}

function execFormat(command, value = null) {
  document.getElementById('editor-content').focus();
  document.execCommand(command, false, value);
  saveCurrentNote(false);
}

function changeFontSize(delta) {
  const editor = document.getElementById('editor-content');
  editor.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
    return;
  }

  const container =
    range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode;
  container.querySelectorAll('span').forEach((span) => {
    const currentSize = parseFloat(window.getComputedStyle(span).fontSize) || 16;
    const newSize = Math.max(12, Math.min(36, currentSize + delta));
    span.style.fontSize = newSize + 'px';
  });
  saveCurrentNote(false);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function handleSearch(e) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderNotes(e.target.value.trim()), 150);
}

function updateSyncStatus(status, message) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.dataset.status = status;
  el.textContent = status === 'synced' ? 'Sync' : message;
  el.title = message;
}

function openAuthModal() {
  document.getElementById('auth-error').textContent = '';
  showModal('modal-auth');
}

async function handleSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  try {
    await NotesSync.signIn(email, password);
    hideModal('modal-auth');
    loadData();
    refreshCurrentView();
  } catch (err) {
    errEl.textContent = err.message || 'Sign in failed';
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  if (password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters';
    return;
  }
  try {
    const data = await NotesSync.signUp(email, password);
    if (!data.session) {
      errEl.textContent = 'Check your email to confirm your account, then sign in.';
      return;
    }
    hideModal('modal-auth');
    loadData();
    refreshCurrentView();
  } catch (err) {
    errEl.textContent = err.message || 'Sign up failed';
  }
}

async function handleSignOut() {
  await NotesSync.signOut();
}

function openDeviceSync() {
  const message = document.getElementById('device-sync-message');
  if (message) message.textContent = '';
  showModal('modal-device-sync');
}

async function connectDevices() {
  const email = document.getElementById('sync-email-input')?.value || '';
  const password = document.getElementById('sync-password-input')?.value || '';
  const message = document.getElementById('device-sync-message');
  const button = document.getElementById('device-sync-submit');
  if (button) button.disabled = true;
  if (message) message.textContent = 'Connecting…';
  try {
    const result = await NotesSync.connectDevices(email, password);
    if (result.needsConfirmation) {
      if (message) message.textContent = 'Check your email to confirm once. Then use these details on every device.';
    } else {
      if (message) message.textContent = 'Connected. This device now shares the same notes.';
      updateSyncStatus('synced', 'Sync');
      setTimeout(() => hideModal('modal-device-sync'), 1200);
    }
  } catch (error) {
    if (message) message.textContent = error?.message || 'Could not connect this device.';
  } finally {
    if (button) button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadData();
  loadTheme();

  if (!currentStudentId && students.length > 0) {
    currentStudentId = students[0].id;
    persistStudentId();
  }

  updateHeader();

  document.getElementById('modal-student')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal('modal-student');
  });
  document.getElementById('modal-device-sync')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideModal('modal-device-sync');
  });

  document.getElementById('student-name-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addStudent();
  });

  document.getElementById('search-input')?.addEventListener('input', handleSearch);

  document.getElementById('editor-content')?.addEventListener('input', () => {
    clearTimeout(editorSaveTimeout);
    editorSaveTimeout = setTimeout(() => saveCurrentNote(false), 400);
  });

  document.getElementById('note-title')?.addEventListener('input', () => {
    clearTimeout(editorSaveTimeout);
    editorSaveTimeout = setTimeout(() => saveCurrentNote(false), 400);
  });

  window.addEventListener('beforeunload', () => {
    if (currentNoteId) saveCurrentNote(true);
  });

  showView('students');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
      installBtn.style.display = 'flex';
      installBtn.addEventListener('click', async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') installBtn.style.display = 'none';
        deferredPrompt = null;
      });
    }
  });

  if (typeof NotesSync !== 'undefined') {
    NotesSync.onStatus(updateSyncStatus);
    NotesSync.onRemoteData(applyRemoteData);
    if (NotesSync.isConfigured()) {
      try {
        await NotesSync.init();
      } catch (err) {
        console.error('Supabase connection failed', err);
        updateSyncStatus('error', 'Sync unavailable');
      }
    } else {
      updateSyncStatus('offline', 'Local only');
    }
  }
});
