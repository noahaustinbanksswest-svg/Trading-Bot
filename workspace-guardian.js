#!/usr/bin/env node

/**
 * Workspace Guardian - Keeps Replit workspace (green button) alive 24/7
 * This runs independently and forces the workspace to restart if it dies
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');

class WorkspaceGuardian {
  constructor() {
    this.checkInterval = 30000; // Check every 30 seconds
    this.restartAttempts = 0;
    this.maxRestartAttempts = 100;
    this.isRunning = false;
    this.lastSuccessfulPing = Date.now();
    this.serverProcess = null;
  }

  async start() {
    console.log('🛡️ Workspace Guardian ACTIVATED');
    console.log('🎯 Mission: Keep green button ON at all costs');
    
    // Start monitoring immediately
    this.startMonitoring();
    
    // Setup graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    process.on('uncaughtException', (error) => {
      console.error('🚨 Guardian error:', error);
      // Guardian must never die
      setTimeout(() => this.startMonitoring(), 5000);
    });
  }

  async startMonitoring() {
    console.log('🔍 Starting workspace monitoring...');
    
    setInterval(async () => {
      try {
        await this.checkWorkspaceHealth();
      } catch (error) {
        console.error('❌ Monitoring error:', error.message);
        await this.forceRestart('monitoring error');
      }
    }, this.checkInterval);

    // Initial health check
    await this.checkWorkspaceHealth();
  }

  async checkWorkspaceHealth() {
    try {
      // Method 1: Check if local server responds
      const healthResponse = await this.pingLocalServer();
      
      if (healthResponse) {
        this.lastSuccessfulPing = Date.now();
        this.restartAttempts = 0; // Reset on success
        console.log('💚 Workspace healthy - Green button ON');
        return;
      }
      
      // Method 2: Check if any node processes are running
      const nodeProcesses = await this.checkNodeProcesses();
      
      if (nodeProcesses.length === 0) {
        console.log('🚨 NO NODE PROCESSES DETECTED - Green button OFF');
        await this.forceRestart('no node processes');
        return;
      }
      
      // Method 3: Check last ping time
      const timeSinceLastPing = Date.now() - this.lastSuccessfulPing;
      if (timeSinceLastPing > 120000) { // 2 minutes
        console.log('🚨 WORKSPACE UNRESPONSIVE - Green button appears OFF');
        await this.forceRestart('ping timeout');
      }
      
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      await this.forceRestart('health check failed');
    }
  }

  async pingLocalServer() {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 5000);
      
      try {
        // Try to ping localhost server
        exec('curl -s http://localhost:5000/api/health', (error, stdout) => {
          clearTimeout(timeoutId);
          if (!error && stdout.includes('healthy')) {
            resolve(true);
          } else {
            resolve(false);
          }
        });
      } catch (error) {
        clearTimeout(timeoutId);
        resolve(false);
      }
    });
  }

  async checkNodeProcesses() {
    return new Promise((resolve) => {
      exec('ps aux | grep node | grep -v grep', (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        
        const processes = stdout.split('\n').filter(line => 
          line.includes('node') && 
          !line.includes('grep') &&
          line.trim().length > 0
        );
        
        resolve(processes);
      });
    });
  }

  async forceRestart(reason) {
    if (this.restartAttempts >= this.maxRestartAttempts) {
      console.error(`🛑 Max restart attempts reached (${this.maxRestartAttempts})`);
      return;
    }

    this.restartAttempts++;
    console.log(`🔄 FORCING WORKSPACE RESTART (attempt ${this.restartAttempts})`);
    console.log(`🔍 Reason: ${reason}`);

    try {
      // Kill any existing processes first
      await this.killExistingProcesses();
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Start the supervisor
      this.startWorkspaceProcess();
      
      console.log('✅ Workspace restart initiated');
      
    } catch (error) {
      console.error('❌ Restart failed:', error.message);
      
      // Try alternative restart method
      setTimeout(() => {
        this.alternativeRestart();
      }, 5000);
    }
  }

  async killExistingProcesses() {
    return new Promise((resolve) => {
      // Kill existing node processes
      exec('pkill -f "node.*tsx.*server" && pkill -f "node.*supervisor" && pkill -f "npm.*dev"', (error) => {
        // Don't worry about errors here
        console.log('🔪 Killed existing processes');
        resolve();
      });
    });
  }

  startWorkspaceProcess() {
    console.log('🚀 Starting workspace process...');
    
    // Start the supervisor which should start the server
    this.serverProcess = spawn('node', ['start-with-supervisor.js'], {
      stdio: 'inherit',
      detached: false,
      cwd: process.cwd()
    });

    this.serverProcess.on('error', (error) => {
      console.error('💥 Workspace process error:', error);
      setTimeout(() => this.forceRestart('process error'), 5000);
    });

    this.serverProcess.on('exit', (code) => {
      console.log(`💀 Workspace process exited with code ${code}`);
      this.serverProcess = null;
      setTimeout(() => this.forceRestart('process exit'), 3000);
    });
  }

  alternativeRestart() {
    console.log('🔄 Trying alternative restart method...');
    
    // Try starting with npm directly
    this.serverProcess = spawn('npm', ['run', 'dev'], {
      stdio: 'inherit',
      detached: false,
      cwd: process.cwd()
    });

    this.serverProcess.on('error', (error) => {
      console.error('💥 Alternative process error:', error);
    });

    this.serverProcess.on('exit', (code) => {
      console.log(`💀 Alternative process exited with code ${code}`);
      this.serverProcess = null;
    });
  }

  shutdown() {
    console.log('🛑 Workspace Guardian shutting down...');
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
    }
    process.exit(0);
  }
}

// Start the guardian
const guardian = new WorkspaceGuardian();
guardian.start();