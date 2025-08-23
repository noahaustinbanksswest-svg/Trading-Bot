#!/usr/bin/env node

/**
 * Startup script for Discord Trading Bot with Process Supervisor
 * Use this instead of npm run dev to get auto-restart functionality
 */

require('./server/supervisor.js');