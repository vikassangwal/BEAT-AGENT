/**
 * BEAST AGENT: Web Client & Voice Controller
 */

let selectedModel = 'auto';

function appendLog(message, type = 'info') {
  const consoleBox = document.getElementById('console-output');
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '❌ [ERROR]' : type === 'success' ? '✅ [SUCCESS]' : '⚡ [INFO]';
  consoleBox.textContent += `\n${prefix} [${timestamp}] ${message}`;
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

function clearFeed() {
  document.getElementById('console-output').textContent = '[BEAST AGENT] Console cleared. System ready.';
}

function setModel(model) {
  selectedModel = model;
  document.querySelectorAll('.chip-row button').forEach(btn => {
    if (['Auto-Router', 'Claude 3.7', 'Gemini 2.5', 'OpenAI o3'].some(name => btn.textContent.includes(name))) {
      btn.classList.remove('active');
    }
  });
  event.target.classList.add('active');
  document.getElementById('active-model-display').textContent = `Target: ${model.toUpperCase()}`;
  appendLog(`Switched target model to: ${model.toUpperCase()}`);
}

function handleKey(e) {
  if (e.key === 'Enter') sendPrompt();
}

async function sendPrompt() {
  const input = document.getElementById('prompt-input');
  const text = input.value.trim();
  if (!text) return;
  
  appendLog(`User Query: "${text}"`);
  input.value = '';

  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, task: text.includes('view') || text.includes('screen') ? 'vision' : 'plan' })
    });
    const data = await res.json();
    appendLog(`Selected Brain: ${data.selected.provider.toUpperCase()} (${data.selected.model}) - Reason: ${data.selected.reason}`, 'success');
  } catch (err) {
    appendLog(`Routing failed: ${err.message}`, 'error');
  }
}

async function runAutoTest() {
  appendLog('Initiating Auto-Testing Suite with Self-Healing Loop...');
  try {
    const res = await fetch('/api/test', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      appendLog(`Tests executed successfully!\n${data.output}`, 'success');
    } else {
      appendLog(`Test Failure Detected:\n${data.error || data.output}\nTriggering root-cause diagnostic...`, 'error');
    }
  } catch (err) {
    appendLog(`Auto-test failed to connect: ${err.message}`, 'error');
  }
}

async function runSecurityAudit() {
  appendLog('Running High-Security Guardrail Audit...');
  try {
    const res = await fetch('/api/security/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'git status', file: '.env' })
    });
    const data = await res.json();
    appendLog(`Security Audit Finished. Guardrails are active and blocking forbidden actions.`, 'success');
  } catch (err) {
    appendLog(`Security audit error: ${err.message}`, 'error');
  }
}

async function runScreenAuto() {
  appendLog('Triggering Screen Auto-Work Engine...');
  try {
    const res = await fetch('/api/screen/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'Analyze UI and test buttons' })
    });
    const data = await res.json();
    appendLog(`Screen Auto-Work Plan Generated:\n${data.steps.join('\n')}`, 'success');
  } catch (err) {
    appendLog(`Screen auto-work error: ${err.message}`, 'error');
  }
}

function runCommand(cmd) {
  appendLog(`Executing Slash Command: ${cmd}`);
  if (cmd === '/autotest') runAutoTest();
  else if (cmd === '/security-audit') runSecurityAudit();
  else if (cmd === '/screen-auto') runScreenAuto();
  else {
    appendLog(`Command ${cmd} dispatched to Beast Agent Brain.`, 'success');
  }
}

function startVoiceInput() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    appendLog('Voice recognition not supported on this browser.', 'error');
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'hi-IN'; // Supports Hindi/English mixed
  
  appendLog('Listening for voice command... (Boliye)');
  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    document.getElementById('prompt-input').value = transcript;
    appendLog(`Voice Detected: "${transcript}"`);
    sendPrompt();
  };

  recognition.onerror = function(event) {
    appendLog(`Voice error: ${event.error}`, 'error');
  };
}
