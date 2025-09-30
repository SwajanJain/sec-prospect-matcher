#!/usr/bin/env node

/**
 * Memory Monitoring Test for SEC Prospect Matcher
 * Monitors memory usage during processing to detect potential crashes
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class MemoryMonitor {
    constructor() {
        this.measurements = [];
        this.startTime = Date.now();
        this.maxMemory = 0;
        this.warningThreshold = 6 * 1024 * 1024 * 1024; // 6GB warning
        this.criticalThreshold = 7.5 * 1024 * 1024 * 1024; // 7.5GB critical
    }

    startMonitoring(processName = 'node.*server.js') {
        console.log('🔍 Starting memory monitoring...');
        console.log(`📊 Warning threshold: ${(this.warningThreshold / 1024 / 1024 / 1024).toFixed(1)}GB`);
        console.log(`🚨 Critical threshold: ${(this.criticalThreshold / 1024 / 1024 / 1024).toFixed(1)}GB`);

        this.interval = setInterval(() => {
            this.checkMemoryUsage(processName);
        }, 2000); // Check every 2 seconds

        // Log initial memory
        this.checkMemoryUsage(processName);
    }

    checkMemoryUsage(processName) {
        const ps = spawn('ps', ['aux']);
        const grep = spawn('grep', ['-E', processName]);

        ps.stdout.pipe(grep.stdin);

        let output = '';
        grep.stdout.on('data', (data) => {
            output += data.toString();
        });

        grep.on('close', () => {
            const lines = output.trim().split('\\n').filter(line =>
                line.includes('node') && !line.includes('grep')
            );

            if (lines.length > 0) {
                // Get the line with highest memory usage
                const memoryUsages = lines.map(line => {
                    const parts = line.trim().split(/\\s+/);
                    const memPercent = parseFloat(parts[3]);
                    const rss = parseInt(parts[5]) * 1024; // Convert KB to bytes
                    return { memPercent, rss, line };
                });

                const maxUsage = memoryUsages.reduce((max, current) =>
                    current.rss > max.rss ? current : max
                );

                this.recordMeasurement(maxUsage.rss, maxUsage.memPercent);
            }
        });
    }

    recordMeasurement(memoryBytes, memPercent) {
        const timestamp = Date.now();
        const elapsed = Math.round((timestamp - this.startTime) / 1000);
        const memoryMB = Math.round(memoryBytes / 1024 / 1024);
        const memoryGB = (memoryBytes / 1024 / 1024 / 1024).toFixed(2);

        this.measurements.push({
            timestamp,
            elapsed,
            memoryBytes,
            memoryMB,
            memoryGB: parseFloat(memoryGB),
            memPercent
        });

        // Update max memory
        if (memoryBytes > this.maxMemory) {
            this.maxMemory = memoryBytes;
        }

        // Console output with color coding
        let status = '✅';
        if (memoryBytes > this.criticalThreshold) {
            status = '🚨 CRITICAL';
        } else if (memoryBytes > this.warningThreshold) {
            status = '⚠️  WARNING';
        }

        console.log(`${status} [${elapsed}s] Memory: ${memoryGB}GB (${memPercent}%) - RSS: ${memoryMB}MB`);

        // Alert on high memory usage
        if (memoryBytes > this.criticalThreshold) {
            console.log('🚨🚨🚨 CRITICAL MEMORY USAGE - CRASH LIKELY! 🚨🚨🚨');
            this.generateAlert();
        }
    }

    generateAlert() {
        const alertTime = new Date().toISOString();
        console.log(`\\n⚠️  MEMORY ALERT at ${alertTime}`);
        console.log(`📊 Current memory: ${(this.maxMemory / 1024 / 1024 / 1024).toFixed(2)}GB`);
        console.log(`🎯 Recommended action: Monitor for crash or restart server`);
        console.log();
    }

    stopMonitoring() {
        if (this.interval) {
            clearInterval(this.interval);
        }
        this.generateReport();
    }

    generateReport() {
        const duration = Math.round((Date.now() - this.startTime) / 1000);
        const maxMemoryGB = (this.maxMemory / 1024 / 1024 / 1024).toFixed(2);
        const avgMemory = this.measurements.length > 0 ?
            this.measurements.reduce((sum, m) => sum + m.memoryGB, 0) / this.measurements.length : 0;

        console.log('\\n📋 MEMORY MONITORING REPORT');
        console.log('================================');
        console.log(`⏱️  Duration: ${duration} seconds`);
        console.log(`📊 Measurements: ${this.measurements.length}`);
        console.log(`🔺 Peak memory: ${maxMemoryGB}GB`);
        console.log(`📈 Average memory: ${avgMemory.toFixed(2)}GB`);
        console.log(`🎯 Crash risk: ${maxMemoryGB > 7.5 ? 'HIGH' : maxMemoryGB > 6 ? 'MEDIUM' : 'LOW'}`);

        // Save detailed report
        const reportPath = path.join(__dirname, `memory_report_${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            summary: {
                duration,
                peakMemoryGB: parseFloat(maxMemoryGB),
                averageMemoryGB: parseFloat(avgMemory.toFixed(2)),
                measurementCount: this.measurements.length,
                crashRisk: maxMemoryGB > 7.5 ? 'HIGH' : maxMemoryGB > 6 ? 'MEDIUM' : 'LOW'
            },
            measurements: this.measurements
        }, null, 2));

        console.log(`💾 Detailed report saved: ${reportPath}`);
    }
}

// CLI Usage
if (require.main === module) {
    const monitor = new MemoryMonitor();

    console.log('🚀 Starting SEC Prospect Matcher Memory Monitor');
    console.log('Press Ctrl+C to stop monitoring and generate report\\n');

    monitor.startMonitoring();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\\n🛑 Stopping memory monitor...');
        monitor.stopMonitoring();
        process.exit(0);
    });
}

module.exports = MemoryMonitor;