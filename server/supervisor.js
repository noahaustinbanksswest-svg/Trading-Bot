#!/usr/bin/env node

/**
 * Process Supervisor for Discord Trading Bot
 * Ensures the web server automatically restarts if it crashes
 * Keeps the green button ON in Replit at all times
 */

const { spawn } = require('child_process');
const path = require('path');

class ProcessSupervisor {
  constructor() {
    this.serverProcess = null;
    this.restartCount = 0;
    this.maxRestarts = 50;
    this.lastRestartTime = 0;
    this.restartDelay = 3000; // 3 seconds
    this.isShuttingDown = false;
  }

  start() {
    console.log('🛡️ Process Supervisor starting...');
    console.log('🎯 Mission: Keep Discord bot alive 24/7');
    
    // Start the server
    this.startServer();
    
    // Setup graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    
    // Keep supervisor alive
    setInterval(() => {
      console.log(`🛡️ Supervisor active - Server restarts: ${this.restartCount}`);
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  startServer() {
    if (this.isShuttingDown) return;
    
    console.log('🚀 Starting web server process...');
    
    // Spawn the actual server process
    this.serverProcess = spawn('npx', ['tsx', 'server/index.ts'], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env
    });

    // Handle server process events
    this.serverProcess.on('error', (error) => {
      console.error('💥 Server process error:', error);
      this.scheduleRestart('process error');
    });

    this.serverProcess.on('exit', (code, signal) => {
      console.log(`💀 Server process exited with code ${code}, signal ${signal}`);
      this.serverProcess = null;
      
      if (!this.isShuttingDown) {
        this.scheduleRestart(`exit code ${code}`);
      }
    });

    console.log(`✅ Server process started with PID: ${this.serverProcess.pid}`);
  }

  scheduleRestart(reason) {
    if (this.isShuttingDown) return;
    
    const now = Date.now();
    const timeSinceLastRestart = now - this.lastRestartTime;
    
    // Prevent rapid restarts
    if (timeSinceLastRestart < 10000) { // Less than 10 seconds
      console.log('⏸️ Too many rapid restarts, increasing delay...');
      this.restartDelay = Math.min(this.restartDelay * 2, 30000); // Max 30 seconds
    } else {
      this.restartDelay = 3000; // Reset to 3 seconds
    }
    
    this.restartCount++;
    this.lastRestartTime = now;
    
    if (this.restartCount >= this.maxRestarts) {
      console.error(`🛑 Maximum restart attempts (${this.maxRestarts}) reached. Stopping.`);
      process.exit(1);
      return;
    }
    
    console.log(`🔄 Scheduling restart (reason: ${reason}, attempt ${this.restartCount}/${this.maxRestarts}) in ${this.restartDelay}ms...`);
    
    setTimeout(() => {
      // Make sure old process is killed
      if (this.serverProcess && !this.serverProcess.killed) {
        console.log('🔪 Killing old server process...');
        this.serverProcess.kill('SIGKILL');
        this.serverProcess = null;
      }
      
      this.startServer();
    }, this.restartDelay);
  }

  shutdown() {
    console.log('🛑 Supervisor shutting down gracefully...');
    this.isShuttingDown = true;
    
    if (this.serverProcess && !this.serverProcess.killed) {
      console.log('🔄 Stopping server process...');
      this.serverProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          console.log('🔪 Force killing server process...');
          this.serverProcess.kill('SIGKILL');
        }
        process.exit(0);
      }, 5000);
    } else {
      process.exit(0);
    }
  }
}

// Start the supervisor
const supervisor = new ProcessSupervisor();
supervisor.start();