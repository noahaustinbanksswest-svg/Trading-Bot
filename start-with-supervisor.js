#!/usr/bin/env node

/**
 * Enhanced startup script with Workspace Guardian
 * This will keep the green button ON even if the server crashes
 */

const { spawn } = require('child_process');

console.log('🛡️ Starting Enhanced Workspace Protection...');

// Start the workspace guardian in the background
const guardian = spawn('node', ['workspace-guardian.js'], {
  stdio: 'inherit',
  detached: false
});

// Start the main supervisor
require('./server/supervisor.js');