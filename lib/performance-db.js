const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PerformanceDatabase {
    constructor(dbPath = null) {
        this.db = null;
        this.dbPath = dbPath || this.getDefaultDbPath();
        this.retentionDays = 7; // Default retention period
        this.initialized = false;
        this.operationQueue = [];
        this.isProcessingQueue = false;
        this.creationMessages = [];
        // Don't automatically initialize database - wait for explicit creation
    }

    // Get default database path with fallback options
    getDefaultDbPath() {
        const packagePath = path.join(__dirname, '..', 'performance_metrics.db');
        return packagePath;
    }

    // Get fallback paths for database creation
    getFallbackPaths() {
        const os = require('os');
        const packagePath = path.join(__dirname, '..', 'performance_metrics.db');
        
        return [
            {
                path: packagePath,
                description: 'package root folder'
            },
            {
                path: path.join(process.env.HOME || process.env.USERPROFILE || os.tmpdir(), '.node-red', 'performance_metrics.db'),
                description: 'user Node-RED directory'
            },
            {
                path: path.join(os.tmpdir(), 'node-red-performance_metrics.db'),
                description: 'system temporary directory'
            }
        ];
    }

    // Check if database exists
    databaseExists() {
        const fs = require('fs');
        return fs.existsSync(this.dbPath);
    }

    // Initialize SQLite database with proper error handling
    initDatabase() {
        return new Promise((resolve, reject) => {
            try {
                // Use callback constructor to catch connection errors
                this.db = new sqlite3.Database(this.dbPath, (err) => {
                    if (err) {
                        this.initialized = false;
                        reject(err);
                        return;
                    }
                    
                    // Database opened successfully, configure it
                    this.db.configure("busyTimeout", 30000);
                    
                    // Run pragma statements with error handling
                    this.db.serialize(() => {
                        let completedOperations = 0;
                        const totalOperations = 10; // Number of CREATE operations below
                        let hasError = false;
                        
                        const checkCompletion = (err) => {
                            if (err && !hasError) {
                                hasError = true;
                                this.initialized = false;
                                reject(err);
                                return;
                            }
                            
                            completedOperations++;
                            if (completedOperations === totalOperations && !hasError) {
                                this.initialized = true;
                                resolve();
                            }
                        };
                        
                        // Configure database for better concurrency
                        this.db.run("PRAGMA journal_mode = WAL", checkCompletion);
                        this.db.run("PRAGMA synchronous = NORMAL", checkCompletion);
                        this.db.run("PRAGMA cache_size = 1000", checkCompletion);
                        this.db.run("PRAGMA temp_store = MEMORY", checkCompletion);
                        
                        // Create tables with error handling
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS performance_metrics (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                cpu_usage REAL NOT NULL,
                                memory_usage REAL NOT NULL,
                                memory_rss INTEGER NOT NULL,
                                event_loop_lag REAL DEFAULT 0,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, checkCompletion);
                        
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS alert_history (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                metric_type TEXT NOT NULL,
                                threshold_value REAL NOT NULL,
                                current_value REAL NOT NULL,
                                duration_minutes REAL NOT NULL,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, checkCompletion);
                        
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS code_quality_metrics (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                flow_id TEXT NOT NULL,
                                flow_name TEXT,
                                total_issues INTEGER NOT NULL DEFAULT 0,
                                nodes_with_issues INTEGER NOT NULL DEFAULT 0,
                                nodes_with_critical_issues INTEGER NOT NULL DEFAULT 0,
                                total_function_nodes INTEGER NOT NULL DEFAULT 0,
                                issue_types TEXT,
                                quality_score REAL NOT NULL DEFAULT 100,
                                complexity_score REAL NOT NULL DEFAULT 0,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, checkCompletion);
                        
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS node_quality_metrics (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                flow_id TEXT NOT NULL,
                                node_id TEXT NOT NULL,
                                node_name TEXT,
                                node_type TEXT DEFAULT 'function',
                                issues_count INTEGER NOT NULL DEFAULT 0,
                                issue_details TEXT,
                                complexity_score REAL NOT NULL DEFAULT 0,
                                lines_of_code INTEGER DEFAULT 0,
                                quality_score REAL NOT NULL DEFAULT 100,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, checkCompletion);
                        
                        // Create indexes
                        this.db.run('CREATE INDEX IF NOT EXISTS idx_created_at_metrics ON performance_metrics(created_at)', checkCompletion);
                        this.db.run('CREATE INDEX IF NOT EXISTS idx_code_quality_created_at ON code_quality_metrics(created_at)', checkCompletion);
                        
                        // Migration: Add nodes_with_critical_issues column (ignore errors for this one)
                        this.db.run(`
                            ALTER TABLE code_quality_metrics 
                            ADD COLUMN nodes_with_critical_issues INTEGER NOT NULL DEFAULT 0
                        `, (err) => {
                            // This operation doesn't count towards completion as it might fail (column exists)
                            // Just continue
                        });
                    });
                });
            } catch (error) {
                this.initialized = false;
                reject(error);
            }
        });
    }

    // Create database and initialize tables with fallback paths (manual creation)
    createDatabase(progressCallback = null) {
        return new Promise(async (resolve, reject) => {
            const fallbackPaths = this.getFallbackPaths();
            this.creationMessages = [];
            
            for (let i = 0; i < fallbackPaths.length; i++) {
                const fallback = fallbackPaths[i];
                const attemptMessage = `Trying to create database in ${fallback.description} (${fallback.path})...`;
                
                this.creationMessages.push({
                    type: 'info',
                    message: attemptMessage
                });
                
                // Send progress update if callback provided
                if (progressCallback) {
                    progressCallback({
                        attempt: i + 1,
                        total: fallbackPaths.length,
                        location: fallback.description,
                        path: fallback.path,
                        messages: [...this.creationMessages]
                    });
                }
                
                try {
                    // Ensure directory exists for this path
                    const fs = require('fs');
                    const dbDir = path.dirname(fallback.path);
                    
                    if (!fs.existsSync(dbDir)) {
                        fs.mkdirSync(dbDir, { recursive: true });
                    }
                    
                    // Set the current path and try to create database
                    this.dbPath = fallback.path;
                    await this.initDatabase();
                    
                    // Success!
                    const successMessage = `✓ Database created successfully in ${fallback.description}`;
                    this.creationMessages.push({
                        type: 'success',
                        message: successMessage
                    });
                    
                    if (progressCallback) {
                        progressCallback({
                            attempt: i + 1,
                            total: fallbackPaths.length,
                            location: fallback.description,
                            path: fallback.path,
                            messages: [...this.creationMessages],
                            success: true
                        });
                    }
                    
                    resolve({
                        success: true,
                        message: successMessage,
                        dbPath: this.dbPath,
                        attemptedLocations: i + 1,
                        messages: [...this.creationMessages]
                    });
                    return;
                    
                } catch (error) {
                    // Failed at this location
                    const errorMessage = `✗ Failed to create database in ${fallback.description}: ${error.message}`;
                    this.creationMessages.push({
                        type: 'error',
                        message: errorMessage
                    });
                    
                    if (progressCallback) {
                        progressCallback({
                            attempt: i + 1,
                            total: fallbackPaths.length,
                            location: fallback.description,
                            path: fallback.path,
                            messages: [...this.creationMessages],
                            error: error.message
                        });
                    }
                    
                    // If this is the last attempt, reject
                    if (i === fallbackPaths.length - 1) {
                        reject(new Error(`Failed to create database in all ${fallbackPaths.length} locations. Last error: ${error.message}`));
                        return;
                    }
                    
                    // Add waiting message before next attempt
                    const waitMessage = `Waiting 1.5 seconds before trying next location...`;
                    this.creationMessages.push({
                        type: 'info',
                        message: waitMessage
                    });
                    
                    if (progressCallback) {
                        progressCallback({
                            attempt: i + 1,
                            total: fallbackPaths.length,
                            location: 'waiting',
                            path: 'N/A',
                            messages: [...this.creationMessages],
                            waiting: true
                        });
                    }
                    
                    // Wait 1.5 seconds before trying next fallback for better UX
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
        });
    }

    // Queue management for preventing concurrent access issues
    async executeOperation(operation) {
        return new Promise((resolve, reject) => {
            this.operationQueue.push({ operation, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessingQueue || this.operationQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        
        while (this.operationQueue.length > 0) {
            const { operation, resolve, reject } = this.operationQueue.shift();
            
            try {
                const result = await operation();
                resolve(result);
            } catch (error) {
                // Retry once for SQLITE_BUSY errors
                if (error.message.includes('SQLITE_BUSY')) {
                    try {
                        // Wait a random amount between 10-100ms to reduce collision
                        await new Promise(res => setTimeout(res, 10 + Math.random() * 90));
                        const result = await operation();
                        resolve(result);
                    } catch (retryError) {
                        reject(retryError);
                    }
                } else {
                    reject(error);
                }
            }
        }
        
        this.isProcessingQueue = false;
    }

    // Store metrics in database
    async storeMetrics(cpuUsage, memoryUsage, memoryRss, eventLoopLag) {
        return this.executeOperation(() => {
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
        });
    }

    // Record alert in database
    async recordAlert(metricType, threshold, currentValue, durationMinutes) {
        return this.executeOperation(() => {
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
            
            const since = new Date(Date.now() - durationMs).toISOString().replace('T', ' ').replace('Z', '');
            
            this.db.get(`
                SELECT COUNT(*) as count,
                       COUNT(CASE WHEN CAST(${metricColumn} AS REAL) > CAST(? AS REAL) THEN 1 END) as above_threshold
                FROM performance_metrics 
                WHERE created_at > ?
            `, [threshold, since], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    // Consider it sustained if more than 80% of readings are above threshold
                    const sustainedRatio = row.above_threshold / Math.max(row.count, 1);
                    const isSustained = sustainedRatio > 0.8 && row.count > 5;
                    
                    resolve({
                        sustained: isSustained,
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
                
                // Delete old code quality metrics
                this.db.run('DELETE FROM code_quality_metrics WHERE created_at < ?', [cutoffTime], (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error pruning old code quality metrics: ' + err.message));
                        return;
                    }
                });
                
                // Delete old node quality metrics
                this.db.run('DELETE FROM node_quality_metrics WHERE created_at < ?', [cutoffTime], (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(new Error('Error pruning old node quality metrics: ' + err.message));
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

    // Store code quality metrics (with UPSERT to prevent duplicates)
    async storeCodeQualityMetrics(flowId, flowName, totalIssues, nodesWithIssues, nodesWithCriticalIssues, totalFunctionNodes, issueTypes, qualityScore, complexityScore) {
        return this.executeOperation(() => {
            return new Promise((resolve, reject) => {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const issueTypesJson = JSON.stringify(issueTypes || []);
                const roundedQualityScore = Math.round(qualityScore * 100) / 100;
                const roundedComplexityScore = Math.round(complexityScore * 100) / 100;
                
                // Insert new data (allowing historical records)
                const stmt = this.db.prepare(`
                    INSERT INTO code_quality_metrics (
                        flow_id, flow_name, total_issues, nodes_with_issues, nodes_with_critical_issues, 
                        total_function_nodes, issue_types, quality_score, complexity_score
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                stmt.run(flowId, flowName, totalIssues, nodesWithIssues, nodesWithCriticalIssues, 
                        totalFunctionNodes, issueTypesJson, roundedQualityScore, roundedComplexityScore, function(err) {
                    stmt.finalize();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                });
            });
        });
    }

    // Store multiple node quality metrics in a single transaction (BATCH OPERATION)
    async storeNodeQualityMetricsBatch(flowId, nodeMetrics) {
        return this.executeOperation(() => {
            return new Promise((resolve, reject) => {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                if (!nodeMetrics || nodeMetrics.length === 0) {
                    resolve([]);
                    return;
                }
                
                // Use a transaction for batch insert (allowing historical records)
                const db = this.db; // Capture database reference to avoid scope issues
                
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    
                    const stmt = db.prepare(`
                        INSERT INTO node_quality_metrics (
                            flow_id, node_id, node_name, issues_count, issue_details, 
                            complexity_score, lines_of_code, quality_score
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    
                    let completedInserts = 0;
                    const totalInserts = nodeMetrics.length;
                    let hasError = false;
                    
                    nodeMetrics.forEach(nodeMetric => {
                        const issueDetailsJson = JSON.stringify(nodeMetric.issueDetails || []);
                        const roundedComplexityScore = Math.round(nodeMetric.complexityScore * 100) / 100;
                        const roundedQualityScore = Math.round(nodeMetric.qualityScore * 100) / 100;
                        
                        stmt.run(flowId, nodeMetric.nodeId, nodeMetric.nodeName, nodeMetric.issuesCount, 
                                issueDetailsJson, roundedComplexityScore, nodeMetric.linesOfCode, 
                                roundedQualityScore, function(err) {
                            completedInserts++;
                            
                            if (err && !hasError) {
                                hasError = true;
                                stmt.finalize();
                                db.run("ROLLBACK");
                                reject(err);
                                return;
                            }
                            
                            if (completedInserts === totalInserts && !hasError) {
                                stmt.finalize();
                                db.run("COMMIT", (commitErr) => {
                                    if (commitErr) {
                                        reject(commitErr);
                                    } else {
                                        resolve(nodeMetrics.length);
                                    }
                                });
                            }
                        });
                    });
                });
            });
        });
    }

    // Store node-level quality metrics
    async storeNodeQualityMetrics(flowId, nodeId, nodeName, issuesCount, issueDetails, complexityScore, linesOfCode, qualityScore) {
        return this.executeOperation(() => {
            return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const stmt = this.db.prepare(`
                INSERT INTO node_quality_metrics (
                    flow_id, node_id, node_name, issues_count, issue_details, 
                    complexity_score, lines_of_code, quality_score
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            const issueDetailsJson = JSON.stringify(issueDetails || []);
            const roundedComplexityScore = Math.round(complexityScore * 100) / 100;
            const roundedQualityScore = Math.round(qualityScore * 100) / 100;
            
                stmt.run(flowId, nodeId, nodeName, issuesCount, issueDetailsJson, 
                        roundedComplexityScore, linesOfCode, roundedQualityScore, function(err) {
                    stmt.finalize();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                });
            });
        });
    }


    // Get code quality trends over time (grouped by rounded hours)
    async getCodeQualityTrends(hours = 24, limit = 100) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const since = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
            
            this.db.all(`
                SELECT 
                    flow_id,
                    flow_name,
                    total_issues,
                    nodes_with_issues,
                    total_function_nodes,
                    quality_score,
                    complexity_score,
                    created_at,
                    strftime('%Y-%m-%dT%H:00:00.000Z', datetime(strftime('%Y-%m-%d %H:00:00', created_at), '+1 hour')) as rounded_hour
                FROM code_quality_metrics 
                WHERE created_at > ?
                ORDER BY created_at DESC
                LIMIT ?
            `, [since, limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    // Group by rounded hour only, averaging across all flows
                    const hourlyData = {};
                    
                    rows.forEach(row => {
                        const hour = row.rounded_hour;
                        // Skip invalid dates
                        if (!hour || hour === 'null' || !hour.includes('T')) {
                            console.warn('Skipping invalid rounded_hour:', hour);
                            return;
                        }
                        
                        if (!hourlyData[hour]) {
                            hourlyData[hour] = {
                                flows: [],
                                created_at: hour
                            };
                        }
                        hourlyData[hour].flows.push(row);
                    });
                    
                    // Calculate averages for each hour
                    const processedRows = Object.keys(hourlyData).map(hour => {
                        const flows = hourlyData[hour].flows;
                        const totalFlows = flows.length;
                        
                        // Validate the hour format before returning
                        const testDate = new Date(hour);
                        if (isNaN(testDate.getTime())) {
                            console.warn('Skipping invalid hour format:', hour);
                            return null;
                        }
                        
                        return {
                            created_at: hour,
                            flow_count: totalFlows,
                            total_issues: Math.round(flows.reduce((sum, f) => sum + f.total_issues, 0) / totalFlows),
                            nodes_with_issues: Math.round(flows.reduce((sum, f) => sum + f.nodes_with_issues, 0) / totalFlows),
                            total_function_nodes: Math.round(flows.reduce((sum, f) => sum + f.total_function_nodes, 0) / totalFlows),
                            quality_score: Math.round((flows.reduce((sum, f) => sum + f.quality_score, 0) / totalFlows) * 100) / 100,
                            complexity_score: Math.round((flows.reduce((sum, f) => sum + f.complexity_score, 0) / totalFlows) * 100) / 100,
                            flow_name: `Average across ${totalFlows} flows`
                        };
                    }).filter(row => row !== null) // Remove invalid entries
                      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    
                    resolve(processedRows);
                }
            });
        });
    }

    // Get current quality summary across all flows
    async getQualitySummary() {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            // Get the most recent quality metrics for each flow (with duplicate prevention)
            this.db.all(`
                SELECT DISTINCT
                    cqm.flow_id,
                    cqm.flow_name,
                    cqm.total_issues,
                    cqm.nodes_with_issues,
                    cqm.nodes_with_critical_issues,
                    cqm.total_function_nodes,
                    cqm.quality_score,
                    cqm.complexity_score,
                    cqm.created_at
                FROM code_quality_metrics cqm
                INNER JOIN (
                    SELECT flow_id, MAX(id) as max_id  -- Use MAX(id) instead of MAX(created_at) for better uniqueness
                    FROM code_quality_metrics
                    GROUP BY flow_id
                ) latest ON cqm.flow_id = latest.flow_id AND cqm.id = latest.max_id
                ORDER BY cqm.quality_score ASC
            `, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const totalIssues = rows.reduce((sum, row) => sum + row.total_issues, 0);
                    const totalNodes = rows.reduce((sum, row) => sum + row.total_function_nodes, 0);
                    const averageQuality = rows.length > 0 ? 
                        rows.reduce((sum, row) => sum + row.quality_score, 0) / rows.length : 100;
                    
                    const processedRows = rows.map(row => ({
                        ...row,
                        quality_score: Math.round(row.quality_score * 100) / 100,
                        complexity_score: Math.round(row.complexity_score * 100) / 100
                    }));
                    
                    resolve({
                        flows: processedRows,
                        summary: {
                            totalFlows: rows.length,
                            totalIssues: totalIssues,
                            totalNodes: totalNodes,
                            averageQuality: Math.round(averageQuality * 100) / 100,
                            worstFlow: rows.length > 0 ? rows[0] : null,
                            bestFlow: rows.length > 0 ? rows[rows.length - 1] : null
                        }
                    });
                }
            });
        });
    }

    // Get most problematic nodes
    async getMostProblematicNodes(limit = 20) {
        return new Promise((resolve, reject) => {
            if (!this.db || !this.initialized) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            this.db.all(`
                SELECT 
                    nqm.flow_id,
                    nqm.node_id,
                    nqm.node_name,
                    nqm.issues_count,
                    nqm.quality_score,
                    nqm.complexity_score,
                    nqm.lines_of_code,
                    nqm.created_at
                FROM node_quality_metrics nqm
                INNER JOIN (
                    SELECT node_id, MAX(created_at) as max_created_at
                    FROM node_quality_metrics
                    WHERE issues_count > 0
                    GROUP BY node_id
                ) latest ON nqm.node_id = latest.node_id AND nqm.created_at = latest.max_created_at
                ORDER BY nqm.issues_count DESC, nqm.quality_score ASC
                LIMIT ?
            `, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const processedRows = rows.map(row => ({
                        ...row,
                        quality_score: Math.round(row.quality_score * 100) / 100,
                        complexity_score: Math.round(row.complexity_score * 100) / 100
                    }));
                    resolve(processedRows);
                }
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