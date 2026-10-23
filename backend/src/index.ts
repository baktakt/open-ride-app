/**
 * Open Ride - Backend API Server
 *
 * Serves workout data and static files.
 * ANT+ USB communication is now handled directly in the browser via WebUSB.
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadAllWorkouts,
  getWorkoutSummaries,
  formatDuration,
  getCategories,
  filterByCategory,
  filterByTag,
  searchWorkouts,
  Workout
} from './workoutParser.js';
import { createTerrainTileService } from './terrainTiles.js';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Banner
console.log('='.repeat(60));
console.log('  Open Ride - Backend API Server');
console.log('  WebUSB Mode - ANT+ handled in browser');
console.log('='.repeat(60));
console.log();

// Create Express app
const app = express();
const server = createServer(app);

// CORS middleware for development
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Load workouts
const workoutsDir = path.join(__dirname, '../workouts');
let workouts: Workout[] = loadAllWorkouts(workoutsDir);

// API endpoint for status check
app.get('/api/status', (_req, res) => {
  res.json({
    status: 'ok',
    mode: 'webusb',
    message: 'ANT+ USB handled via WebUSB in browser',
  });
});

// ===== WORKOUTS API =====

// Get all workouts (summaries for listing)
app.get('/api/workouts', (req, res) => {
  const { category, tag, search } = req.query;
  
  let filtered = workouts;
  
  if (typeof category === 'string' && category) {
    filtered = filterByCategory(filtered, category);
  }
  
  if (typeof tag === 'string' && tag) {
    filtered = filterByTag(filtered, tag);
  }
  
  if (typeof search === 'string' && search) {
    filtered = searchWorkouts(filtered, search);
  }
  
  const summaries = getWorkoutSummaries(filtered).map(summary => ({
    ...summary,
    durationFormatted: formatDuration(summary.totalDuration),
  }));
  
  res.json({
    count: summaries.length,
    workouts: summaries,
  });
});

// Get workout categories
app.get('/api/workouts/categories', (_req, res) => {
  res.json({
    categories: getCategories(workouts),
  });
});

// Get a specific workout by ID (full details with elements)
app.get('/api/workouts/:id', (req, res) => {
  const { id } = req.params;
  const workout = workouts.find(w => w.id === id);
  
  if (!workout) {
    res.status(404).json({ error: 'Workout not found' });
    return;
  }
  
  res.json({
    ...workout,
    durationFormatted: formatDuration(workout.totalDuration),
  });
});

// Reload workouts from disk
app.post('/api/workouts/reload', (_req, res) => {
  workouts = loadAllWorkouts(workoutsDir);
  res.json({
    message: 'Workouts reloaded',
    count: workouts.length,
  });
});

// ===== TERRAIN API =====
// Elevation tiles for the 3D route view, proxied and cached so the browser
// never contacts map-data providers directly.

// Optional: Lantmäteriet's 1 m terrain model for Sweden, with a Geotorget account that has
// "Markhöjdmodell Nedladdning" ordered (LM_USER / LM_PASS). Without it, AWS Terrain Tiles everywhere.
const terrainTiles = createTerrainTileService(path.join(__dirname, '../cache/terrain'), {
  lantmateriet: process.env.LM_USER && process.env.LM_PASS
    ? { user: process.env.LM_USER, pass: process.env.LM_PASS }
    : null,
});
console.log(`Terrain providers: ${terrainTiles.listProviders().map(p => p.id).join(', ')}`);
const TILE_COORD = /^\d{1,7}$/;

app.get('/api/terrain/providers', (_req, res) => {
  res.json({ providers: terrainTiles.listProviders() });
});

app.get('/api/terrain/:provider/:z/:x/:y.png', async (req, res) => {
  const { provider, z, x, y } = req.params;
  if (![z, x, y].every(v => TILE_COORD.test(v))) {
    res.status(400).json({ error: 'Invalid tile coordinates' });
    return;
  }

  const result = await terrainTiles.getTile(provider, Number(z), Number(x), Number(y));
  switch (result.status) {
    case 'ok':
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.setHeader('X-Terrain-Cache', result.cached ? 'hit' : 'miss');
      res.setHeader('X-Terrain-Source', result.source);
      res.send(result.body);
      return;
    case 'invalid':
      res.status(400).json({ error: result.message });
      return;
    case 'not_found':
      res.status(404).json({ error: 'Tile not available' });
      return;
    case 'upstream_error':
      console.warn(`Terrain upstream error for ${provider}/${z}/${x}/${y}: ${result.message}`);
      res.status(502).json({ error: 'Terrain provider unavailable' });
      return;
  }
});

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function main(): Promise<void> {
  // Start HTTP server
  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
    console.log();
    console.log('API Endpoints:');
    console.log(`  GET  /api/status - Server status`);
    console.log(`  GET  /api/workouts - List all workouts`);
    console.log(`  GET  /api/workouts/:id - Get workout details`);
    console.log(`  GET  /api/workouts/categories - List categories`);
    console.log(`  POST /api/workouts/reload - Reload workouts from disk`);
    console.log(`  GET  /api/terrain/providers - Terrain tile providers`);
    console.log(`  GET  /api/terrain/:provider/:z/:x/:y.png - Elevation tile (cached proxy)`);
    console.log();
    console.log('Frontend:');
    console.log('  Run `cd frontend && npm run dev` to start Vite dev server');
    console.log('  Then open http://localhost:3000 in Chrome/Edge');
    console.log();
    console.log('Note: ANT+ USB communication happens via WebUSB in the browser');
    console.log();
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
