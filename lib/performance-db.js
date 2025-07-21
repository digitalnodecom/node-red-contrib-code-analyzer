const Database = require('better-sqlite3');
const path = require('path');

class PerformanceDatabase {
    constructor(dbPath = null) {
        this.db = null;
        this.dbPath = dbPath || path.join(__dirname, '..', 'performance_metrics.db');
        this.retentionDays = 7; // Default retention period
        this.initialized = false;
        this.initDatabase();
    }

    // Initialize SQLite database
    initDatabase() {
        try {
            console.log('Initializing database at path:', this.dbPath);
            this.db = new Database(this.dbPath);
            console.log('Database connection established');
            
            // Configure database for better performance
            this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
            this.db.pragma('synchronous = NORMAL'); // Balance between safety and performance
            this.db.pragma('cache_size = 1000'); // Increase cache size
            this.db.pragma('temp_store = MEMORY'); // Store temp data in memory
            console.log('Database pragmas configured');
            
            // Create tables if they don't exist
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS performance_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cpu_usage REAL NOT NULL,
                    memory_usage REAL NOT NULL,
                    memory_rss INTEGER NOT NULL,
                    event_loop_lag REAL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS alert_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    metric_type TEXT NOT NULL,
                    threshold_value REAL NOT NULL,
                    current_value REAL NOT NULL,
                    duration_minutes REAL NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS code_quality_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    flow_id TEXT NOT NULL,
                    flow_name TEXT,
                    total_issues INTEGER NOT NULL DEFAULT 0,
                    nodes_with_issues INTEGER NOT NULL DEFAULT 0,
                    nodes_with_critical_issues INTEGER NOT NULL DEFAULT 0,
                    total_function_nodes INTEGER NOT NULL DEFAULT 0,
                    issue_types TEXT, -- JSON array of issue types found
                    quality_score REAL NOT NULL DEFAULT 100, -- 0-100 score
                    complexity_score REAL NOT NULL DEFAULT 0, -- complexity metric
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS node_quality_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    flow_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    node_name TEXT,
                    node_type TEXT DEFAULT 'function',
                    issues_count INTEGER NOT NULL DEFAULT 0,
                    issue_details TEXT, -- JSON array of specific issues
                    complexity_score REAL NOT NULL DEFAULT 0,
                    lines_of_code INTEGER DEFAULT 0,
                    quality_score REAL NOT NULL DEFAULT 100,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_created_at_metrics ON performance_metrics(created_at);
                CREATE INDEX IF NOT EXISTS idx_created_at_alerts ON alert_history(created_at);
                CREATE INDEX IF NOT EXISTS idx_metric_type ON alert_history(metric_type);
                CREATE INDEX IF NOT EXISTS idx_code_quality_created_at ON code_quality_metrics(created_at);
                CREATE INDEX IF NOT EXISTS idx_code_quality_flow ON code_quality_metrics(flow_id);
                CREATE INDEX IF NOT EXISTS idx_node_quality_created_at ON node_quality_metrics(created_at);
                CREATE INDEX IF NOT EXISTS idx_node_quality_flow_node ON node_quality_metrics(flow_id, node_id);
            `);
            console.log('Database tables and indexes created');
            
            // Add nodes_with_critical_issues column if it doesn't exist (migration)
            try {
                this.db.prepare('ALTER TABLE code_quality_metrics ADD COLUMN nodes_with_critical_issues INTEGER NOT NULL DEFAULT 0').run();
                console.log('Migration: Added nodes_with_critical_issues column');
            } catch (err) {
                // Ignore error if column already exists
                if (!err.message.includes('duplicate column name')) {
                    console.warn('Migration warning:', err.message);
                }
            }
            
            this.initialized = true;
            console.log('Database initialization completed successfully');
        } catch (error) {
            console.error('Failed to initialize performance database:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                dbPath: this.dbPath
            });
            this.initialized = false;
            this.db = null;
        }
    }

    // Store metrics in database
    async storeMetrics(cpuUsage, memoryUsage, memoryRss, eventLoopLag) {
        return new Promise((resolve, reject) => {
            try {
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
                
                const result = stmt.run(roundedCpuUsage, roundedMemoryUsage, memoryRss, roundedEventLoopLag);
                resolve(result.lastInsertRowid);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Record alert in database
    async recordAlert(metricType, threshold, currentValue, durationMinutes) {
        return new Promise((resolve, reject) => {
            try {
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
                
                const result = stmt.run(metricType, roundedThreshold, roundedCurrentValue, roundedDurationMinutes);
                resolve(result.lastInsertRowid);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Calculate averages from database
    async getAverages(windowMinutes = 10) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const since = new Date(Date.now() - (windowMinutes * 60 * 1000)).toISOString();
                
                const stmt = this.db.prepare(`
                    SELECT 
                        AVG(cpu_usage) as cpu,
                        AVG(memory_usage) as memory,
                        AVG(event_loop_lag) as eventLoop
                    FROM performance_metrics 
                    WHERE created_at > ?
                `);
                
                const row = stmt.get(since);
                resolve({
                    cpu: Math.round((row?.cpu || 0) * 100) / 100,
                    memory: Math.round((row?.memory || 0) * 100) / 100,
                    eventLoop: Math.round((row?.eventLoop || 0) * 100) / 100
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Check if metric has been sustained above threshold
    async checkSustainedMetric(metricColumn, threshold, durationMs) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const since = new Date(Date.now() - durationMs).toISOString().replace('T', ' ').replace('Z', '');
                
                const stmt = this.db.prepare(`
                    SELECT COUNT(*) as count,
                           COUNT(CASE WHEN CAST(${metricColumn} AS REAL) > CAST(? AS REAL) THEN 1 END) as above_threshold
                    FROM performance_metrics 
                    WHERE created_at > ?
                `);
                
                const row = stmt.get(threshold, since);
                const sustainedRatio = row.above_threshold / Math.max(row.count, 1);
                const isSustained = sustainedRatio > 0.8 && row.count > 5;
                
                resolve({
                    sustained: isSustained,
                    ratio: Math.round(sustainedRatio * 100) / 100,
                    totalReadings: row.count,
                    exceedingReadings: row.above_threshold
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get recent metrics from database
    async getRecentMetrics(metricType, count = 10) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const column = metricType === 'cpu' ? 'cpu_usage' : 
                    metricType === 'memory' ? 'memory_usage' : 
                        'event_loop_lag';
                
                const stmt = this.db.prepare(`
                    SELECT created_at, ${column} as value
                    FROM performance_metrics 
                    ORDER BY created_at DESC 
                    LIMIT ?
                `);
                
                const rows = stmt.all(count);
                const roundedRows = rows.map(row => ({
                    created_at: row.created_at,
                    value: Math.round(row.value * 100) / 100
                }));
                resolve(roundedRows.reverse()); // Return in chronological order
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get alert history from database
    async getAlertHistory(limitCount = 50) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const stmt = this.db.prepare(`
                    SELECT * FROM alert_history 
                    ORDER BY created_at DESC 
                    LIMIT ?
                `);
                
                const rows = stmt.all(limitCount);
                const roundedRows = rows.map(row => ({
                    ...row,
                    threshold_value: Math.round(row.threshold_value * 100) / 100,
                    current_value: Math.round(row.current_value * 100) / 100,
                    duration_minutes: Math.round(row.duration_minutes * 100) / 100
                }));
                resolve(roundedRows);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get performance trend from database
    async getTrend(metricType, windowMinutes = 60) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const column = metricType === 'cpu' ? 'cpu_usage' : 
                    metricType === 'memory' ? 'memory_usage' : 
                        'event_loop_lag';
                
                const since = new Date(Date.now() - (windowMinutes * 60 * 1000)).toISOString();
                const midPoint = new Date(Date.now() - (windowMinutes * 30 * 1000)).toISOString();
                
                const stmt = this.db.prepare(`
                    SELECT 
                        AVG(CASE WHEN created_at < ? THEN ${column} END) as first_half,
                        AVG(CASE WHEN created_at >= ? THEN ${column} END) as second_half,
                        COUNT(*) as total_count
                    FROM performance_metrics 
                    WHERE created_at > ?
                `);
                
                const row = stmt.get(midPoint, midPoint, since);
                if (row.total_count < 20) {
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
            } catch (error) {
                reject(error);
            }
        });
    }

    // Prune old data based on retention policy
    async pruneOldData(retentionDays = null) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const days = retentionDays || this.retentionDays;
                const cutoffTime = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
                
                const transaction = this.db.transaction(() => {
                    const deleteMetrics = this.db.prepare('DELETE FROM performance_metrics WHERE created_at < ?');
                    const deleteAlerts = this.db.prepare('DELETE FROM alert_history WHERE created_at < ?');
                    const deleteCodeQuality = this.db.prepare('DELETE FROM code_quality_metrics WHERE created_at < ?');
                    const deleteNodeQuality = this.db.prepare('DELETE FROM node_quality_metrics WHERE created_at < ?');
                    
                    deleteMetrics.run(cutoffTime);
                    deleteAlerts.run(cutoffTime);
                    deleteCodeQuality.run(cutoffTime);
                    deleteNodeQuality.run(cutoffTime);
                });
                
                transaction();
                resolve({ message: `Pruned data older than ${days} days`, cutoffTime });
            } catch (error) {
                reject(new Error('Error during prune operation: ' + error.message));
            }
        });
    }

    // Get database statistics
    async getStats() {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const since24h = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
                
                const stmt = this.db.prepare(`
                    SELECT 
                        (SELECT COUNT(*) FROM performance_metrics) as total_metrics,
                        (SELECT COUNT(*) FROM alert_history) as total_alerts,
                        (SELECT MIN(created_at) FROM performance_metrics) as oldest_metric,
                        (SELECT MAX(created_at) FROM performance_metrics) as newest_metric,
                        (SELECT COUNT(*) FROM performance_metrics WHERE created_at > ?) as recent_metrics
                `);
                
                const row = stmt.get(since24h);
                resolve({
                    totalMetrics: row.total_metrics,
                    totalAlerts: row.total_alerts,
                    oldestMetric: row.oldest_metric,
                    newestMetric: row.newest_metric,
                    recentMetrics: row.recent_metrics,
                    dbPath: this.dbPath
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Clear all data
    async clearAll() {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const transaction = this.db.transaction(() => {
                    this.db.prepare('DELETE FROM performance_metrics').run();
                    this.db.prepare('DELETE FROM alert_history').run();
                    this.db.prepare('DELETE FROM code_quality_metrics').run();
                    this.db.prepare('DELETE FROM node_quality_metrics').run();
                });
                
                transaction();
                resolve({ message: 'All data cleared successfully' });
            } catch (error) {
                reject(new Error('Error clearing data: ' + error.message));
            }
        });
    }

    // Store code quality metrics (with historical tracking)
    async storeCodeQualityMetrics(flowId, flowName, totalIssues, nodesWithIssues, nodesWithCriticalIssues, totalFunctionNodes, issueTypes, qualityScore, complexityScore) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const issueTypesJson = JSON.stringify(issueTypes || []);
                const roundedQualityScore = Math.round(qualityScore * 100) / 100;
                const roundedComplexityScore = Math.round(complexityScore * 100) / 100;
                
                const stmt = this.db.prepare(`
                    INSERT INTO code_quality_metrics (
                        flow_id, flow_name, total_issues, nodes_with_issues, nodes_with_critical_issues, 
                        total_function_nodes, issue_types, quality_score, complexity_score
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                const result = stmt.run(flowId, flowName, totalIssues, nodesWithIssues, nodesWithCriticalIssues, 
                        totalFunctionNodes, issueTypesJson, roundedQualityScore, roundedComplexityScore);
                resolve(result.lastInsertRowid);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Store multiple node quality metrics in a single transaction
    async storeNodeQualityMetricsBatch(flowId, nodeMetrics) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                if (!nodeMetrics || nodeMetrics.length === 0) {
                    resolve([]);
                    return;
                }
                
                const stmt = this.db.prepare(`
                    INSERT INTO node_quality_metrics (
                        flow_id, node_id, node_name, issues_count, issue_details, 
                        complexity_score, lines_of_code, quality_score
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                const transaction = this.db.transaction((metrics) => {
                    for (const nodeMetric of metrics) {
                        const issueDetailsJson = JSON.stringify(nodeMetric.issueDetails || []);
                        const roundedComplexityScore = Math.round(nodeMetric.complexityScore * 100) / 100;
                        const roundedQualityScore = Math.round(nodeMetric.qualityScore * 100) / 100;
                        
                        stmt.run(flowId, nodeMetric.nodeId, nodeMetric.nodeName, nodeMetric.issuesCount, 
                                issueDetailsJson, roundedComplexityScore, nodeMetric.linesOfCode, 
                                roundedQualityScore);
                    }
                });
                
                transaction(nodeMetrics);
                resolve(nodeMetrics.length);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Store node-level quality metrics
    async storeNodeQualityMetrics(flowId, nodeId, nodeName, issuesCount, issueDetails, complexityScore, linesOfCode, qualityScore) {
        return new Promise((resolve, reject) => {
            try {
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
                
                const result = stmt.run(flowId, nodeId, nodeName, issuesCount, issueDetailsJson, 
                        roundedComplexityScore, linesOfCode, roundedQualityScore);
                resolve(result.lastInsertRowid);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get code quality trends over time (grouped by rounded hours)
    async getCodeQualityTrends(hours = 24, limit = 100) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const since = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
                
                const stmt = this.db.prepare(`
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
                `);
                
                const rows = stmt.all(since, limit);
                
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
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get current quality summary across all flows
    async getQualitySummary() {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                // Get the most recent quality metrics for each flow
                const stmt = this.db.prepare(`
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
                        SELECT flow_id, MAX(id) as max_id
                        FROM code_quality_metrics
                        GROUP BY flow_id
                    ) latest ON cqm.flow_id = latest.flow_id AND cqm.id = latest.max_id
                    ORDER BY cqm.quality_score ASC
                `);
                
                const rows = stmt.all();
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
            } catch (error) {
                reject(error);
            }
        });
    }

    // Get most problematic nodes
    async getMostProblematicNodes(limit = 20) {
        return new Promise((resolve, reject) => {
            try {
                if (!this.db || !this.initialized) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const stmt = this.db.prepare(`
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
                `);
                
                const rows = stmt.all(limit);
                const processedRows = rows.map(row => ({
                    ...row,
                    quality_score: Math.round(row.quality_score * 100) / 100,
                    complexity_score: Math.round(row.complexity_score * 100) / 100
                }));
                resolve(processedRows);
            } catch (error) {
                reject(error);
            }
        });
    }

    // Set retention policy
    setRetentionDays(days) {
        this.retentionDays = Math.max(1, Math.min(30, days)); // Between 1 and 30 days
    }

    // Close database connection
    close() {
        if (this.db) {
            try {
                this.db.close();
                console.log('Database connection closed');
            } catch (error) {
                console.error('Error closing database:', error);
            }
            this.db = null;
            this.initialized = false;
        }
    }
}

module.exports = PerformanceDatabase;