import { loadConfig, validateConfig } from './config.js';
import { openDatabase } from './database.js';
import { createApplication } from './app.js';

const config = loadConfig();
validateConfig(config);

const database = openDatabase(config.databasePath);
const application = createApplication({ config, database });
const server = application.app.listen(config.port, () => {
  console.log(`Stranded Detector listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down`);

  const forceClose = setTimeout(() => process.exit(1), 10_000);
  forceClose.unref();

  server.close(() => {
    application.close();
    database.close();
    clearTimeout(forceClose);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
