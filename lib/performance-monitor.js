class PerformanceMonitor {
    constructor() {
        this.isMonitoring = false;
        this.metrics = {
            cpu: [],
            memory: [],
            eventLoop: [],
            startTime: process.hrtime()
        };
        this.config = {
            cpuThreshold: 80, // CPU usage percentage
            memoryThreshold: 85, // Memory usage percentage
            eventLoopThreshold: 100, // Event loop lag in milliseconds
            historySize: 100 // Number of data points to keep
        };
        this.lastCpuUsage = process.cpuUsage();
        this.lastCheck = Date.now();
    }

    // Start monitoring performance metrics
    start() {
        this.isMonitoring = true;
        this.collectMetrics();
    }

    // Stop monitoring
    stop() {
        this.isMonitoring = false;
    }

    // Collect current performance metrics
    collectMetrics() {
        const now = Date.now();
        const currentCpuUsage = process.cpuUsage();
        const memoryUsage = process.memoryUsage();
        
        // Calculate CPU usage percentage
        const cpuPercent = this.calculateCpuPercent(currentCpuUsage);
        
        // Calculate memory usage percentage
        const memoryPercent = this.calculateMemoryPercent(memoryUsage);
        
        // Measure event loop lag
        const eventLoopStart = process.hrtime();
        setImmediate(() => {
            const eventLoopLag = process.hrtime(eventLoopStart);
            const lagMs = eventLoopLag[0] * 1000 + eventLoopLag[1] / 1000000;
            
            // Store metrics
            this.storeMetric('eventLoop', lagMs, now);
        });
        
        // Store CPU and memory metrics
        this.storeMetric('cpu', cpuPercent, now);
        this.storeMetric('memory', memoryPercent, now);
        
        // Update last values
        this.lastCpuUsage = currentCpuUsage;
        this.lastCheck = now;
        
        return {
            cpu: cpuPercent,
            memory: memoryPercent,
            memoryDetails: memoryUsage,
            timestamp: now
        };
    }

    // Calculate CPU usage percentage
    calculateCpuPercent(currentCpuUsage) {
        const timeDiff = Date.now() - this.lastCheck;
        if (timeDiff === 0) return 0;
        
        const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
        const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;
        const totalDiff = userDiff + systemDiff;
        
        // Convert microseconds to percentage
        const cpuPercent = (totalDiff / (timeDiff * 1000)) * 100;
        return Math.min(Math.max(cpuPercent, 0), 100);
    }

    // Calculate memory usage percentage
    calculateMemoryPercent(memoryUsage) {
        // Use RSS (Resident Set Size) as the primary memory metric
        const totalMemory = require('os').totalmem();
        return (memoryUsage.rss / totalMemory) * 100;
    }

    // Store metric in history with size limit
    storeMetric(type, value, timestamp) {
        this.metrics[type].push({
            value,
            timestamp
        });
        
        // Keep only recent history
        if (this.metrics[type].length > this.config.historySize) {
            this.metrics[type].shift();
        }
    }

    // Get current performance summary
    getPerformanceSummary() {
        const current = this.collectMetrics();
        const averages = this.calculateAverages();
        const alerts = this.checkThresholds(current);
        
        return {
            current,
            averages,
            alerts,
            uptime: this.getUptime(),
            processInfo: this.getProcessInfo()
        };
    }

    // Calculate averages for recent metrics
    calculateAverages(windowSize = 10) {
        const averages = {};
        
        ['cpu', 'memory', 'eventLoop'].forEach(type => {
            const recentMetrics = this.metrics[type].slice(-windowSize);
            if (recentMetrics.length > 0) {
                const sum = recentMetrics.reduce((acc, metric) => acc + metric.value, 0);
                averages[type] = sum / recentMetrics.length;
            } else {
                averages[type] = 0;
            }
        });
        
        return averages;
    }

    // Check if any metrics exceed thresholds
    checkThresholds(current) {
        const alerts = [];
        
        if (current.cpu > this.config.cpuThreshold) {
            alerts.push({
                type: 'cpu',
                message: `High CPU usage: ${current.cpu.toFixed(1)}%`,
                severity: 'warning',
                threshold: this.config.cpuThreshold,
                current: current.cpu
            });
        }
        
        if (current.memory > this.config.memoryThreshold) {
            alerts.push({
                type: 'memory',
                message: `High memory usage: ${current.memory.toFixed(1)}%`,
                severity: 'warning',
                threshold: this.config.memoryThreshold,
                current: current.memory
            });
        }
        
        // Check event loop lag from recent metrics
        const recentEventLoopMetrics = this.metrics.eventLoop.slice(-1);
        if (recentEventLoopMetrics.length > 0) {
            const currentLag = recentEventLoopMetrics[0].value;
            if (currentLag > this.config.eventLoopThreshold) {
                alerts.push({
                    type: 'eventLoop',
                    message: `High event loop lag: ${currentLag.toFixed(1)}ms`,
                    severity: 'warning',
                    threshold: this.config.eventLoopThreshold,
                    current: currentLag
                });
            }
        }
        
        return alerts;
    }

    // Get process uptime
    getUptime() {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        return {
            seconds: uptime,
            formatted: `${hours}h ${minutes}m ${seconds}s`
        };
    }

    // Get process information
    getProcessInfo() {
        return {
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            title: process.title
        };
    }

    // Update configuration
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    // Get recent metrics for a specific type
    getRecentMetrics(type, count = 10) {
        return this.metrics[type].slice(-count);
    }

    // Clear all metrics history
    clearHistory() {
        this.metrics.cpu = [];
        this.metrics.memory = [];
        this.metrics.eventLoop = [];
    }

    // Check if performance monitoring is healthy
    isHealthy() {
        const summary = this.getPerformanceSummary();
        return summary.alerts.length === 0;
    }

    // Get performance trend (improving, degrading, stable)
    getTrend(type, windowSize = 20) {
        const metrics = this.metrics[type];
        if (metrics.length < windowSize) {
            return 'insufficient_data';
        }
        
        const recent = metrics.slice(-windowSize);
        const firstHalf = recent.slice(0, Math.floor(windowSize / 2));
        const secondHalf = recent.slice(Math.floor(windowSize / 2));
        
        const firstAvg = firstHalf.reduce((acc, m) => acc + m.value, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((acc, m) => acc + m.value, 0) / secondHalf.length;
        
        const difference = secondAvg - firstAvg;
        const threshold = 5; // 5% change threshold
        
        if (difference > threshold) {
            return 'degrading';
        } else if (difference < -threshold) {
            return 'improving';
        } else {
            return 'stable';
        }
    }
}

module.exports = PerformanceMonitor;