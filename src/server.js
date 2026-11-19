/**
 * BEAST AGENT: Core Micro-Server
 * Fast, lightweight, zero external dependencies required for immediate startup.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SecurityGuard } from './security.js';
import { ModelRouter } from './router.js';
import { AutoTester } from './tester.js';
import { ScreenAutoEngine } from './screen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const router = new ModelRouter();
const tester = new AutoTester();
const screen = new ScreenAutoEngine();

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Endpoints ---

  // Health / Status Check
  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      agent: 'BEAST AGENT',
      version: '1.0.0',
      status: 'ONLINE',
      features: {
        multiModel: true,
        autoTesting: true,
        screenAutoWork: true,
        highSecurityGuardrails: true,
        pwaReady: true
      },
      models: ['claude-3-7-sonnet', 'gemini-2.5-flash', 'o3-mini']
    }));
    return;
  }

  // Multi-Model Routing Query
  if (req.url === '/api/route' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { task, contextLength, prompt } = JSON.parse(body || '{}');
        const selected = router.selectModel(task, contextLength || 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          selected,
          promptWrapped: router.wrapPrompt(prompt || task)
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Run Auto-Testing Suite
  if (req.url === '/api/test' && req.method === 'POST') {
    try {
      const result = await tester.runSuite();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Screen Auto-Work Action
  if (req.url === '/api/screen/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { task } = JSON.parse(body || '{}');
        const plan = screen.planAction(task || 'inspect interface');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(plan));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Security Check API
  if (req.url === '/api/security/check' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { command, file } = JSON.parse(body || '{}');
        let check = { allowed: true };
        if (command) check = SecurityGuard.validateCommand(command);
        if (check.allowed && file) check = SecurityGuard.validateFileAccess(file);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(check));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Static File Serving (Dashboard & PWA) ---
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`⚡ BEAST AGENT Core Server running at: http://localhost:${PORT}`);
  console.log(`📱 All-Device Mobile PWA ready!`);
  console.log(`🛡️ High Security Guardrails: ACTIVE`);
  console.log(`=======================================================`);
});
