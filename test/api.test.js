const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let server;
let baseUrl;
let dataDirectory;

function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

function payload(value) {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  };
}

async function waitForServer() {
  let failure;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/stats`);
      if (response.ok) return;
    } catch (error) {
      failure = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw failure || new Error('The test server did not start.');
}

test.before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-todo-'));
  const port = 3310 + Math.floor(Math.random() * 500);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDirectory },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();
});

test.after(async () => {
  if (server && !server.killed) server.kill();
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('serves the application document', async () => {
  const response = await request('/');
  const document = await response.text();
  assert.equal(response.status, 200);
  assert.match(document, /Guide — Project To-Do/);
  assert.match(document, /insights\.js/);
});

test('initializes the dashboard with demonstration tasks', async () => {
  const response = await request('/api/tasks');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Array.isArray(data.tasks), true);
  assert.equal(data.tasks.length, 4);
  assert.equal(data.tasks.every((task) => typeof task.id === 'string'), true);
});

test('creates a complete new task', async () => {
  const response = await request('/api/tasks', {
    method: 'POST',
    ...payload({
      title: 'Write API tests',
      project: 'Quality',
      priority: 'high',
      dueDate: '2030-04-02',
      notes: 'Exercise all public endpoints.',
      completed: false
    })
  });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.equal(data.task.title, 'Write API tests');
  assert.equal(data.task.project, 'Quality');
  assert.equal(data.task.priority, 'high');
  assert.equal(data.task.completed, false);
  assert.ok(data.task.id);
});

test('rejects an invalid task before storing it', async () => {
  const response = await request('/api/tasks', {
    method: 'POST',
    ...payload({
      title: '',
      project: 'Quality',
      priority: 'urgent',
      completed: false
    })
  });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.match(data.error, /Title is required/);
});

test('returns an active project summary', async () => {
  const response = await request('/api/projects');
  const data = await response.json();
  const quality = data.projects.find((project) => project.name === 'Quality');
  assert.equal(response.status, 200);
  assert.equal(quality.total, 1);
  assert.equal(quality.active, 1);
});

test('filters tasks by project, status and a search phrase', async () => {
  const response = await request('/api/tasks?project=Quality&status=active&q=exercise');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].title, 'Write API tests');
});

test('updates a task and records its completion', async () => {
  const before = await request('/api/tasks?project=Quality');
  const task = (await before.json()).tasks[0];
  const response = await request(`/api/tasks/${task.id}`, {
    method: 'PATCH',
    ...payload({ completed: true })
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.task.completed, true);
  const activityResponse = await request('/api/activity?limit=2');
  const activity = await activityResponse.json();
  assert.equal(activity.activity[0].type, 'completed');
  assert.equal(activity.activity[0].taskId, task.id);
});

test('exposes accurate summary counts after an update', async () => {
  const response = await request('/api/stats');
  const stats = await response.json();
  assert.equal(response.status, 200);
  assert.equal(stats.total, 5);
  assert.equal(stats.completed, 2);
  assert.equal(stats.active, 3);
});

test('exports tasks as JSON with an export timestamp', async () => {
  const response = await request('/api/export?format=json');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(data.exportedAt);
  assert.equal(data.tasks.length, 5);
});

test('exports tasks as RFC-style quoted CSV rows', async () => {
  const response = await request('/api/export?format=csv');
  const csv = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(csv, /^id,title,project,priority/d);
  assert.match(csv, /"Write API tests","Quality","high"/);
});

test('deletes a task and notes that action in activity', async () => {
  const taskResponse = await request('/api/tasks?project=Quality');
  const task = (await taskResponse.json()).tasks[0];
  const response = await request(`/api/tasks/${task.id}`, { method: 'DELETE' });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.deleted, task.id);
  const gone = await request(`/api/tasks/${task.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 404);
  const activityResponse = await request('/api/activity?limit=1');
  const activity = await activityResponse.json();
  assert.equal(activity.activity[0].type, 'deleted');
});

test('returns a useful response for an unknown API route', async () => {
  const response = await request('/api/not-real');
  const data = await response.json();
  assert.equal(response.status, 404);
  assert.match(data.error, /endpoint not found/i);
});
