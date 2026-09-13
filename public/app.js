const state = { tasks: [], projects: [], stats: {}, view: 'all', project: '', query: '', priority: '', sort: 'smart', editingId: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const el = {
  taskList: $('#taskList'), empty: $('#emptyState'), projectList: $('#projectList'), projectOptions: $('#projectOptions'),
  modal: $('#taskModal'), backdrop: $('#modalBackdrop'), form: $('#taskForm'), toast: $('#toast'), search: $('#searchInput')
};

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

async function load() {
  try {
    const [tasks, projects, stats] = await Promise.all([api('/api/tasks'), api('/api/projects'), api('/api/stats')]);
    state.tasks = tasks.tasks; state.projects = projects.projects; state.stats = stats;
    render();
  } catch (error) { showToast(error.message, true); }
}

function render() {
  renderHeader();
  renderStats();
  renderProjects();
  renderTasks();
  window.dispatchEvent(new CustomEvent('guide:tasks-rendered', {
    detail: { tasks: state.tasks, stats: state.stats }
  }));
}

function renderHeader() {
  const now = new Date();
  $('#dateLabel').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const labels = { all: ['All tasks', 'Make today count.', 'A little progress adds up. Here’s what needs your attention.'], today: ['Today', 'Focus on today.', 'A manageable list for the hours ahead.'], upcoming: ['Upcoming', 'See what’s next.', 'Plan with enough room to do your best work.'], completed: ['Completed', 'Progress, captured.', 'Everything you’ve already moved forward.'] };
  const [crumb, title, sub] = state.project ? [state.project, `${state.project} projects`, 'Tasks collected around one shared goal.'] : labels[state.view];
  $('#breadcrumb').textContent = crumb; $('#viewTitle').textContent = title; $('#viewSubtitle').textContent = sub;
  $('#listHeading').textContent = crumb; $('#listDescription').textContent = state.project ? `Tasks in ${state.project}.` : labels[state.view][2];
  $$('.nav-item').forEach((button) => button.classList.toggle('is-active', !state.project && button.dataset.view === state.view));
}

function renderStats() {
  const stats = state.stats;
  $('#activeStat').textContent = stats.active || 0; $('#todayStat').textContent = stats.dueToday || 0;
  $('#completedStat').textContent = stats.completed || 0; $('#overdueStat').textContent = stats.overdue || 0;
  $('#allCount').textContent = stats.active || 0; $('#todayCount').textContent = stats.dueToday || 0;
  $('#activeNote').textContent = stats.active === 1 ? 'One clear next step' : 'Stay in motion';
}

function renderProjects() {
  el.projectList.replaceChildren(); el.projectOptions.replaceChildren();
  state.projects.forEach((project) => {
    const item = document.createElement('button'); item.className = `project-item ${state.project === project.name ? 'is-selected' : ''}`;
    item.innerHTML = `<span class="project-dot ${projectClass(project.name)}"></span><span>${escapeHTML(project.name)}</span><b>${project.active}</b>`;
    item.addEventListener('click', () => { state.project = project.name; state.view = 'all'; render(); }); el.projectList.append(item);
    const option = document.createElement('option'); option.value = project.name; el.projectOptions.append(option);
  });
}

function visibleTasks() {
  const today = dateKey(); const nextWeek = dateKey(7); const needle = state.query.toLowerCase();
  const priorityWeight = { high: 0, medium: 1, low: 2 };
  return state.tasks.filter((task) => {
    const inView = state.project ? task.project === state.project : state.view === 'completed' ? task.completed : state.view === 'today' ? !task.completed && task.dueDate === today : state.view === 'upcoming' ? !task.completed && task.dueDate > today && task.dueDate <= nextWeek : state.view === 'all' ? true : true;
    return inView && (!state.priority || task.priority === state.priority) && (!needle || `${task.title} ${task.project} ${task.notes}`.toLowerCase().includes(needle));
  }).sort((a, b) => {
    if (state.sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
    if (state.sort === 'priority') return priorityWeight[a.priority] - priorityWeight[b.priority];
    if (state.sort === 'due') return dueTime(a) - dueTime(b);
    return Number(a.completed) - Number(b.completed) || dueTime(a) - dueTime(b) || priorityWeight[a.priority] - priorityWeight[b.priority];
  });
}

function renderTasks() {
  const tasks = visibleTasks(); el.taskList.replaceChildren(); el.empty.hidden = tasks.length !== 0;
  tasks.forEach((task) => el.taskList.append(taskRow(task)));
}

function taskRow(task) {
  const row = document.createElement('article'); row.className = `task-card ${task.completed ? 'is-complete' : ''}`;
  const due = dueLabel(task.dueDate); const notes = task.notes ? `<p class="task-notes">${escapeHTML(task.notes)}</p>` : '';
  row.innerHTML = `<button class="check ${task.completed ? 'checked' : ''}" aria-label="Mark ${escapeHTML(task.title)} ${task.completed ? 'active' : 'complete'}">${task.completed ? '✓' : ''}</button><div class="task-main"><div class="task-title-row"><h3>${escapeHTML(task.title)}</h3><span class="priority ${task.priority}"><i></i>${task.priority}</span></div>${notes}<div class="task-meta"><span><i class="project-dot ${projectClass(task.project)}"></i>${escapeHTML(task.project)}</span>${due ? `<span class="due ${due.className}">${due.icon} ${due.text}</span>` : ''}</div></div><button class="more-button" aria-label="Edit ${escapeHTML(task.title)}">•••</button>`;
  row.querySelector('.check').addEventListener('click', (event) => { event.stopPropagation(); updateTask(task.id, { completed: !task.completed }, task.completed ? 'Task reopened' : 'Task completed'); });
  row.querySelector('.more-button').addEventListener('click', (event) => { event.stopPropagation(); openModal(task); }); row.addEventListener('click', () => openModal(task));
  return row;
}

function dueLabel(value) {
  if (!value) return null;
  const today = dateKey(); const tomorrow = dateKey(1);
  if (value < today) return { text: `Overdue · ${formatDate(value)}`, icon: '!', className: 'overdue' };
  if (value === today) return { text: 'Due today', icon: '◷', className: 'today' };
  if (value === tomorrow) return { text: 'Due tomorrow', icon: '◷', className: '' };
  return { text: formatDate(value), icon: '◷', className: '' };
}

function openModal(task = null) {
  state.editingId = task?.id || null; $('#modalEyebrow').textContent = task ? 'EDIT TASK' : 'NEW TASK'; $('#modalTitle').textContent = task ? 'Edit task' : 'Add a task';
  $('#taskId').value = task?.id || ''; $('#taskTitle').value = task?.title || ''; $('#taskProject').value = task?.project || state.project || ''; $('#taskDueDate').value = task?.dueDate || ''; $('#taskPriority').value = task?.priority || 'medium'; $('#taskNotes').value = task?.notes || ''; $('#taskCompleted').checked = task?.completed || false; $('#deleteTask').hidden = !task;
  el.backdrop.hidden = false; el.modal.showModal(); setTimeout(() => $('#taskTitle').focus(), 20);
}

function closeModal() { el.modal.close(); el.backdrop.hidden = true; state.editingId = null; }

async function saveForm(event) {
  event.preventDefault(); const id = $('#taskId').value;
  const payload = { title: $('#taskTitle').value, project: $('#taskProject').value, dueDate: $('#taskDueDate').value, priority: $('#taskPriority').value, notes: $('#taskNotes').value, completed: $('#taskCompleted').checked };
  const button = $('#saveTask'); button.disabled = true; button.textContent = 'Saving…';
  try { await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); closeModal(); await load(); showToast(id ? 'Task updated' : 'Task added'); }
  catch (error) { showToast(error.message, true); } finally { button.disabled = false; button.textContent = 'Save task'; }
}

async function updateTask(id, update, message) { try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(update) }); await load(); showToast(message); } catch (error) { showToast(error.message, true); } }
async function removeTask() { const id = $('#taskId').value; if (!id || !confirm('Delete this task permanently?')) return; try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); closeModal(); await load(); showToast('Task deleted'); } catch (error) { showToast(error.message, true); } }

function showToast(message, isError = false) { el.toast.textContent = message; el.toast.className = `toast show ${isError ? 'error' : ''}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { el.toast.className = 'toast'; }, 3000); }
function dateKey(offset = 0) { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function dueTime(task) { return task.dueDate ? new Date(`${task.dueDate}T12:00`).getTime() : Number.MAX_SAFE_INTEGER; }
function formatDate(value) { return new Date(`${value}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function projectClass(name) { return ['coral', 'blue', 'gold', 'green', 'purple'][[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5]; }
function escapeHTML(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }

$$('.nav-item').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; state.project = ''; render(); }));
$('#newTaskButton').addEventListener('click', () => openModal()); $('#addTaskTop').addEventListener('click', () => openModal()); $('#addEmpty').addEventListener('click', () => openModal());
$('#quickProject').addEventListener('click', () => { const project = prompt('Name your new project'); if (project) { state.project = project.trim(); render(); openModal(); } });
$('#closeModal').addEventListener('click', closeModal); $('#cancelModal').addEventListener('click', closeModal); el.backdrop.addEventListener('click', closeModal); el.form.addEventListener('submit', saveForm); $('#deleteTask').addEventListener('click', removeTask);
$('#filterButton').addEventListener('click', () => { const panel = $('#filterPanel'); panel.hidden = !panel.hidden; }); $('#priorityFilter').addEventListener('change', (event) => { state.priority = event.target.value; renderTasks(); }); $('#sortSelect').addEventListener('change', (event) => { state.sort = event.target.value; renderTasks(); }); $('#clearFilters').addEventListener('click', () => { state.priority = ''; state.sort = 'smart'; $('#priorityFilter').value = ''; $('#sortSelect').value = 'smart'; renderTasks(); });
let searchTimer; el.search.addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = event.target.value; renderTasks(); }, 120); });
$('#themeToggle').addEventListener('click', () => document.body.classList.toggle('dark')); $('#mobileMenu').addEventListener('click', () => document.body.classList.toggle('menu-open'));
window.addEventListener('keydown', (event) => { if (event.key === 'n' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); openModal(); } if (event.key === 'Escape') closeModal(); });
load();
