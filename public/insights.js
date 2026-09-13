/* Planning companion: turns the current task list into small, useful signals. */
const insightElements = {
  score: document.querySelector('#focusScore'),
  progress: document.querySelector('#focusProgress'),
  message: document.querySelector('#focusMessage'),
  upcoming: document.querySelector('#upcomingList'),
  activity: document.querySelector('#activityList'),
  json: document.querySelector('#exportJson'),
  csv: document.querySelector('#exportCsv'),
  refresh: document.querySelector('#refreshActivity')
};

let cachedTasks = [];
let cachedStats = {};

function insightDateKey(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date(`${insightDateKey()}T12:00:00`);
  const date = new Date(`${dateValue}T12:00:00`);
  return Math.round((date - today) / 86400000);
}

function escaped(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function focusCalculation(tasks, stats) {
  const active = tasks.filter((task) => !task.completed);
  const high = active.filter((task) => task.priority === 'high').length;
  const noDate = active.filter((task) => !task.dueDate).length;
  const overdue = stats.overdue || 0;
  const completionRate = tasks.length ? stats.completed / tasks.length : 0;
  const workloadPenalty = Math.min(active.length * 2, 24);
  const urgencyPenalty = Math.min((overdue * 13) + (high * 3), 40);
  const clarityPenalty = Math.min(noDate * 2, 14);
  const consistencyReward = Math.round(completionRate * 14);
  const score = Math.max(0, Math.min(100, 100 - workloadPenalty - urgencyPenalty - clarityPenalty + consistencyReward));
  return { score, active: active.length, high, noDate, overdue };
}

function focusCopy(result) {
  if (result.active === 0) return 'A clear slate. Add one meaningful next step when you’re ready.';
  if (result.overdue > 0) return `${result.overdue} overdue task${result.overdue === 1 ? '' : 's'} need a quick decision.`;
  if (result.high > 3) return 'Your priority list is crowded. Choose one high-impact task first.';
  if (result.noDate > 4) return 'A few dates would make this plan even easier to trust.';
  if (result.score > 80) return 'Your workload looks focused and well balanced.';
  return 'A steady plan. Keep the next action small and specific.';
}

function renderFocus(tasks, stats) {
  const result = focusCalculation(tasks, stats);
  insightElements.score.textContent = result.score;
  insightElements.progress.style.width = `${result.score}%`;
  insightElements.message.textContent = focusCopy(result);
}

function relativeDueDate(task) {
  const days = daysUntil(task.dueDate);
  if (days === null) return 'No due date';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

function taskDueTime(task) {
  return task.dueDate ? new Date(`${task.dueDate}T12:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
}

function renderUpcoming(tasks) {
  const start = insightDateKey();
  const end = insightDateKey(7);
  const upcoming = tasks
    .filter((task) => !task.completed && task.dueDate && task.dueDate >= start && task.dueDate <= end)
    .sort((first, second) => taskDueTime(first) - taskDueTime(second))
    .slice(0, 4);
  insightElements.upcoming.replaceChildren();
  if (!upcoming.length) {
    const empty = document.createElement('p');
    empty.className = 'side-empty';
    empty.textContent = 'Nothing due in the next week.';
    insightElements.upcoming.append(empty);
    return;
  }
  upcoming.forEach((task) => {
    const row = document.createElement('div');
    const stateClass = daysUntil(task.dueDate) === 0 ? 'today' : daysUntil(task.dueDate) < 0 ? 'late' : '';
    row.className = 'upcoming-row';
    row.innerHTML = `<i class="priority-dot ${escaped(task.priority)}"></i><div><strong>${escaped(task.title)}</strong><span>${escaped(task.project)}</span></div><time class="${stateClass}">${relativeDueDate(task)}</time>`;
    insightElements.upcoming.append(row);
  });
}

function relativeTime(isoDate) {
  const delta = Math.max(0, Date.now() - new Date(isoDate).getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function activitySentence(item) {
  const verbs = {
    created: 'Added',
    updated: 'Updated',
    completed: 'Completed',
    deleted: 'Removed'
  };
  return verbs[item.type] || 'Changed';
}

async function fetchActivity() {
  insightElements.refresh.disabled = true;
  try {
    const response = await fetch('/api/activity?limit=6');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load activity.');
    renderActivity(data.activity);
  } catch (error) {
    insightElements.activity.innerHTML = '<p class="side-empty">Activity will appear after your first change.</p>';
  } finally {
    insightElements.refresh.disabled = false;
  }
}

function renderActivity(items) {
  insightElements.activity.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'side-empty';
    empty.textContent = 'Your changes will show up here.';
    insightElements.activity.append(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'activity-row';
    row.innerHTML = `<span class="activity-icon ${escaped(item.type)}">${activityGlyph(item.type)}</span><p><strong>${activitySentence(item)}</strong> ${escaped(item.title)}<small>${relativeTime(item.occurredAt)} · ${escaped(item.project)}</small></p>`;
    insightElements.activity.append(row);
  });
}

function activityGlyph(type) {
  if (type === 'completed') return '✓';
  if (type === 'deleted') return '−';
  if (type === 'created') return '+';
  return '·';
}

function download(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportData(format) {
  const button = format === 'json' ? insightElements.json : insightElements.csv;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing…';
  try {
    const response = await fetch(`/api/export?format=${format}`);
    if (!response.ok) throw new Error('Export failed.');
    const content = await response.text();
    const extension = format === 'csv' ? 'csv' : 'json';
    const mime = format === 'csv' ? 'text/csv' : 'application/json';
    download(`guide-todo-backup-${insightDateKey()}.${extension}`, content, mime);
  } catch (error) {
    window.alert('Your export could not be prepared. Please try again.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function updateInsights(event) {
  cachedTasks = event.detail.tasks;
  cachedStats = event.detail.stats;
  renderFocus(cachedTasks, cachedStats);
  renderUpcoming(cachedTasks);
  fetchActivity();
}

window.addEventListener('guide:tasks-rendered', updateInsights);
insightElements.refresh.addEventListener('click', fetchActivity);
insightElements.json.addEventListener('click', () => exportData('json'));
insightElements.csv.addEventListener('click', () => exportData('csv'));
