const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PerformanceDatabase {
    constructor(dbPath = null) {
        this.db = null;
        this.dbPath = dbPath || path.join(process.cwd(), 'performance_metrics.db');
        this.retentionDays = 7; // Default retention period
        this.initialized = false;
        this.initDatabase();
    }

    // Initialize SQLite database
    initDatabase() {
        try {
            this.db = new sqlite3.Database(this.dbPath);
            
            // Create tables if they don't exist
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS performance_metrics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        cpu_usage REAL NOT NULL,
                        memory_usage REAL NOT NULL,
                        memory_rss INTEGER NOT NULL,
                        event_loop_lag REAL DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS alert_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        metric_type TEXT NOT NULL,
                        threshold_value REAL NOT NULL,
                        current_value REAL NOT NULL,
                        duration_minutes REAL NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                // Create indexes for better performance
                this.db.run('CREATE INDEX IF NOT EXISTS idx_created_at_metrics ON performance_metrics(created_at)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_created_at_alerts ON alert_history(created_at)');
                this.db.run('CREATE INDEX IF NOT EXISTS idx_metric_type ON alert_history(metric_type)');
                
                this.initialized = true;
            });
        } catch (error) {
            console.error('Failed to initialize performance database:', error);
            this.initialized = false;
        }
    }

    // Store metrics in database
    async storeMetrics(cpuUsage, memoryUsage, memoryRss, eventLoopLag) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const roundedCpuUsage = Math.round(cpuUsage * 100) / 100;
            const roundedMemoryUsage = Math.round(memoryUsage * 100) / 100;
            const roundedEventLoopLag = Math.round(eventLoopLag * 100) / 100;
            
            const stmt = this.db.prepare(`
                INSERT INTO performance_metrics (cpu_usage, memory_usage, memory_rss, event_loop_lag)
                VALUES (?, ?, ?, ?)
            `);
            
            stmt.run(roundedCpuUsage, roundedMemoryUsage, memoryRss, roundedEventLoopLag, function(err) {
                stmt.finalize(); // Always finalize, even on error
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    // Record alert in database
    async recordAlert(metricType, threshold, currentValue, durationMinutes) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const roundedThreshold = Math.round(threshold * 100) / 100;
            const roundedCurrentValue = Math.round(currentValue * 100) / 100;
            const roundedDurationMinutes = Math.round(durationMinutes * 100) / 100;
            
            const stmt = this.db.prepare(`
                INSERT INTO alert_history (metric_type, threshold_value, current_value, duration_minutes)
                VALUES (?, ?, ?, ?)
            `);
            
            stmt.run(metricType, roundedThreshold, roundedCurrentValue, roundedDurationMinutes, function(err) {
                stmt.finalize(); // Always finalize, even on error
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    // Calculate averages from database
    async getAverages(windowMinutes = 10) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const since = new Date(Date.now() - (windowMinutes * 60 * 1000)).toISOString();
            
            this.db.get(`
                SELECT 
                    AVG(cpu_usage) as cpu,
                    AVG(memory_usage) as memory,
                    AVG(event_loop_lag) as eventLoop
                FROM performance_metrics 
                WHERE created_at > ?
            `, [since], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        cpu: Math.round((row.cpu || 0) * 100) / 100,
                        memory: Math.round((row.memory || 0) * 100) / 100,
                        eventLoop: Math.round((row.eventLoop || 0) * 100) / 100
                    });
                }
            });
        });
    }

    // Check if metric has been sustained above threshold
    async checkSustainedMetric(metricColumn, threshold, durationMs) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const since = new Date(Date.now() - durationMs).toISOString();
            
            this.db.get(`
                SELECT COUNT(*) as count,
                       COUNT(CASE WHEN ${metricColumn} > ? THEN 1 END) as above_threshold
                FROM performance_metrics 
                WHERE created_at > ?
            `, [threshold, since], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    // Consider it sustained if more than 80% of readings are above threshold
                    const sustainedRatio = row.above_threshold / Math.max(row.count, 1);
                    resolve({
                        sustained: sustainedRatio > 0.8 && row.count > 5,
                        ratio: Math.round(sustainedRatio * 100) / 100,
                        totalReadings: row.count,
                        exceedingReadings: row.above_threshold
                    });
                }
            });
        });
    }

    // Get recent metrics from database
    async getRecentMetrics(metricType, count = 10) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const column = metricType === 'cpu' ? 'cpu_usage' : 
                metricType === 'memory' ? 'memory_usage' : 
                    'event_loop_lag';
            
            this.db.all(`
                SELECT created_at, ${column} as value
                FROM performance_metrics 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [count], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const roundedRows = rows.map(row => ({
                        created_at: row.created_at,
                        value: Math.round(row.value * 100) / 100
                    }));
                    resolve(roundedRows.reverse()); // Return in chronological order
                }
            });
        });
    }

    // Get alert history from database
    async getAlertHistory(limitCount = 50) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            this.db.all(`
                SELECT * FROM alert_history 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [limitCount], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const roundedRows = rows.map(row => ({
                        ...row,
                        threshold_value: Math.round(row.threshold_value * 100) / 100,
                        current_value: Math.round(row.current_value * 100) / 100,
                        duration_minutes: Math.round(row.duration_minutes * 100) / 100
                    }));
                    resolve(roundedRows);
                }
            });
        });
    }

    // Get performance trend from database
    async getTrend(metricType, windowMinutes = 60) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const column = metricType === 'cpu' ? 'cpu_usage' : 
                metricType === 'memory' ? 'memory_usage' : 
                    'event_loop_lag';
            
            const since = new Date(Date.now() - (windowMinutes * 60 * 1000)).toISOString();
            const midPoint = new Date(Date.now() - (windowMinutes * 30 * 1000)).toISOString();
            
            this.db.get(`
                SELECT 
                    AVG(CASE WHEN created_at < ? THEN ${column} END) as first_half,
                    AVG(CASE WHEN created_at >= ? THEN ${column} END) as second_half,
                    COUNT(*) as total_count
                FROM performance_metrics 
                WHERE created_at > ?
            `, [midPoint, midPoint, since], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row.total_count < 20) {
                    resolve('insufficient_data');
                } else {
                    const difference = row.second_half - row.first_half;
                    const threshold = 5; // 5% change threshold
                    
                    if (difference > threshold) {
                        resolve('degrading');
                    } else if (difference < -threshold) {
                        resolve('improving');
                    } else {
                        resolve('stable');
                    }
                }
            });
        });
    }

    // Prune old data based on retention policy
    async pruneOldData(retentionDays = null) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const days = retentionDays || this.retentionDays;
            const cutoffTime = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
            
            // Use transaction for atomic operation
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                
                // Delete old performance metrics
                this.db.run('DELETE FROM performance_metrics WHERE created_at < ?', [cutoffTime], (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error pruning old metrics: ' + err.message));
                        return;
                    }
                });
                
                // Delete old alert history
                this.db.run('DELETE FROM alert_history WHERE created_at < ?', [cutoffTime], (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error pruning old alerts: ' + err.message));
                        return;
                    }
                });
                
                // Commit transaction
                this.db.run('COMMIT', (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error committing prune operation: ' + err.message));
                    } else {
                        resolve({ message: `Pruned data older than ${days} days`, cutoffTime });
                    }
                });
            });
        });
    }

    // Get database statistics
    async getStats() {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const since24h = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
            
            this.db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM performance_metrics) as total_metrics,
                    (SELECT COUNT(*) FROM alert_history) as total_alerts,
                    (SELECT MIN(created_at) FROM performance_metrics) as oldest_metric,
                    (SELECT MAX(created_at) FROM performance_metrics) as newest_metric,
                    (SELECT COUNT(*) FROM performance_metrics WHERE created_at > ?) as recent_metrics
            `, [since24h], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        totalMetrics: row.total_metrics,
                        totalAlerts: row.total_alerts,
                        oldestMetric: row.oldest_metric,
                        newestMetric: row.newest_metric,
                        recentMetrics: row.recent_metrics,
                        dbPath: this.dbPath
                    });
                }
            });
        });
    }

    // Clear all data
    async clearAll() {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                
                this.db.run('DELETE FROM performance_metrics', (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error clearing metrics: ' + err.message));
                        return;
                    }
                });
                
                this.db.run('DELETE FROM alert_history', (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error clearing alerts: ' + err.message));
                        return;
                    }
                });
                
                this.db.run('COMMIT', (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error committing clear operation: ' + err.message));
                    } else {
                        resolve({ message: 'All data cleared successfully' });
                    }
                });
            });
        });
    }

    // Set retention policy
    setRetentionDays(days) {
        this.retentionDays = Math.max(1, Math.min(30, days)); // Between 1 and 30 days
    }

    // Close database connection
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('Database connection closed');
                }
            });
            this.db = null;
            this.initialized = false;
        }
    }
}

module.exports = PerformanceDatabase;