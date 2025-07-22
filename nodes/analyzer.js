const { detectDebuggingTraits } = require('../lib/detector');
const { findFlowVariables, adjustLineNumbers } = require('../lib/ast-detector');
const SlackNotifier = require('../lib/slack-notifier');
const PerformanceMonitor = require('../lib/performance-monitor');
const QualityMetrics = require('../lib/quality-metrics');
const PerformanceDatabase = require('../lib/performance-db');

module.exports = function(RED) {
    // Global storage for flow variable maps
    if (!RED.flowVariableMaps) {
        RED.flowVariableMaps = {};
    }
    
    function CodeAnalyzer(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        node.codeAnalysis = config.codeAnalysis !== undefined ? config.codeAnalysis : true;
        node.scanInterval = (config.scanInterval || 30) * 1000; // Convert seconds to milliseconds
        node.detectionLevel = config.detectionLevel || 1;
        node.queueScanning = config.queueScanning || false;
        node.queueScanInterval = 3000; // Fixed at 3 seconds
        node.queueMessageFrequency = (config.queueMessageFrequency || 1800) * 1000; // Convert seconds to milliseconds
        node.queueScanMode = config.queueScanMode || 'all';
        node.selectedQueueIds = config.selectedQueueIds || [];
        node.queueLengthThreshold = config.queueLengthThreshold || 0;
        node.slackWebhookUrl = config.slackWebhookUrl || '';
        
        // Performance monitoring configuration
        node.performanceMonitoring = config.performanceMonitoring || false;
        node.performanceInterval = Math.max((config.performanceInterval || 10) * 1000, 1000); // Convert seconds to milliseconds, min 1 second
        node.performanceThresholds = {
            cpuThreshold: config.cpuThreshold || 75,
            memoryThreshold: config.memoryThreshold || 80,
            eventLoopThreshold: config.eventLoopThreshold || 20,
            sustainedAlertDuration: Math.max((config.sustainedAlertDuration || 300) * 1000, 60000), // Convert seconds to milliseconds, min 1 minute
            alertCooldown: Math.max((config.alertCooldown || 1800) * 1000, 300000), // Convert seconds to milliseconds, min 5 minutes
            dbRetentionDays: Math.max(Math.min(config.dbRetentionDays || 7, 30), 1) // Between 1-30 days
        };
        
        // Track last message times for each queue
        node.lastMessageTimes = {};
        
        // Track pending alerts for grouped queue messages
        node.pendingQueueAlerts = {};
        node.lastQueueMessageTimes = {}; // Per-queue timing
        
        // Track code analysis issues for grouped messages
        node.lastCodeAnalysisMessageTime = 0;
        
        // Track performance monitoring
        node.lastPerformanceAlertTime = 0;
        
        
        // Initialize Slack notifier
        const slackNotifier = new SlackNotifier(node.slackWebhookUrl, RED);
        
        // Initialize performance monitor
        const performanceMonitor = new PerformanceMonitor();
        performanceMonitor.updateConfig(node.performanceThresholds);
        
        // Initialize quality metrics calculator
        const qualityMetrics = new QualityMetrics();
        
        // Initialize database for quality metrics storage (without auto-creation)
        if (!RED.qualityDatabase) {
            RED.qualityDatabase = new PerformanceDatabase();
            // Only initialize if database already exists
            if (RED.qualityDatabase.databaseExists()) {
                RED.qualityDatabase.initDatabase().catch(err => {
                    node.warn(`Failed to initialize existing database: ${err.message}`);
                    RED.qualityDatabase.initialized = false;
                });
            }
        }
        
        let scanTimer;
        let queueMonitorTimer;
        let performanceMonitorTimer;
        
        
        
        
        async function scanCurrentFlow() {
            if (!node.codeAnalysis) {
                // Code analysis disabled - just update node status
                node.status({
                    fill: 'grey',
                    shape: 'dot',
                    text: 'Code analysis disabled'
                });
                return;
            }
            
            let totalIssues = 0;
            let nodesWithIssues = 0;
            
            const currentFlowId = node.z;
            
            // Collect flow variables across all function nodes in the current flow
            const flowVariableMap = {};
                
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.z === currentFlowId) {
                    const functionNode = RED.nodes.getNode(nodeConfig.id);
                    if (functionNode && functionNode.status) {
                        functionNode.status({});
                    }
                }
            });
            
            // First pass: collect all flow variables
            // Get flow name for better debugging
            let flowName = `Flow ${currentFlowId.substring(0, 8)}`;
            RED.nodes.eachNode(function(n) {
                if (n.type === 'tab' && n.id === currentFlowId) {
                    flowName = n.label || n.name || flowName;
                }
            });
            
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === currentFlowId) {
                    try {
                        const { parseScript } = require('meriyah');
                        let ast;
                        
                        // Parse the code to AST
                        try {
                            ast = parseScript(nodeConfig.func, {
                                loc: true,
                                ranges: true,
                                module: false,
                                webcompat: true
                            });
                        } catch (scriptError) {
                            // If script parsing fails due to top-level return, wrap in function
                            if (scriptError.message.includes('Illegal return statement')) {
                                const wrappedCode = `function nodeRedWrapper() {\n${nodeConfig.func}\n}`;
                                ast = parseScript(wrappedCode, {
                                    loc: true,
                                    ranges: true,
                                    module: false,
                                    webcompat: true
                                });
                                // Adjust line numbers for wrapped code
                                adjustLineNumbers(ast, -1);
                            } else {
                                throw scriptError;
                            }
                        }
                        
                        const flowVars = findFlowVariables(ast);
                        
                        flowVars.forEach(flowVar => {
                            if (!flowVariableMap[flowVar.variableName]) {
                                flowVariableMap[flowVar.variableName] = {
                                    gets: [],
                                    sets: []
                                };
                            }
                            
                            const varInfo = {
                                nodeId: nodeConfig.id,
                                nodeName: nodeConfig.name || `Function Node ${nodeConfig.id.substring(0, 8)}`,
                                line: flowVar.line,
                                column: flowVar.column,
                                endColumn: flowVar.endColumn,
                                fullCallStart: flowVar.fullCallStart,
                                fullCallEnd: flowVar.fullCallEnd
                            };
                            
                            if (flowVar.type === 'flow-get') {
                                flowVariableMap[flowVar.variableName].gets.push(varInfo);
                            } else if (flowVar.type === 'flow-set') {
                                flowVariableMap[flowVar.variableName].sets.push(varInfo);
                            }
                        });
                    } catch (error) {
                        // If flow variable parsing fails, continue with regular analysis
                        // Silently continue
                    }
                }
            });
            
            // Store flow variable map globally for editor access
            RED.flowVariableMaps[currentFlowId] = flowVariableMap;
            
            // Second pass: analyze debugging traits and calculate quality metrics
            const functionNodes = [];
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === currentFlowId) {
                    functionNodes.push(nodeConfig);
                    const issues = detectDebuggingTraits(nodeConfig.func, node.detectionLevel);
                    
                    if (issues.length > 0) {
                        totalIssues += issues.length;
                        nodesWithIssues++;
                        
                        nodeConfig._debugIssues = issues;
                        
                        const functionNode = RED.nodes.getNode(nodeConfig.id);
                        if (functionNode && functionNode.status) {
                            let statusColor = 'blue';
                            let text = 'Minor debug traits noticed';
                            
                            const hasLevel1 = issues.some(issue => issue.type === 'top-level-return');
                            const hasLevel2 = issues.some(issue => 
                                issue.type === 'node-warn' || 
                                issue.type === 'todo-comment' || 
                                issue.type === 'console-log' || 
                                issue.type === 'debugger-statement' || 
                                issue.type === 'unused-variable'
                            );
                            
                            if (hasLevel1) {
                                statusColor = 'red';
                                text = 'Severe debugging traits.';
                            } else if (hasLevel2) {
                                statusColor = 'yellow';
                                text = 'Important debugging traits.';
                            }
                            
                            functionNode.status({
                                fill: statusColor,
                                shape: 'dot',
                                text
                            });
                        }
                    } else {
                        delete nodeConfig._debugIssues;
                    }
                }
            });
            
            // Calculate and store quality metrics
            try {
                const flowQualityMetrics = qualityMetrics.calculateFlowQualityMetrics(functionNodes, node.detectionLevel);
                
                // Store flow-level metrics
                if (RED.qualityDatabase && RED.qualityDatabase.initialized) {
                    RED.qualityDatabase.storeCodeQualityMetrics(
                        currentFlowId,
                        flowName,
                        flowQualityMetrics.totalIssues,
                        flowQualityMetrics.nodesWithIssues,
                        flowQualityMetrics.nodesWithCriticalIssues || 0,
                        flowQualityMetrics.totalFunctionNodes,
                        flowQualityMetrics.issueTypes,
                        flowQualityMetrics.qualityScore,
                        flowQualityMetrics.complexityScore
                    ).catch(err => node.warn(`Failed to store flow quality metrics: ${err.message}`));
                    
                    // Store all node-level metrics in a single batch operation
                    if (flowQualityMetrics.nodeMetrics && flowQualityMetrics.nodeMetrics.length > 0) {
                        RED.qualityDatabase.storeNodeQualityMetricsBatch(
                            currentFlowId, 
                            flowQualityMetrics.nodeMetrics
                        ).catch(err => node.warn(`Failed to store batch node quality metrics: ${err.message}`));
                    }
                }
                
                // Calculate and store system-wide trends (with coordination to avoid duplicates)
                try {
                    await storeSystemTrends();
                } catch (error) {
                    node.warn(`Failed to store system trends: ${error.message}`);
                }
            } catch (error) {
                node.warn(`Failed to calculate quality metrics: ${error.message}`);
            }
            
            if (totalIssues > 0) {
                node.status({
                    fill: 'yellow',
                    shape: 'dot',
                    text: `Found ${totalIssues} debugging traits in ${nodesWithIssues} nodes`
                });
                
                // Send code analysis message if frequency interval has passed
                const now = Date.now();
                if (now - node.lastCodeAnalysisMessageTime >= node.queueMessageFrequency) {
                    slackNotifier.sendCodeAnalysisAlert(currentFlowId, totalIssues, nodesWithIssues, (msg) => node.warn(msg));
                    node.lastCodeAnalysisMessageTime = now;
                }
            } else {
                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: 'No debugging traits found'
                });
            }
        }
        
        // Store system-wide trends with coordination to prevent duplicates
        async function storeSystemTrends() {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return;
            }
            
            // Use a simple coordination mechanism: only the "first" analyzer node stores trends
            const allAnalyzerNodes = [];
            RED.nodes.eachNode((nodeConfig) => {
                if (nodeConfig.type === 'code-analyzer') {
                    allAnalyzerNodes.push(nodeConfig.id);
                }
            });
            
            // Sort node IDs and only let the first one store system trends
            allAnalyzerNodes.sort();
            if (allAnalyzerNodes[0] !== node.id) {
                return; // This node is not the coordinator
            }
            
            // Get all current quality data and calculate system trends
            const qualitySummary = await RED.qualityDatabase.getQualitySummary();
            
            
            const qualityMetrics = new (require('../lib/quality-metrics'))();
            
            const transformedFlows = qualitySummary.flows.map(flow => ({
                totalFunctionNodes: flow.total_function_nodes,
                totalIssues: flow.total_issues,
                nodesWithIssues: flow.nodes_with_issues,
                nodesWithCriticalIssues: flow.nodes_with_critical_issues || 0,
                qualityScore: flow.quality_score,
                complexityScore: flow.complexity_score
            }));

            const systemTrends = qualityMetrics.calculateSystemQualityTrends(transformedFlows);
            
            
        }
        
        function monitorQueues() {
            if (!node.queueScanning) return;
            
            const currentFlowId = node.z;
            
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'delay' && nodeConfig.pauseType == 'rate' && nodeConfig.z === currentFlowId) {
                    // Check if we should monitor this specific queue
                    const shouldMonitor = node.queueScanMode === 'all' || 
                                        (node.queueScanMode === 'specific' && node.selectedQueueIds.includes(nodeConfig.id));
                    
                    if (shouldMonitor) {
                        const delayNode = RED.nodes.getNode(nodeConfig.id);
                        
                        if (delayNode) {
                            const queueLength = delayNode?.buffer.length;

                            if (queueLength > node.queueLengthThreshold) {
                                const now = Date.now();
                                
                                // Add to pending alerts for grouped messaging
                                if (queueLength > node.queueLengthThreshold) {
                                    // Get flow information
                                    let flowName = `Flow ${currentFlowId.substring(0, 8)}`;
                                    RED.nodes.eachNode(function(n) {
                                        if (n.type === 'tab' && n.id === currentFlowId) {
                                            flowName = n.label || n.name || flowName;
                                        }
                                    });
                                    
                                    const queueName = nodeConfig.name || `Queue ${nodeConfig.id.substring(0, 8)}`;
                                    
                                    // Store alert info for grouping
                                    node.pendingQueueAlerts[nodeConfig.id] = {
                                        queueName: queueName,
                                        flowName: flowName,
                                        queueLength: queueLength,
                                        timestamp: now
                                    };
                                }
                                
                                // Check if this specific queue can send a message
                                const lastQueueMessageTime = node.lastQueueMessageTimes[nodeConfig.id] || 0;
                                if (now - lastQueueMessageTime >= node.queueMessageFrequency) {
                                    // Send individual queue alert for this specific queue
                                    const singleQueueAlert = {};
                                    singleQueueAlert[nodeConfig.id] = node.pendingQueueAlerts[nodeConfig.id];
                                    
                                    slackNotifier.sendQueueAlert(singleQueueAlert, (msg) => node.warn(msg));
                                    
                                    // Update timing for this specific queue
                                    node.lastQueueMessageTimes[nodeConfig.id] = now;
                                    
                                    // Remove this queue from pending alerts
                                    delete node.pendingQueueAlerts[nodeConfig.id];
                                }
                            }
                        }
                    }
                }
            });
        }
        
        async function monitorPerformance() {
            if (!node.performanceMonitoring) return;
            
            try {
                const performanceSummary = await performanceMonitor.getPerformanceSummary();
                const now = Date.now();
                
                // Check if we should send performance alerts
                if (performanceSummary.alerts.length > 0) {
                    // Check if enough time has passed since last alert
                    if (now - node.lastPerformanceAlertTime >= node.queueMessageFrequency) {
                        slackNotifier.sendPerformanceAlert(performanceSummary, (msg) => node.warn(msg));
                        node.lastPerformanceAlertTime = now;
                    }
                    
                    // Update node status to show performance issues
                    const alertCount = performanceSummary.alerts.length;
                    const highestSeverity = performanceSummary.alerts.some(a => a.severity === 'warning') ? 'warning' : 'info';
                    
                    node.status({
                        fill: highestSeverity === 'warning' ? 'red' : 'yellow',
                        shape: 'ring',
                        text: `Performance: ${alertCount} sustained alert${alertCount > 1 ? 's' : ''} - CPU: ${performanceSummary.current.cpu.toFixed(1)}%, Mem: ${performanceSummary.current.memory.toFixed(1)}%`
                    });
                } else {
                    // Check if any metrics are currently over threshold (but not sustained)
                    const current = performanceSummary.current;
                    const isOverThreshold = current.cpu > node.performanceThresholds.cpuThreshold || 
                                          current.memory > node.performanceThresholds.memoryThreshold ||
                                          (current.eventLoopLag && current.eventLoopLag > node.performanceThresholds.eventLoopThreshold);
                    
                    if (isOverThreshold) {
                        // Show warning status for current threshold violations
                        node.status({
                            fill: 'yellow',
                            shape: 'ring',
                            text: `Performance: Over threshold - CPU: ${current.cpu.toFixed(1)}%, Mem: ${current.memory.toFixed(1)}%`
                        });
                    } else {
                        // Show OK status when all metrics are within thresholds
                        node.status({
                            fill: 'green',
                            shape: 'ring',
                            text: `Performance: OK - CPU: ${current.cpu.toFixed(1)}%, Mem: ${current.memory.toFixed(1)}%`
                        });
                    }
                }
            } catch (error) {
                node.error('Error monitoring performance: ' + error.message);
            }
        }
        
        function startScanning() {
            scanCurrentFlow().catch(err => node.warn(`Initial scan failed: ${err.message}`));
            
            if (node.codeAnalysis && node.scanInterval > 0) {
                scanTimer = setInterval(() => {
                    scanCurrentFlow().catch(err => node.warn(`Scheduled scan failed: ${err.message}`));
                }, node.scanInterval);
            }
            
            // Start queue monitoring if enabled
            if (node.queueScanning) {
                queueMonitorTimer = setInterval(monitorQueues, node.queueScanInterval);
            }
            
            // Start performance monitoring if enabled
            if (node.performanceMonitoring) {
                performanceMonitor.start();
                performanceMonitorTimer = setInterval(monitorPerformance, node.performanceInterval);
            }
        }
        
        node.on('input', function(msg) {
            if (node.codeAnalysis) {
                scanCurrentFlow().catch(err => node.warn(`Manual scan failed: ${err.message}`));
                msg.payload = { action: 'scan_completed', timestamp: new Date().toISOString() };
            } else {
                msg.payload = { action: 'scan_skipped', reason: 'code_analysis_disabled', timestamp: new Date().toISOString() };
            }
            node.send(msg);
        });
        
        node.on('close', function() {
            if (scanTimer) {
                clearInterval(scanTimer);
                scanTimer = null;
            }
            if (queueMonitorTimer) {
                clearInterval(queueMonitorTimer);
                queueMonitorTimer = null;
            }
            if (performanceMonitorTimer) {
                clearInterval(performanceMonitorTimer);
                performanceMonitorTimer = null;
            }
            if (performanceMonitor) {
                performanceMonitor.stop();
            }
        });
        
        RED.events.on('nodes-started', function() {
            scanCurrentFlow().catch(err => node.warn(`Startup scan failed: ${err.message}`));
        });
        
        setTimeout(startScanning, 1000);
    }
    
    RED.nodes.registerType('code-analyzer', CodeAnalyzer);
    
    // API endpoint to get database path for UI display
    RED.httpAdmin.get('/code-analyzer/db-path', function(_, res) {
        const dbPath = RED.qualityDatabase && RED.qualityDatabase.dbPath 
            ? RED.qualityDatabase.dbPath 
            : require('path').join(process.cwd(), 'performance_metrics.db');
        res.json({ dbPath: dbPath });
    });
    
    // API endpoint to get all flow variable mappings (must be before /:flowId route)
    RED.httpAdmin.get('/code-analyzer/flow-variables/all-flows', function(_, res) {
        const allFlowMaps = RED.flowVariableMaps || {};
        res.json(allFlowMaps);
    });
    
    // API endpoint to get flow variable mapping for a specific flow
    RED.httpAdmin.get('/code-analyzer/flow-variables/:flowId', function(req, res) {
        const flowId = req.params.flowId;
        const flowVariableMap = (RED.flowVariableMaps && RED.flowVariableMaps[flowId]) || {};
        res.json(flowVariableMap);
    });
    
    // API endpoint to get the actual value of a flow variable
    RED.httpAdmin.get('/code-analyzer/flow-variable-value/:flowId/:variableName', function(req, res) {
        try {
            const flowId = req.params.flowId;
            const variableName = decodeURIComponent(req.params.variableName);
            
            let value = undefined;
            let found = false;
            
            // Find any runtime node in the target flow to access its flow context
            RED.nodes.eachNode(function(nodeConfig) {
                if (nodeConfig.z === flowId && !found) {
                    const runtimeNode = RED.nodes.getNode(nodeConfig.id);
                    if (runtimeNode && runtimeNode.context) {
                        try {
                            const flowContext = runtimeNode.context().flow;
                            if (flowContext) {
                                // Use synchronous get - this is the correct approach
                                const contextValue = flowContext.get(variableName);
                                if (contextValue !== undefined) {
                                    value = contextValue;
                                    found = true;
                                }
                            }
                        } catch (contextError) {
                            // Continue to next node
                        }
                    }
                }
            });
            
            // Return the result immediately
            res.json({
                variableName: variableName,
                value: value,
                found: found
            });
            
        } catch (error) {
            res.status(500).json({ 
                error: 'Error retrieving flow variable value',
                details: error.message 
            });
        }
    });
    
    // API endpoint to get the actual value of an environment variable
    RED.httpAdmin.get('/code-analyzer/env-variable-value/:flowId/:variableName', function(req, res) {
        try {
            const flowId = req.params.flowId;
            const variableName = decodeURIComponent(req.params.variableName);
            let value;
            let found = false;
            
            // First, try to get the environment variable from the flow's configuration
            let flowNode = null;
            RED.nodes.eachNode(function(nodeConfig) {
                if (nodeConfig.type === 'tab' && nodeConfig.id === flowId) {
                    flowNode = nodeConfig;
                }
            });
            
            // Check if the flow has environment variables defined
            if (flowNode && flowNode.env) {
                for (const envVar of flowNode.env) {
                    if (envVar.name === variableName) {
                        value = envVar.value;
                        found = true;
                        break;
                    }
                }
            }
            
            // If not found in flow env, try accessing through Node-RED's env context
            if (!found) {
                RED.nodes.eachNode(function(nodeConfig) {
                    if (!found && nodeConfig.z === flowId) {
                        const runtimeNode = RED.nodes.getNode(nodeConfig.id);
                        if (runtimeNode && runtimeNode.context) {
                            try {
                                const envContext = runtimeNode.context().env;
                                if (envContext) {
                                    const envValue = envContext.get(variableName);
                                    if (envValue !== undefined) {
                                        value = envValue;
                                        found = true;
                                    }
                                }
                            } catch (envError) {
                                // Continue to next node
                            }
                        }
                    }
                });
            }
            
            // Fallback to process.env if not found anywhere else
            if (!found) {
                const processValue = process.env[variableName];
                if (processValue !== undefined) {
                    value = processValue;
                    found = true;
                }
            }
            
            res.json({ 
                variableName: variableName, 
                value: value,
                found: found
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Error retrieving environment variable value',
                details: error.message 
            });
        }
    });

    // Legacy endpoint for env variables (without flow context) - keep for backward compatibility
    RED.httpAdmin.get('/code-analyzer/env-variable-value/:variableName', function(req, res) {
        try {
            const variableName = decodeURIComponent(req.params.variableName);
            
            // Just check process.env for legacy calls
            const value = process.env[variableName];
            
            res.json({ 
                variableName: variableName, 
                value: value,
                found: value !== undefined
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Error retrieving environment variable value',
                details: error.message 
            });
        }
    });

    // ===== DASHBOARD API ENDPOINTS =====
    
    // Serve dashboard static files
    const path = require('path');
    const fs = require('fs');
    
    // Diagnostic endpoint to test if routes are working
    RED.httpAdmin.get('/code-analyzer/test', function(_, res) {
        res.json({ 
            message: 'Code analyzer routes are working!',
            timestamp: new Date().toISOString(),
            paths: {
                dashboard: path.join(__dirname, '../static/dashboard.html'),
                dashboardExists: fs.existsSync(path.join(__dirname, '../static/dashboard.html')),
                javascript: path.join(__dirname, '../static/dashboard.js'),
                javascriptExists: fs.existsSync(path.join(__dirname, '../static/dashboard.js'))
            }
        });
    });
    
    RED.httpAdmin.get('/code-analyzer/dashboard', function(_, res) {
        const dashboardPath = path.join(__dirname, '../static/dashboard.html');
        if (fs.existsSync(dashboardPath)) {
            res.sendFile(dashboardPath);
        } else {
            res.status(404).send('Dashboard not found. Please ensure dashboard files are installed.');
        }
    });
    
    // Serve dashboard JavaScript file
    RED.httpAdmin.get('/code-analyzer/dashboard.js', function(_, res) {
        const jsPath = path.join(__dirname, '../static/dashboard.js');
        if (fs.existsSync(jsPath)) {
            res.setHeader('Content-Type', 'application/javascript');
            res.sendFile(jsPath);
        } else {
            res.status(404).send('Dashboard JavaScript not found');
        }
    });
    
    // Serve other static assets
    RED.httpAdmin.get('/code-analyzer/static/:file', function(req, res) {
        const filePath = path.join(__dirname, '../static', req.params.file);
        if (fs.existsSync(filePath)) {
            // Set appropriate content type
            if (req.params.file.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript');
            } else if (req.params.file.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css');
            }
            res.sendFile(filePath);
        } else {
            res.status(404).send('File not found');
        }
    });

    // API: Get dashboard summary data
    RED.httpAdmin.get('/code-analyzer/api/dashboard/summary', async function(_, res) {
        try {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return res.status(503).json({ error: 'Quality database not available' });
            }

            const [qualitySummary, performanceStats] = await Promise.all([
                RED.qualityDatabase.getQualitySummary(),
                RED.qualityDatabase.getStats()
            ]);

            const qualityMetrics = new QualityMetrics();
            
            // Transform database results to match expected format
            const transformedFlows = qualitySummary.flows.map(flow => ({
                totalFunctionNodes: flow.total_function_nodes,
                totalIssues: flow.total_issues,
                nodesWithIssues: flow.nodes_with_issues,
                nodesWithCriticalIssues: flow.nodes_with_critical_issues || 0,
                qualityScore: flow.quality_score,
                complexityScore: flow.complexity_score
            }));

            // Calculate system-wide trends
            const systemTrends = qualityMetrics.calculateSystemQualityTrends(transformedFlows);
            
            // Note: System trends are stored during actual scans, not dashboard requests

            const dashboardData = {
                quality: {
                    ...qualitySummary,
                    systemTrends,
                    overallGrade: qualityMetrics.getQualityGrade(systemTrends.overallQuality)
                },
                performance: performanceStats,
                timestamp: new Date().toISOString()
            };

            res.json(dashboardData);
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to get dashboard summary', 
                details: error.message 
            });
        }
    });

    // API: Get quality trends over time
    RED.httpAdmin.get('/code-analyzer/api/dashboard/quality-trends', async function(req, res) {
        try {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return res.status(503).json({ error: 'Quality database not available' });
            }

            const hours = parseInt(req.query.hours) || 24;
            const limit = parseInt(req.query.limit) || 100;

            const qualityTrends = await RED.qualityDatabase.getCodeQualityTrends(hours, limit);

            res.json({
                trends: qualityTrends,
                timeframe: `${hours} hours`,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to get quality trends', 
                details: error.message 
            });
        }
    });

    // API: Get most problematic nodes
    RED.httpAdmin.get('/code-analyzer/api/dashboard/problematic-nodes', async function(req, res) {
        try {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return res.status(503).json({ error: 'Quality database not available' });
            }

            const limit = parseInt(req.query.limit) || 20;
            const problematicNodes = await RED.qualityDatabase.getMostProblematicNodes(limit);

            const qualityMetrics = new QualityMetrics();
            const enhancedNodes = problematicNodes.map(node => ({
                ...node,
                grade: qualityMetrics.getQualityGrade(node.quality_score),
                recommendations: qualityMetrics.generateRecommendations({
                    totalIssues: node.issues_count,
                    complexityScore: node.complexity_score,
                    issueTypes: [] // We could parse issue_details JSON here if needed
                })
            }));

            res.json({
                nodes: enhancedNodes,
                count: enhancedNodes.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to get problematic nodes', 
                details: error.message 
            });
        }
    });

    // API: Get detailed flow analysis with node-level issues
    RED.httpAdmin.get('/code-analyzer/api/dashboard/flows/:flowId/details', async function(req, res) {
        try {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return res.status(503).json({ error: 'Quality database not available' });
            }

            const flowId = req.params.flowId;
            const qualityMetrics = new QualityMetrics();
            
            // Get current function nodes in this flow
            const functionNodes = [];
            let flowName = `Flow ${flowId.substring(0, 8)}`;
            
            // Find flow name
            RED.nodes.eachNode(function(n) {
                if (n.type === 'tab' && n.id === flowId) {
                    flowName = n.label || n.name || flowName;
                }
            });
            
            // Get all function nodes in this flow with current analysis
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === flowId) {
                    const issues = detectDebuggingTraits(nodeConfig.func, 3); // Use level 3 for comprehensive analysis
                    const linesOfCode = nodeConfig.func.split('\n').length;
                    const complexityScore = qualityMetrics.calculateComplexityScore(nodeConfig.func);
                    const nodeQualityScore = qualityMetrics.calculateNodeQualityScore(issues, linesOfCode);
                    
                    // Add severity and priority to each issue
                    const enhancedIssues = issues.map(issue => {
                        const severity = qualityMetrics.getIssueSeverity(issue.type);
                        return {
                            ...issue,
                            severity: severity.level,
                            priority: severity.priority,
                            color: severity.color,
                            weight: qualityMetrics.weights[issue.type] || 1
                        };
                    });
                    
                    // Sort issues by priority (critical first)
                    enhancedIssues.sort((a, b) => a.priority - b.priority);
                    
                    functionNodes.push({
                        nodeId: nodeConfig.id,
                        nodeName: nodeConfig.name || `Function Node ${nodeConfig.id.substring(0, 8)}`,
                        linesOfCode,
                        complexityScore,
                        qualityScore: nodeQualityScore,
                        qualityGrade: qualityMetrics.getQualityGrade(nodeQualityScore),
                        issues: enhancedIssues,
                        issuesCount: issues.length,
                        criticalIssues: enhancedIssues.filter(i => i.severity === 'critical').length,
                        warningIssues: enhancedIssues.filter(i => i.severity === 'warning').length,
                        infoIssues: enhancedIssues.filter(i => i.severity === 'info').length,
                        recommendations: qualityMetrics.generateRecommendations({
                            totalIssues: issues.length,
                            complexityScore,
                            issueTypes: issues.map(i => i.type)
                        }),
                        // Navigation information for editor opening
                        navigation: {
                            flowId: flowId,
                            nodeId: nodeConfig.id,
                            nodeName: nodeConfig.name || `Function Node ${nodeConfig.id.substring(0, 8)}`,
                            editorUrl: `/red/#flow/${flowId}`,
                            nodeType: nodeConfig.type
                        }
                    });
                }
            });
            
            // Calculate flow-level metrics
            const flowMetrics = qualityMetrics.calculateFlowQualityMetrics(
                functionNodes.map(n => ({ 
                    id: n.nodeId, 
                    name: n.nodeName, 
                    type: 'function', 
                    func: 'placeholder' // We already calculated issues above
                })), 
                3
            );
            
            // Sort nodes by severity (most problematic first)
            functionNodes.sort((a, b) => {
                if (a.criticalIssues !== b.criticalIssues) {
                    return b.criticalIssues - a.criticalIssues;
                }
                if (a.warningIssues !== b.warningIssues) {
                    return b.warningIssues - a.warningIssues;
                }
                return b.issuesCount - a.issuesCount;
            });

            const response = {
                flowId,
                flowName,
                totalNodes: functionNodes.length,
                nodesWithIssues: functionNodes.filter(n => n.issuesCount > 0).length,
                totalIssues: functionNodes.reduce((sum, n) => sum + n.issuesCount, 0),
                criticalIssues: functionNodes.reduce((sum, n) => sum + n.criticalIssues, 0),
                warningIssues: functionNodes.reduce((sum, n) => sum + n.warningIssues, 0),
                infoIssues: functionNodes.reduce((sum, n) => sum + n.infoIssues, 0),
                overallQuality: flowMetrics.qualityScore,
                overallComplexity: flowMetrics.complexityScore,
                overallGrade: qualityMetrics.getQualityGrade(flowMetrics.qualityScore),
                healthPercentage: Math.round((functionNodes.length - functionNodes.filter(n => n.issuesCount > 0).length) / Math.max(1, functionNodes.length) * 100),
                nodes: functionNodes,
                recommendations: qualityMetrics.generateRecommendations({
                    ...flowMetrics,
                    totalIssues: functionNodes.reduce((sum, node) => sum + node.issuesCount, 0),
                    issueTypes: [...new Set(functionNodes.flatMap(node => node.issueTypes || []))]
                }),
                timestamp: new Date().toISOString()
            };

            res.json(response);
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to get detailed flow analysis', 
                details: error.message 
            });
        }
    });

    // API: Get flow quality details (simplified for trends)
    RED.httpAdmin.get('/code-analyzer/api/dashboard/flows/:flowId', async function(req, res) {
        try {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return res.status(503).json({ error: 'Quality database not available' });
            }

            const flowId = req.params.flowId;
            const hours = parseInt(req.query.hours) || 24;
            
            // Get recent quality metrics for this flow
            const qualityTrends = await RED.qualityDatabase.getCodeQualityTrends(hours, 100);
            const flowTrends = qualityTrends.filter(trend => trend.flow_id === flowId);

            if (flowTrends.length === 0) {
                return res.status(404).json({ error: 'Flow not found or no recent data' });
            }

            const latestMetrics = flowTrends[0];
            const qualityMetrics = new QualityMetrics();
            const report = qualityMetrics.generateFlowQualityReport(latestMetrics);

            res.json({
                flow: report,
                trends: flowTrends,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to get flow details', 
                details: error.message 
            });
        }
    });

    // API: Navigate to specific node and line (for editor integration)
    RED.httpAdmin.post('/code-analyzer/api/navigate-to-node', function(req, res) {
        try {
            const { nodeId, flowId, lineNumber, columnNumber } = req.body;
            
            // Verify node exists
            let nodeExists = false;
            RED.nodes.eachNode(function(n) {
                if (n.id === nodeId && n.z === flowId) {
                    nodeExists = true;
                }
            });
            
            if (!nodeExists) {
                return res.status(404).json({ 
                    error: 'Node not found',
                    nodeId,
                    flowId
                });
            }
            
            // Return navigation information
            res.json({
                success: true,
                navigation: {
                    nodeId,
                    flowId,
                    lineNumber: lineNumber || 1,
                    columnNumber: columnNumber || 1,
                    editorUrl: `/red/#flow/${flowId}`,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to prepare navigation', 
                details: error.message 
            });
        }
    });

    // API: Get performance metrics for charts
    RED.httpAdmin.get('/code-analyzer/api/dashboard/performance-metrics', async function(req, res) {
        try {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return res.status(503).json({ error: 'Quality database not available' });
            }

            const metricType = req.query.type || 'cpu';
            const count = parseInt(req.query.count) || 50;

            const [recentMetrics, averages, alertHistory] = await Promise.all([
                RED.qualityDatabase.getRecentMetrics(metricType, count),
                RED.qualityDatabase.getAverages(60), // 1 hour average
                RED.qualityDatabase.getAlertHistory(20)
            ]);

            res.json({
                metrics: recentMetrics,
                averages: averages,
                alerts: alertHistory.filter(alert => alert.metric_type === metricType),
                metricType: metricType,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to get performance metrics', 
                details: error.message 
            });
        }
    });

    // API: Get system alerts
    RED.httpAdmin.get('/code-analyzer/api/dashboard/alerts', async function(req, res) {
        try {
            if (!RED.qualityDatabase || !RED.qualityDatabase.initialized) {
                return res.status(503).json({ error: 'Quality database not available' });
            }

            const limit = parseInt(req.query.limit) || 50;
            const alertHistory = await RED.qualityDatabase.getAlertHistory(limit);

            res.json({
                alerts: alertHistory,
                count: alertHistory.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to get alerts', 
                details: error.message 
            });
        }
    });

    // API: Create database with fallback locations
    RED.httpAdmin.post('/code-analyzer/api/create-database', async function(req, res) {
        try {
            if (!RED.qualityDatabase) {
                RED.qualityDatabase = new PerformanceDatabase();
            }

            // Check if database already exists
            if (RED.qualityDatabase.databaseExists()) {
                return res.json({ 
                    success: true,
                    message: 'Database already exists',
                    dbPath: RED.qualityDatabase.dbPath
                });
            }

            // Create the database with progress tracking
            const result = await RED.qualityDatabase.createDatabase();
            
            res.json({
                success: true,
                message: result.message,
                dbPath: result.dbPath,
                attemptedLocations: result.attemptedLocations,
                creationMessages: result.messages
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: 'Failed to create database in all locations',
                details: error.message,
                creationMessages: RED.qualityDatabase ? RED.qualityDatabase.creationMessages : []
            });
        }
    });

    // API: Create database with streaming progress updates
    RED.httpAdmin.post('/code-analyzer/api/create-database-with-progress', function(req, res) {
        try {
            if (!RED.qualityDatabase) {
                RED.qualityDatabase = new PerformanceDatabase();
            }

            // Check if database already exists
            if (RED.qualityDatabase.databaseExists()) {
                return res.json({ 
                    success: true,
                    message: 'Database already exists',
                    dbPath: RED.qualityDatabase.dbPath
                });
            }

            // Set up Server-Sent Events for progress updates
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            // Progress callback function
            const progressCallback = (progress) => {
                res.write(`data: ${JSON.stringify({
                    type: 'progress',
                    ...progress
                })}\n\n`);
            };

            // Create database with progress updates
            RED.qualityDatabase.createDatabase(progressCallback)
                .then((result) => {
                    res.write(`data: ${JSON.stringify({
                        type: 'complete',
                        success: true,
                        message: result.message,
                        dbPath: result.dbPath,
                        attemptedLocations: result.attemptedLocations,
                        creationMessages: result.messages
                    })}\n\n`);
                    res.end();
                })
                .catch((error) => {
                    res.write(`data: ${JSON.stringify({
                        type: 'error',
                        success: false,
                        error: 'Failed to create database in all locations',
                        details: error.message,
                        creationMessages: RED.qualityDatabase.creationMessages || []
                    })}\n\n`);
                    res.end();
                });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: 'Failed to start database creation',
                details: error.message
            });
        }
    });

    // API: Check database status
    RED.httpAdmin.get('/code-analyzer/api/database-status', function(req, res) {
        try {
            const dbExists = RED.qualityDatabase && RED.qualityDatabase.databaseExists();
            const isInitialized = RED.qualityDatabase && RED.qualityDatabase.initialized;
            
            res.json({
                exists: dbExists,
                initialized: isInitialized,
                dbPath: RED.qualityDatabase ? RED.qualityDatabase.dbPath : null
            });
        } catch (error) {
            res.status(500).json({
                error: 'Failed to check database status',
                details: error.message
            });
        }
    });
};