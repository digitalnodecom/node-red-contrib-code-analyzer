const { detectDebuggingTraits } = require('../lib/detector');
const { findFlowVariables, adjustLineNumbers } = require('../lib/ast-detector');
const SlackNotifier = require('../lib/slack-notifier');
const PerformanceMonitor = require('../lib/performance-monitor');

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
        
        let scanTimer;
        let queueMonitorTimer;
        let performanceMonitorTimer;
        
        
        
        
        function scanCurrentFlow() {
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
            
            console.log(`Scanning flow "${flowName}" (${currentFlowId}) for flow variables...`);
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === currentFlowId) {
                    console.log(`Processing function node ${nodeConfig.id} (${nodeConfig.name || 'unnamed'}) in flow ${nodeConfig.z}`);
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
                        
                        // Debug logging
                        if (flowVars.length > 0) {
                            console.log(`Found ${flowVars.length} flow variables in node ${nodeConfig.id}:`, flowVars);
                        }
                        
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
                        console.warn('Flow variable analysis failed for node', nodeConfig.id, error.message);
                    }
                }
            });
            
            // Store flow variable map globally for editor access
            console.log(`Storing flow variable map for flow "${flowName}" (${currentFlowId}):`, flowVariableMap);
            RED.flowVariableMaps[currentFlowId] = flowVariableMap;
            
            // Second pass: analyze debugging traits
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === currentFlowId) {
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
            scanCurrentFlow();
            
            if (node.codeAnalysis && node.scanInterval > 0) {
                scanTimer = setInterval(scanCurrentFlow, node.scanInterval);
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
                scanCurrentFlow();
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
            scanCurrentFlow();
        });
        
        setTimeout(startScanning, 1000);
    }
    
    RED.nodes.registerType('code-analyzer', CodeAnalyzer);
    
    // API endpoint to get database path for UI display
    RED.httpAdmin.get('/code-analyzer/db-path', function(_, res) {
        const path = require('path');
        const dbPath = path.join(process.cwd(), 'performance_metrics.db');
        res.json({ dbPath: dbPath });
    });
    
    // API endpoint to get all flow variable mappings (must be before /:flowId route)
    RED.httpAdmin.get('/code-analyzer/flow-variables/all-flows', function(req, res) {
        console.log('API request for all flows');
        console.log('Available flow variable maps:', Object.keys(RED.flowVariableMaps || {}));
        
        const allFlowMaps = RED.flowVariableMaps || {};
        console.log(`Returning all flow maps:`, Object.keys(allFlowMaps));
        res.json(allFlowMaps);
    });
    
    // API endpoint to get flow variable mapping for a specific flow
    RED.httpAdmin.get('/code-analyzer/flow-variables/:flowId', function(req, res) {
        const flowId = req.params.flowId;
        
        // Get flow name for better debugging
        let flowName = `Flow ${flowId.substring(0, 8)}`;
        RED.nodes.eachNode(function(n) {
            if (n.type === 'tab' && n.id === flowId) {
                flowName = n.label || n.name || flowName;
            }
        });
        
        console.log(`API request for flow "${flowName}" (${flowId})`);
        console.log('Available flow variable maps:', Object.keys(RED.flowVariableMaps || {}));
        
        const flowVariableMap = (RED.flowVariableMaps && RED.flowVariableMaps[flowId]) || {};
        console.log(`Returning for flow "${flowName}":`, flowVariableMap);
        res.json(flowVariableMap);
    });
};