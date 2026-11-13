// Browser development entry point (npm run dev). The desktop app does not use this
// file; Electron creates the server itself via createMailServer({ desktop: true }).
import { createMailServer } from './app.mjs';

try {
  const server = await createMailServer({
    desktop: false,
    env: process.env,
    logger: msg => console.log(`[Levuvo Mail] ${msg}`)
  });
  await server.listen();
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (err) {
  console.error('[Levuvo Mail] API konnte nicht gestartet werden:', err.message);
  process.exitCode = 1;
}
