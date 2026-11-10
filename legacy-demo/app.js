const select = document.querySelector('#taskSelect');
const editor = document.querySelector('#codeEditor');
const runButton = document.querySelector('#runButton');
const errorBox = document.querySelector('#errorBox');
let tasks = [];

async function loadTasks() {
  const response = await fetch('/api/tasks');
  if (!response.ok) throw new Error('Could not load the demo tasks.');
  tasks = await response.json();
  select.replaceChildren(...tasks.map(task => {
    const option = document.createElement('option'); option.value = task.id; option.textContent = task.title; return option;
  }));
  updateTask();
}
function updateTask() {
  const task = tasks.find(item => item.id === select.value);
  if (!task) return;
  document.querySelector('#taskDescription').textContent = task.description;
  editor.value = task.code;
  document.querySelector('#results').hidden = true;
  errorBox.hidden = true;
  resetAgents();
}
function resetAgents() {
  document.querySelectorAll('.agent').forEach(agent => {
    agent.className = 'agent'; agent.querySelector('.agent-state').textContent = 'READY';
  });
}
select.addEventListener('change', updateTask);
runButton.addEventListener('click', async () => {
  runButton.disabled = true; runButton.innerHTML = 'Running workflow…'; errorBox.hidden = true;
  document.querySelector('#results').hidden = true; resetAgents();
  try {
    const response = await fetch('/api/run', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({task:select.value, code:editor.value})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Workflow failed.');
    renderResult(result);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    runButton.disabled = false; runButton.innerHTML = 'Run workflow <span>→</span>';
  }
});
function renderResult(result) {
  document.querySelector('#results').hidden = false;
  document.querySelector('#resultTitle').textContent = result.passed ? 'Workflow complete' : 'Review needed';
  const badge = document.querySelector('#resultBadge');
  badge.textContent = result.passed ? 'PASSED' : 'FAILED'; badge.className = result.passed ? 'badge' : 'badge failed';
  const reqs = document.querySelector('#requirements'); reqs.replaceChildren(...result.requirements.map(text => {const li=document.createElement('li');li.textContent=text;return li;}));
  const test = result.attempts.map(run => `<div class="test-row">Attempt ${run.attempt}${run.repair ? ' · repair' : ''}: <strong class="${run.passed ? '' : 'bad'}">${run.passed ? 'PASS' : 'FAIL'}</strong><br>Expected: ${escapeHtml(run.expected)}<br>Received: ${escapeHtml(run.stdout || '(no output)')}${run.stderr ? `<br>Message: ${escapeHtml(run.stderr)}` : ''}</div>`).join('<hr style="border:0;border-top:1px solid #293241;margin:9px 0">');
  document.querySelector('#testResult').innerHTML = test;
  document.querySelector('#timeline').replaceChildren(...result.events.map(event => {
    const li=document.createElement('li'); li.className=event.status==='complete'?'ok':'';
    const strong=document.createElement('strong');strong.textContent=`${event.agent} · ${event.status.toUpperCase()}`;
    const small=document.createElement('small');small.textContent=event.detail;li.append(strong,small);return li;
  }));
  document.querySelector('#finalCode').textContent=result.code;
  document.querySelector('#resultNotice').textContent=`${result.notice} Repair limit: ${result.repairLimit} attempt.`;
  document.querySelectorAll('.agent').forEach(agent => {
    const name=agent.querySelector('strong').textContent;
    const event=result.events.find(item=>item.agent===name);
    if (event) {agent.classList.add(event.status==='complete'?'done':event.status==='failed'?'failed':'active');agent.querySelector('.agent-state').textContent=event.status.toUpperCase();}
  });
  document.querySelector('#results').scrollIntoView({behavior:'smooth',block:'start'});
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
loadTasks().catch(error => {errorBox.textContent=error.message;errorBox.hidden=false;});
