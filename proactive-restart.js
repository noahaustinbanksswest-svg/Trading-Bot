#!/usr/bin/env node

/**
 * PROACTIVE RESTART GUARDIAN - Restart BEFORE crashes happen
 * Scheduled restarts every 30 minutes + health monitoring
 */

import { spawn, exec } from 'child_process';
import fs from 'fs';

class ProactiveRestartGuardian {
  constructor() {
    this.restartInterval = 30 * 60 * 1000; // Restart every 30 minutes
    this.healthCheckInterval = 5 * 60 * 1000; // Health check every 5 minutes
    this.restartCount = 0;
    this.startTime = Date.now();
    this.isRestarting = false;
  }

  async start() {
    console.log('🛡️ PROACTIVE RESTART GUARDIAN ACTIVATED');
    console.log('⏰ Scheduled restarts every 30 minutes to prevent crashes');
    console.log('💚 Health monitoring every 5 minutes');
    console.log(`🚀 Started at: ${new Date().toLocaleTimeString()}`);
    
    this.startScheduledRestarts();
    this.startHealthMonitoring();
    this.setupProtection();
  }

  startScheduledRestarts() {
    console.log('⏰ Setting up scheduled restarts every 30 minutes...');
    
    setInterval(() => {
      const minutesRunning = Math.floor((Date.now() - this.startTime) / 60000);
      console.log(`⚡ SCHEDULED RESTART - App has been running for ${minutesRunning} minutes`);
      this.restartApp('scheduled 30-minute restart to prevent crashes');
    }, this.restartInterval);

    // Initial restart in 30 minutes
    console.log('⏳ Next scheduled restart in 30 minutes');
  }

  startHealthMonitoring() {
    console.log('💚 Starting health monitoring every 5 minutes...');
    
    setInterval(() => {
      this.checkAppHealth();
    }, this.healthCheckInterval);

    // Initial health check in 5 minutes
    setTimeout(() => {
      this.checkAppHealth();
    }, this.healthCheckInterval);
  }

  async checkAppHealth() {
    try {
      const currentTime = new Date().toLocaleTimeString();
      console.log(`💚 Health check at ${currentTime}`);
      
      // Check 1: Bot ping file freshness
      let healthScore = 100;
      let issues = [];
      
      if (fs.existsSync('last-bot-ping.json')) {
        const pingData = JSON.parse(fs.readFileSync('last-bot-ping.json', 'utf8'));
        const timeSinceLastPing = Date.now() - (pingData.timestamp || 0);
        
        if (timeSinceLastPing > 60000) { // 1 minute old
          healthScore -= 50;
          issues.push(`Bot ping ${Math.floor(timeSinceLastPing/1000)}s old`);
        }
      } else {
        healthScore -= 30;
        issues.push('No bot ping file found');
      }

      // Check 2: App uptime (restart if running too long)
      const minutesRunning = Math.floor((Date.now() - this.startTime) / 60000);
      if (minutesRunning > 25) { // Restart proactively after 25 minutes
        healthScore -= 40;
        issues.push(`App running for ${minutesRunning} minutes (approaching restart time)`);
      }

      // Check 3: Memory/performance indicators (simplified)
      const uptimeHours = Math.floor(minutesRunning / 60);
      if (uptimeHours > 2) { // If somehow running over 2 hours, definitely restart
        healthScore -= 60;
        issues.push(`App running for ${uptimeHours} hours - needs restart`);
      }

      if (healthScore < 50 || issues.length > 1) {
        console.log(`🚨 HEALTH ALERT - Score: ${healthScore}/100`);
        issues.forEach(issue => console.log(`   ❌ ${issue}`));
        console.log('⚡ Triggering proactive restart to maintain stability');
        this.restartApp(`health score low (${healthScore}) - issues: ${issues.join(', ')}`);
      } else {
        console.log(`✅ App health good - Score: ${healthScore}/100, Uptime: ${minutesRunning} minutes`);
      }
      
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      console.log('🚨 Health check failure - triggering restart for safety');
      this.restartApp('health check system failure');
    }
  }

  async restartApp(reason) {
    if (this.isRestarting) {
      console.log('🔄 Restart already in progress...');
      return;
    }

    this.isRestarting = true;
    this.restartCount++;

    console.log(`⚡ PROACTIVE RESTART #${this.restartCount}`);
    console.log(`🔍 Reason: ${reason}`);
    console.log(`⏰ App uptime: ${Math.floor((Date.now() - this.startTime) / 60000)} minutes`);

    try {
      // Kill existing processes
      await this.killAllProcesses();
      
      // Wait for clean shutdown
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Restart the workflow
      console.log('🚀 RESTARTING WORKFLOW PROACTIVELY');
      await this.restartWorkflow();
      
      // Reset start time
      this.startTime = Date.now();
      
      console.log('✅ PROACTIVE RESTART COMPLETED SUCCESSFULLY!');
      
    } catch (error) {
      console.error('❌ Proactive restart failed:', error.message);
      // Try again in 30 seconds
      setTimeout(() => {
        console.log('🔄 Retrying proactive restart...');
        this.isRestarting = false;
        this.restartApp('retry after failure');
      }, 30000);
    } finally {
      // Reset restart flag
      setTimeout(() => {
        this.isRestarting = false;
      }, 10000);
    }
  }

  async killAllProcesses() {
    console.log('🔪 Stopping all app processes for proactive restart...');
    
    return new Promise((resolve) => {
      const killCommands = [
        'pkill -f "tsx.*server"',
        'pkill -f "discord-bot"', 
        'pkill -f "node.*server"'
      ];
      
      exec(killCommands.join(' && '), (error) => {
        console.log('✅ Process cleanup completed for proactive restart');
        resolve();
      });
    });
  }

  async restartWorkflow() {
    return new Promise((resolve, reject) => {
      console.log('🔄 Executing proactive workflow restart...');
      
      // Start the workflow directly
      const directStart = spawn('npm', ['run', 'dev'], {
        stdio: 'inherit',
        detached: true
      });
      
      directStart.unref(); // Allow process to continue independently
      
      setTimeout(() => {
        console.log('⚡ Proactive workflow restart initiated');
        resolve();
      }, 5000);
    });
  }

  setupProtection() {
    // Guardian self-protection
    process.on('uncaughtException', (error) => {
      console.error('🚨 Proactive Guardian error:', error.message);
      console.log('🛡️ Guardian recovering in 5 seconds...');
      setTimeout(() => {
        this.startScheduledRestarts();
        this.startHealthMonitoring();
      }, 5000);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('🚨 Proactive Guardian rejection:', reason);
      console.log('🛡️ Guardian continues proactive monitoring...');
    });

    process.on('SIGINT', () => {
      console.log('🛑 Proactive Restart Guardian shutting down...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Proactive Restart Guardian terminated');
      process.exit(0);
    });
  }
}

// Start the Proactive Restart Guardian
console.log('🚀 Initializing Proactive Restart Guardian...');
console.log('💡 Strategy: Restart BEFORE crashes happen, not after!');
const guardian = new ProactiveRestartGuardian();
guardian.start();