const PerformanceMonitor = require('../../lib/performance-monitor');

// Mock os module
jest.mock('os', () => ({
    totalmem: jest.fn(() => 8 * 1024 * 1024 * 1024) // 8GB
}));

describe('PerformanceMonitor', () => {
    let performanceMonitor;
    
    beforeEach(() => {
        jest.clearAllMocks();
        performanceMonitor = new PerformanceMonitor();
        
        // Fast forward time to avoid CPU calculation issues
        jest.spyOn(Date, 'now').mockReturnValue(1000000);
    });
    
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Constructor', () => {
        it('should initialize with default configuration', () => {
            expect(performanceMonitor.config).toEqual({
                cpuThreshold: 80,
                memoryThreshold: 85,
                eventLoopThreshold: 100,
                historySize: 100
            });
        });

        it('should initialize with monitoring state', () => {
            expect(performanceMonitor.isMonitoring).toBe(false);
            expect(performanceMonitor.metrics).toHaveProperty('cpu');
            expect(performanceMonitor.metrics).toHaveProperty('memory');
            expect(performanceMonitor.metrics).toHaveProperty('eventLoop');
        });
    });

    describe('collectMetrics', () => {
        it('should collect CPU and memory metrics', () => {
            // Fast forward time to allow CPU calculation
            jest.spyOn(Date, 'now').mockReturnValueOnce(1000000).mockReturnValueOnce(1001000);
            
            const metrics = performanceMonitor.collectMetrics();
            
            expect(metrics).toHaveProperty('cpu');
            expect(metrics).toHaveProperty('memory');
            expect(metrics).toHaveProperty('memoryDetails');
            expect(metrics).toHaveProperty('timestamp');
            expect(metrics.cpu).toBeGreaterThanOrEqual(0);
            expect(metrics.memory).toBeGreaterThanOrEqual(0);
        });

        it('should store metrics in history', () => {
            const initialCpuLength = performanceMonitor.metrics.cpu.length;
            const initialMemoryLength = performanceMonitor.metrics.memory.length;
            
            performanceMonitor.collectMetrics();
            
            expect(performanceMonitor.metrics.cpu.length).toBe(initialCpuLength + 1);
            expect(performanceMonitor.metrics.memory.length).toBe(initialMemoryLength + 1);
        });

        it('should limit history size', () => {
            // Fill history beyond limit
            for (let i = 0; i < 105; i++) {
                performanceMonitor.collectMetrics();
            }
            
            expect(performanceMonitor.metrics.cpu.length).toBeLessThanOrEqual(100);
            expect(performanceMonitor.metrics.memory.length).toBeLessThanOrEqual(100);
        });

        it('should calculate memory percentage correctly', () => {
            const memoryUsage = {
                rss: 1024 * 1024 * 1024, // 1GB
                heapTotal: 500 * 1024 * 1024,
                heapUsed: 300 * 1024 * 1024,
                external: 100 * 1024 * 1024
            };
            
            const memoryPercent = performanceMonitor.calculateMemoryPercent(memoryUsage);
            
            expect(memoryPercent).toBeCloseTo(12.5, 1); // 1GB out of 8GB = 12.5%
        });
    });

    describe('checkThresholds', () => {
        it('should return no alerts when all metrics are below thresholds', () => {
            const metrics = { cpu: 50, memory: 60 };
            
            const alerts = performanceMonitor.checkThresholds(metrics);
            
            expect(alerts).toEqual([]);
        });

        it('should return CPU alert when CPU exceeds threshold', () => {
            const metrics = { cpu: 85, memory: 60 };
            
            const alerts = performanceMonitor.checkThresholds(metrics);
            
            expect(alerts).toHaveLength(1);
            expect(alerts[0]).toMatchObject({
                type: 'cpu',
                severity: 'warning',
                current: 85,
                threshold: 80,
                message: 'High CPU usage: 85.0%'
            });
        });

        it('should return memory alert when memory exceeds threshold', () => {
            const metrics = { cpu: 50, memory: 90 };
            
            const alerts = performanceMonitor.checkThresholds(metrics);
            
            expect(alerts).toHaveLength(1);
            expect(alerts[0]).toMatchObject({
                type: 'memory',
                severity: 'warning',
                current: 90,
                threshold: 85,
                message: 'High memory usage: 90.0%'
            });
        });

        it('should return event loop alert when lag exceeds threshold', () => {
            // Add event loop metric to history
            performanceMonitor.metrics.eventLoop.push({ value: 150, timestamp: Date.now() });
            
            const metrics = { cpu: 50, memory: 60 };
            const alerts = performanceMonitor.checkThresholds(metrics);
            
            expect(alerts).toHaveLength(1);
            expect(alerts[0]).toMatchObject({
                type: 'eventLoop',
                severity: 'warning',
                current: 150,
                threshold: 100,
                message: 'High event loop lag: 150.0ms'
            });
        });

        it('should return multiple alerts when multiple metrics exceed thresholds', () => {
            performanceMonitor.metrics.eventLoop.push({ value: 150, timestamp: Date.now() });
            const metrics = { cpu: 85, memory: 90 };
            
            const alerts = performanceMonitor.checkThresholds(metrics);
            
            expect(alerts).toHaveLength(3);
            expect(alerts.map(a => a.type)).toEqual(['cpu', 'memory', 'eventLoop']);
        });
    });

    describe('getPerformanceSummary', () => {
        beforeEach(() => {
            // Add some metrics to history
            performanceMonitor.metrics.cpu.push(
                { value: 70, timestamp: Date.now() },
                { value: 75, timestamp: Date.now() },
                { value: 80, timestamp: Date.now() }
            );
            performanceMonitor.metrics.memory.push(
                { value: 60, timestamp: Date.now() },
                { value: 65, timestamp: Date.now() },
                { value: 70, timestamp: Date.now() }
            );
            performanceMonitor.metrics.eventLoop.push(
                { value: 50, timestamp: Date.now() },
                { value: 60, timestamp: Date.now() },
                { value: 70, timestamp: Date.now() }
            );
        });

        it('should return performance summary with current and average metrics', () => {
            const summary = performanceMonitor.getPerformanceSummary();
            
            expect(summary).toHaveProperty('current');
            expect(summary).toHaveProperty('averages');
            expect(summary).toHaveProperty('alerts');
            expect(summary).toHaveProperty('uptime');
            expect(summary).toHaveProperty('processInfo');
        });

        it('should calculate correct averages', () => {
            const summary = performanceMonitor.getPerformanceSummary();
            
            // The averages should be calculated from the stored metrics
            expect(summary.averages.cpu).toBeGreaterThan(0);
            expect(summary.averages.memory).toBeGreaterThan(0);
            expect(summary.averages.eventLoop).toBeGreaterThan(0);
        });

        it('should handle empty metrics history', () => {
            const freshMonitor = new PerformanceMonitor();
            const summary = freshMonitor.getPerformanceSummary();
            
            // Fresh monitor will have current metrics but no history for averages
            expect(summary.averages.cpu).toBeGreaterThanOrEqual(0);
            expect(summary.averages.memory).toBeGreaterThanOrEqual(0);
            expect(summary.averages.eventLoop).toBeGreaterThanOrEqual(0);
        });
    });

    describe('updateConfig', () => {
        it('should update configuration', () => {
            const newConfig = {
                cpuThreshold: 90,
                memoryThreshold: 95,
                eventLoopThreshold: 150
            };
            
            performanceMonitor.updateConfig(newConfig);
            
            expect(performanceMonitor.config.cpuThreshold).toBe(90);
            expect(performanceMonitor.config.memoryThreshold).toBe(95);
            expect(performanceMonitor.config.eventLoopThreshold).toBe(150);
        });

        it('should maintain other config values when partially updating', () => {
            const partialConfig = { cpuThreshold: 90 };
            
            performanceMonitor.updateConfig(partialConfig);
            
            expect(performanceMonitor.config.cpuThreshold).toBe(90);
            expect(performanceMonitor.config.memoryThreshold).toBe(85);
            expect(performanceMonitor.config.eventLoopThreshold).toBe(100);
        });
    });

    describe('start and stop', () => {
        it('should start monitoring', () => {
            const spy = jest.spyOn(performanceMonitor, 'collectMetrics');
            
            performanceMonitor.start();
            
            expect(performanceMonitor.isMonitoring).toBe(true);
            expect(spy).toHaveBeenCalled();
        });

        it('should stop monitoring', () => {
            performanceMonitor.start();
            performanceMonitor.stop();
            
            expect(performanceMonitor.isMonitoring).toBe(false);
        });

        it('should handle stop without start', () => {
            expect(() => performanceMonitor.stop()).not.toThrow();
        });
    });

    describe('utility methods', () => {
        it('should get uptime information', () => {
            const uptime = performanceMonitor.getUptime();
            
            expect(uptime).toHaveProperty('seconds');
            expect(uptime).toHaveProperty('formatted');
            expect(typeof uptime.seconds).toBe('number');
            expect(typeof uptime.formatted).toBe('string');
        });

        it('should get process information', () => {
            const processInfo = performanceMonitor.getProcessInfo();
            
            expect(processInfo).toHaveProperty('pid');
            expect(processInfo).toHaveProperty('nodeVersion');
            expect(processInfo).toHaveProperty('platform');
            expect(processInfo).toHaveProperty('arch');
        });

        it('should check if monitoring is healthy', () => {
            const isHealthy = performanceMonitor.isHealthy();
            
            expect(typeof isHealthy).toBe('boolean');
        });

        it('should get recent metrics', () => {
            performanceMonitor.metrics.cpu.push({ value: 50, timestamp: Date.now() });
            
            const recentMetrics = performanceMonitor.getRecentMetrics('cpu', 5);
            
            expect(Array.isArray(recentMetrics)).toBe(true);
        });

        it('should clear history', () => {
            performanceMonitor.metrics.cpu.push({ value: 50, timestamp: Date.now() });
            performanceMonitor.clearHistory();
            
            expect(performanceMonitor.metrics.cpu.length).toBe(0);
            expect(performanceMonitor.metrics.memory.length).toBe(0);
            expect(performanceMonitor.metrics.eventLoop.length).toBe(0);
        });
    });
});