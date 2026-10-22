import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = express();
const distPath = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

if (!existsSync(`${distPath}/index.html`)) {
  throw new Error('Production build not found. Run "npm run build" first.');
}

app.disable('x-powered-by');
app.use('/_app', express.static(`${distPath}/_app`, {
  immutable: true,
  maxAge: '1y',
}));
app.use(express.static(distPath));
app.use((_request, response) => {
  response.status(404).type('text/plain').send('Not found');
});

const server = app.listen(port, host);

server.on('listening', () => {
  console.log(`Portfolio running at http://${host}:${port}`);
});

server.on('error', (error) => {
  console.error(`Unable to start the server: ${error.message}`);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exitCode = 0;
    });
  });
}
