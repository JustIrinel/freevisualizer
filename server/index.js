'use strict';
// Command-line entry point: `npm start` or `node server/index.js [--no-open]`.

const path = require('path');
const { exec } = require('child_process');
const { createApp, ipv4Interfaces } = require('./app');

const DATA = process.env.FREEVIS_DATA || path.resolve(__dirname, '..', 'data');
const PORT = Number(process.env.PORT || 8080);
const NO_OPEN = process.argv.includes('--no-open') || process.env.FREEVIS_NO_OPEN === '1';

function openBrowser(link) {
  const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
  exec(cmd, () => {});
}

async function main() {
  const app = createApp({ dataDir: DATA, port: PORT });
  const { port, stats, settings } = await app.start();
  if (stats.artnet.error) {
    console.error(`[Art-Net] Nu pot asculta pe portul 6454: ${stats.artnet.error}`);
    console.error('          Pornește FreeVisualizer ÎNAINTE de SoundSwitch sau închide alt vizualizator.');
  }
  if (stats.sacn.error) console.error(`[sACN] Nu pot asculta pe portul 5568: ${stats.sacn.error}`);
  const link = `http://localhost:${port}`;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║        FreeVisualizer pornit cu succes        ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log(`  Deschide în browser:  ${link}`);
  console.log('  Art-Net:  UDP 6454 (SoundSwitch → Preferences → Hardware → Localhost Art-Net Node)');
  console.log(`  sACN:     UDP 5568 (universuri ${settings.sacnUniverses.join(', ')})`);
  const ifaces = ipv4Interfaces().filter((i) => !i.internal);
  if (ifaces.length) console.log(`  IP-uri rețea: ${ifaces.map((i) => i.address).join(', ')}`);
  console.log('  Oprește cu Ctrl+C.');
  console.log('');
  if (!NO_OPEN) openBrowser(link);
}

main().catch((err) => {
  console.error(`Nu am putut porni FreeVisualizer: ${err.message}`);
  process.exit(1);
});
