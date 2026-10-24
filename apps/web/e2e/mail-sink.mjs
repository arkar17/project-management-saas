// Minimal local SMTP sink for browser E2E (no Mailpit needed). Accepts every message and serves
// them as JSON at http://127.0.0.1:${HTTP_PORT}/messages (newest last). Test-only, loopback only.
import { createServer } from 'node:net';
import { createServer as createHttp } from 'node:http';

const SMTP_PORT = Number(process.env.SMTP_SINK_PORT ?? 2526);
const HTTP_PORT = Number(process.env.SMTP_SINK_HTTP_PORT ?? 8026);
const messages = [];

createServer((socket) => {
  let data = false;
  let buffer = '';
  let body = '';
  let to = [];
  socket.write('220 sink ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (data) {
        if (line === '.') {
          data = false;
          const subject = /^Subject: (.*)$/im.exec(body)?.[1] ?? '';
          const text = body
            .split(/\r?\n\r?\n/)
            .slice(1)
            .join('\n\n');
          messages.push({ to, subject, text: decodeQuotedPrintable(text) });
          body = '';
          to = [];
          socket.write('250 OK\r\n');
        } else body += `${line.startsWith('..') ? line.slice(1) : line}\n`;
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 sink\r\n');
      else if (cmd === 'MAIL') socket.write('250 OK\r\n');
      else if (cmd === 'RCPT') {
        to.push(/<([^>]+)>/.exec(line)?.[1] ?? '');
        socket.write('250 OK\r\n');
      } else if (cmd === 'DATA') {
        data = true;
        socket.write('354 End with .\r\n');
      } else if (cmd === 'QUIT') socket.end('221 Bye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
  socket.on('error', () => {});
}).listen(SMTP_PORT, '127.0.0.1');

function decodeQuotedPrintable(s) {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

createHttp((req, res) => {
  if (req.method === 'DELETE') messages.length = 0;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(messages));
}).listen(HTTP_PORT, '127.0.0.1');
