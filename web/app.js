'use strict';
const $ = id => document.getElementById(id);
let state = null, busy = false, recognition = null, listening = false, initial = true;
let lastMessages = '', lastTasks = '', lastMemories = '', lastActions = '';
const notified = new Set();
history.replaceState(null, '', '/');

function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function tab(name) {
  document.querySelectorAll('.panel').forEach(n => n.classList.toggle('active', n.id === name));
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.tab === name));
  $('page-title').textContent = {chat:'Conversation',tasks:'Tasks & reminders',memories:'Memory',activity:'Activity',settings:'Settings'}[name];
}
document.querySelectorAll('[data-tab]').forEach(n => n.onclick = () => tab(n.dataset.tab));
document.querySelectorAll('[data-prompt]').forEach(n => n.onclick = () => {
  $('prompt').value = n.dataset.prompt; $('prompt').focus();
});
function renderMessages(messages) {
  const signature = JSON.stringify(messages);
  if (signature === lastMessages) return;
  lastMessages = signature;
  $('welcome').hidden = messages.length > 0;
  $('messages').replaceChildren();
  for (const m of messages) {
    const row = el('div','message ' + m.role);
    row.append(el('div','avatar',m.role === 'user' ? 'YOU' : 'J'));
    const body = el('div','message-body');
    body.append(el('div','message-label',m.role === 'user' ? 'YOU' : 'JARVIS'));
    const text = el('div','message-text',m.content); text.dir = 'auto';
    body.append(text); row.append(body); $('messages').append(row);
  }
  $('messages').scrollTop = $('messages').scrollHeight;
}
function empty(container, text) { container.replaceChildren(el('p','muted',text)); }
function renderTasks(tasks) {
  const signature = JSON.stringify(tasks);
  if (signature !== lastTasks) {
    lastTasks = signature;
    $('task-list').replaceChildren();
    if (!tasks.length) empty($('task-list'),'A clear slate. Add your first task above.');
    for (const task of tasks) {
      const card = el('div','card' + (task.done ? ' done' : ''));
      const body = el('div','card-content');
      body.append(el('p','',task.title));
      body.append(el('small','',task.due ? new Date(task.due*1000).toLocaleString() : 'No reminder'));
      card.append(body);
      if (!task.done) {
        const button = el('button','secondary','Complete');
        button.onclick = async () => {
          button.disabled = true;
          try { await api('/api/task',{id:task.id}); await refresh(); }
          catch(e) { notice(e.message); button.disabled = false; }
        };
        card.append(button);
      }
      $('task-list').append(card);
    }
  }
  $('task-count').textContent = tasks.filter(t => !t.done).length;
  for (const task of tasks) {
    if (!task.done && task.due && task.due*1000 <= Date.now() && !notified.has(task.id)) {
      notified.add(task.id);
      notice('Reminder: ' + task.title + ' — see Tasks to mark it complete.');
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Jarvis reminder',{body:task.title,tag:'jarvis-task-'+task.id}); } catch (_) {}
      }
    }
  }
}
function renderMemories(memories) {
  const signature = JSON.stringify(memories);
  if (signature === lastMemories) return;
  lastMemories = signature; $('memory-list').replaceChildren();
  if (!memories.length) empty($('memory-list'),'No saved memories yet.');
  for (const memory of memories) {
    const card = el('div','card'); const text = el('p','',memory.content); text.dir = 'auto';
    card.append(text); $('memory-list').append(card);
  }
}
function renderActions(actions) {
  const signature = JSON.stringify(actions);
  if (signature === lastActions) return;
  lastActions = signature; $('activity-list').replaceChildren();
  $('action-count').textContent = actions.filter(a => a.status === 'pending').length;
  if (!actions.length) empty($('activity-list'),'App and website launch requests will appear here.');
  for (const action of actions) {
    const card = el('div','card'), body = el('div','card-content');
    const payload = JSON.parse(action.payload);
    body.append(el('small','',action.operation.replaceAll('_',' ').toUpperCase() + ' · ' + action.status));
    body.append(el('p','',payload.url || payload.app));
    if (action.result) body.append(el('small','',action.result));
    card.append(body);
    if (action.status === 'pending') {
      const buttons = el('div','buttons');
      for (const approve of [false,true]) {
        const button = el('button',approve ? 'primary' : 'secondary',approve ? 'Approve' : 'Decline');
        button.onclick = async () => {
          buttons.querySelectorAll('button').forEach(b => b.disabled = true);
          try {
            const result = await api('/api/action',{id:action.id,approve});
            notice(result.result || 'Action ' + result.status);
            await refresh();
          } catch (e) { notice(e.message); buttons.querySelectorAll('button').forEach(b => b.disabled = false); }
        };
        buttons.append(button);
      }
      card.append(buttons);
    }
    $('activity-list').append(card);
  }
}
async function refresh() {
  try {
    state = await api('/api/state');
    $('connection').textContent = 'Local server connected';
    $('provider-badge').textContent = state.settings.provider === 'commands' ? 'LOCAL COMMANDS' : state.settings.provider.toUpperCase();
    $('workspace-path').textContent = state.settings.workspace;
    $('key-state').textContent = state.settings.has_key ? 'A key is loaded for this server session.' : 'No key loaded. Keys are not saved to disk.';
    if (initial) {
      $('provider').value = state.settings.provider; $('model').value = state.settings.model;
      initial = false;
    }
    renderMessages(state.messages); renderTasks(state.tasks);
    renderMemories(state.memories); renderActions(state.actions);
  } catch (e) { $('connection').textContent = 'Disconnected'; notice(e.message); }
}
function speak(text) {
  if (!$('speak').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = $('language').value;
  speechSynthesis.speak(utterance);
}
async function send(text) {
  if (busy || !text.trim()) return;
  busy = true; $('send').disabled = true; $('thinking').textContent = 'Working…'; notice('');
  try {
    const pending = [...(state?.messages || []),{role:'user',content:text}];
    renderMessages(pending);
    const result = await api('/api/chat',{text});
    await refresh();
    speak(result.answer);
    if (state?.actions.some(a => a.status === 'pending')) notice('An action needs your review in Activity.');
  } catch (e) { notice(e.message); $('prompt').value = text; }
  finally { busy = false; $('send').disabled = false; $('thinking').textContent = ''; $('prompt').focus(); }
}
$('composer').onsubmit = e => {
  e.preventDefault();
  if (busy) return;
  const text = $('prompt').value.trim(); $('prompt').value = ''; send(text);
};
$('prompt').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
};
$('settings-form').onsubmit = async e => {
  e.preventDefault();
  const button = e.target.querySelector('button'); button.disabled = true;
  try {
    await api('/api/settings',{provider:$('provider').value,model:$('model').value,
      api_key:$('api-key').value,clear_key:$('clear-key').checked});
    $('api-key').value = ''; $('clear-key').checked = false;
    $('settings-status').textContent = 'Saved. Send a message to test the connection.';
    await refresh();
  } catch (error) { $('settings-status').textContent = error.message; }
  finally { button.disabled = false; }
};
$('provider').onchange = () => {
  if ($('provider').value === 'ollama') $('model').value = 'qwen3:8b';
  else if ($('provider').value === 'openai') $('model').value = 'gpt-4.1-mini';
};
$('task-form').onsubmit = async e => {
  e.preventDefault();
  if (busy) return notice('Please wait for the current request to finish.');
  const title = $('task-title').value.trim(), date = $('task-due').value;
  if (!title) return;
  // Add through the same validated command/tool pipeline as chat.
  if (date) {
    const minutes = Math.ceil((new Date(date).getTime()-Date.now())/60000);
    if (minutes < 1 || minutes > 999999) return notice('Choose a future reminder within 999999 minutes.');
    await send('/remind ' + minutes + 'm ' + title);
  } else await send('/task ' + title);
  $('task-title').value = ''; $('task-due').value = '';
};
$('memory-form').onsubmit = async e => {
  e.preventDefault();
  if (busy) return notice('Please wait for the current request to finish.');
  await send('/remember ' + $('memory-text').value);
  $('memory-text').value = '';
};
$('enable-notifications').onclick = async () => {
  if (!('Notification' in window)) return notice('This browser does not support desktop notifications.');
  try { notice('Notification permission: ' + await Notification.requestPermission()); }
  catch(e) { notice(e.message); }
};
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false; recognition.interimResults = false;
  recognition.onstart = () => {
    listening = true; $('mic').classList.add('listening');
    $('mic').setAttribute('aria-label','Stop voice input'); notice('Listening… speak, then review the text before sending.');
  };
  recognition.onend = () => {
    listening = false; $('mic').classList.remove('listening'); $('mic').setAttribute('aria-label','Start voice input');
  };
  recognition.onresult = e => {
    $('prompt').value = e.results[0][0].transcript; $('prompt').focus(); notice('Voice captured. Press Send when ready.');
  };
  recognition.onerror = e => notice('Voice input: ' + e.error + '. You can still type.');
  $('mic').onclick = () => {
    if (listening) return recognition.stop();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    recognition.lang = $('language').value;
    try { recognition.start(); } catch(e) { notice(e.message); }
  };
} else {
  $('mic').disabled = true; $('mic').title = 'Speech recognition unavailable. Try Chrome or Edge.';
}
$('speak').onchange = () => { if (!$('speak').checked && 'speechSynthesis' in window) speechSynthesis.cancel(); };
function tick() { $('clock').textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
tick(); setInterval(tick,1000);
refresh();
setInterval(() => { if (!busy) refresh(); },5000);
