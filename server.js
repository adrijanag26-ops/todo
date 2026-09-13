/**
 * Guide To-Do API. Uses only Node's standard library so it can run immediately.
 * Tasks are kept in a JSON file and every write is serialized to avoid corruption.
 */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const MAX_BODY_BYTES = 1024 * 64;
const VALID_PRIORITIES = new Set(['low', 'medium', 'high']);
const VALID_STATUSES = new Set(['active', 'completed']);
let writeChain = Promise.resolve();

const seedTasks = [
  { title: 'Map the first release', project: 'Launch', priority: 'high', dueDate: tomorrow(2), notes: 'Outline the essentials for a confident first version.', completed: false },
  { title: 'Create dashboard wireframes', project: 'Design', priority: 'medium', dueDate: tomorrow(4), notes: 'Keep the flow calm and scannable.', completed: false },
  { title: 'Review onboarding copy', project: 'Launch', priority: 'low', dueDate: tomorrow(-1), notes: 'Check tone and the final call to action.', completed: false },
  { title: 'Organize research notes', project: 'Personal', priority: 'medium', dueDate: '', notes: 'File useful links and decisions.', completed: true }
].map((task) => ({ id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...task }));

function tomorrow(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function initializeStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(DATA_FILE); }
  catch { await fs.writeFile(DATA_FILE, JSON.stringify(seedTasks, null, 2)); }
  try { await fs.access(ACTIVITY_FILE); }
  catch { await fs.writeFile(ACTIVITY_FILE, '[]'); }
}

async function readActivity() {
  const raw = await fs.readFile(ACTIVITY_FILE, 'utf8');
  const entries = JSON.parse(raw);
  return Array.isArray(entries) ? entries : [];
}

function saveActivity(entries) {
  writeChain = writeChain.then(async () => {
    const temporary = `${ACTIVITY_FILE}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(entries, null, 2));
    await fs.rename(temporary, ACTIVITY_FILE);
  });
  return writeChain;
}

async function recordActivity(type, task) {
  const entries = await readActivity();
  entries.unshift({
    id: randomUUID(),
    type,
    taskId: task.id,
    title: task.title,
    project: task.project,
    occurredAt: new Date().toISOString()
  });
  await saveActivity(entries.slice(0, 100));
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function tasksToCsv(tasks) {
  const headers = ['id', 'title', 'project', 'priority', 'dueDate', 'notes', 'completed', 'createdAt', 'updatedAt'];
  const rows = tasks.map((task) => headers.map((key) => csvCell(task[key])).join(','));
  return `${headers.join(',')}\n${rows.join('\n')}\n`;
}

function text(res, status, content, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(content);
}

async function readTasks() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const tasks = JSON.parse(raw);
  if (!Array.isArray(tasks)) throw new Error('Task storage has an invalid format.');
  return tasks;
}

function saveTasks(tasks) {
  writeChain = writeChain.then(async () => {
    const temporary = `${DATA_FILE}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(tasks, null, 2));
    await fs.rename(temporary, DATA_FILE);
  });
  return writeChain;
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function error(res, status, message) { json(res, status, { error: message }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Please send valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function cleanText(value, field, max, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (required && !cleaned) throw new Error(`${field} is required.`);
  if (cleaned.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return cleaned;
}

function cleanTask(input, partial = false) {
  const result = {};
  if (!partial || 'title' in input) result.title = cleanText(input.title, 'Title', 120, true);
  if (!partial || 'project' in input) result.project = cleanText(input.project, 'Project', 48) || 'Inbox';
  if (!partial || 'notes' in input) result.notes = cleanText(input.notes, 'Notes', 1000);
  if (!partial || 'dueDate' in input) {
    const date = cleanText(input.dueDate, 'Due date', 10);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Due date must use YYYY-MM-DD.');
    result.dueDate = date;
  }
  if (!partial || 'priority' in input) {
    const priority = input.priority || 'medium';
    if (!VALID_PRIORITIES.has(priority)) throw new Error('Priority must be low, medium, or high.');
    result.priority = priority;
  }
  if (!partial || 'completed' in input) {
    if (typeof input.completed !== 'boolean') throw new Error('Completed must be true or false.');
    result.completed = input.completed;
  }
  return result;
}

function visibleTasks(tasks, query) {
  const project = query.get('project');
  const status = query.get('status');
  const needle = (query.get('q') || '').trim().toLowerCase();
  return tasks.filter((task) => {
    const searchable = `${task.title} ${task.project} ${task.notes}`.toLowerCase();
    return (!project || task.project === project) &&
      (!status || (status === 'completed' ? task.completed : status === 'active' ? !task.completed : true)) &&
      (!needle || searchable.includes(needle));
  }).sort((a, b) => Number(a.completed) - Number(b.completed) || dueValue(a.dueDate) - dueValue(b.dueDate) || b.createdAt.localeCompare(a.createdAt));
}

function dueValue(date) { return date ? new Date(`${date}T12:00:00`).getTime() : Number.MAX_SAFE_INTEGER; }

function summary(tasks) {
  const today = new Date().toISOString().slice(0, 10);
  const active = tasks.filter((task) => !task.completed);
  return {
    total: tasks.length,
    active: active.length,
    completed: tasks.length - active.length,
    overdue: active.filter((task) => task.dueDate && task.dueDate < today).length,
    dueToday: active.filter((task) => task.dueDate === today).length
  };
}

async function serveFile(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requested).replace(/^([.][.][\\/])+/, '');
  const file = path.join(PUBLIC_DIR, safePath);
  if (!file.startsWith(PUBLIC_DIR)) return error(res, 403, 'Forbidden.');
  const extensions = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  try {
    const content = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': extensions[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { error(res, 404, 'Not found.'); }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const resource = parts[1];
  const id = parts[2];
  if (resource === 'tasks' && req.method === 'GET' && !id) return json(res, 200, { tasks: visibleTasks(await readTasks(), url.searchParams) });
  if (resource === 'projects' && req.method === 'GET') {
    const tasks = await readTasks();
    const projects = [...new Set(tasks.map((task) => task.project))].sort().map((name) => ({
      name, total: tasks.filter((task) => task.project === name).length, active: tasks.filter((task) => task.project === name && !task.completed).length
    }));
    return json(res, 200, { projects });
  }
  if (resource === 'activity' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 12, 1), 100);
    return json(res, 200, { activity: (await readActivity()).slice(0, limit) });
  }
  if (resource === 'export' && req.method === 'GET') {
    const tasks = await readTasks();
    const format = url.searchParams.get('format') || 'json';
    if (format === 'csv') return text(res, 200, tasksToCsv(tasks), 'text/csv; charset=utf-8');
    return json(res, 200, { exportedAt: new Date().toISOString(), tasks });
  }
  if (resource === 'stats' && req.method === 'GET') return json(res, 200, summary(await readTasks()));
  if (resource === 'tasks' && req.method === 'POST' && !id) {
    const input = cleanTask(await readBody(req));
    const task = { id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...input };
    const tasks = await readTasks(); tasks.push(task); await saveTasks(tasks); await recordActivity('created', task);
    return json(res, 201, { task });
  }
  if (resource === 'tasks' && id && req.method === 'PATCH') {
    const updates = cleanTask(await readBody(req), true);
    const tasks = await readTasks(); const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) return error(res, 404, 'Task not found.');
    const previous = tasks[index];
    tasks[index] = { ...previous, ...updates, updatedAt: new Date().toISOString() }; await saveTasks(tasks);
    await recordActivity(updates.completed === true && !previous.completed ? 'completed' : 'updated', tasks[index]);
    return json(res, 200, { task: tasks[index] });
  }
  if (resource === 'tasks' && id && req.method === 'DELETE') {
    const tasks = await readTasks(); const remaining = tasks.filter((task) => task.id !== id);
    if (remaining.length === tasks.length) return error(res, 404, 'Task not found.');
    const deleted = tasks.find((task) => task.id === id);
    await saveTasks(remaining); await recordActivity('deleted', deleted); return json(res, 200, { deleted: id });
  }
  error(res, 404, 'API endpoint not found.');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET') await serveFile(res, decodeURIComponent(url.pathname));
    else error(res, 405, 'Method not allowed.');
  } catch (cause) {
    console.error(cause);
    error(res, 400, cause.message || 'Unable to process the request.');
  }
});

initializeStore().then(() => server.listen(PORT, () => console.log(`Guide To-Do is ready at http://localhost:${PORT}`))).catch((cause) => { console.error(cause); process.exit(1); });
