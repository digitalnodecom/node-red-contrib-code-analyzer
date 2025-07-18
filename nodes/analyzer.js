const { detectDebuggingTraits } = require('../lib/detector');
const SlackNotifier = require('../lib/slack-notifier');

module.exports = function(RED) {
    function CodeAnalyzer(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        node.scanInterval = config.scanInterval || 30000;
        node.detectionLevel = config.detectionLevel || 1;
        node.queueScanning = config.queueScanning || false;
        node.queueScanInterval = 3000; // Fixed at 3 seconds
        node.queueMessageFrequency = config.queueMessageFrequency || 1800000;
        node.queueScanMode = config.queueScanMode || "all";
        node.selectedQueueIds = config.selectedQueueIds || [];
        node.queueLengthThreshold = config.queueLengthThreshold || 0;
        node.slackWebhookUrl = config.slackWebhookUrl || "";
        
        // Track last message times for each queue
        node.lastMessageTimes = {};
        
        // Track pending alerts for grouped queue messages
        node.pendingQueueAlerts = {};
        node.lastQueueMessageTime = 0;
        
        // Track code analysis issues for grouped messages
        node.lastCodeAnalysisMessageTime = 0;
        
        // Initialize Slack notifier
        const slackNotifier = new SlackNotifier(node.slackWebhookUrl, RED);
        
        let scanTimer;
        let queueMonitorTimer;
        
        
        
        
        function scanCurrentFlow() {
            let totalIssues = 0;
            let nodesWithIssues = 0;
            
            const currentFlowId = node.z;
                
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.z === currentFlowId) {
                    const functionNode = RED.nodes.getNode(nodeConfig.id);
                    if (functionNode && functionNode.status) {
                        functionNode.status({});
                    }
                }
            });
            
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === currentFlowId) {
                    const issues = detectDebuggingTraits(nodeConfig.func, node.detectionLevel);
                    
                    if (issues.length > 0) {
                        totalIssues += issues.length;
                        nodesWithIssues++;
                        
                        nodeConfig._debugIssues = issues;
                        
                        const functionNode = RED.nodes.getNode(nodeConfig.id);
                        if (functionNode && functionNode.status) {
                            let statusColor = "blue";
                            let text = "Minor debug traits noticed";
                            
                            const hasLevel1 = issues.some(issue => issue.type === "top-level-return");
                            const hasLevel2 = issues.some(issue => issue.type === "node-warn" || issue.type === "todo-comment");
                            
                            if (hasLevel1) {
                                statusColor = "red";
                                text = "Severe debugging traits."
                            } else if (hasLevel2) {
                                statusColor = "yellow";
                                text = "Important debugging traits."
                            }
                            
                            functionNode.status({
                                fill: statusColor,
                                shape: "dot",
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
                    fill: "yellow",
                    shape: "dot",
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
                    fill: "green",
                    shape: "dot",
                    text: "No debugging traits found"
                });
            }
        }
        
        function monitorQueues() {
            if (!node.queueScanning) return;
            
            const currentFlowId = node.z;
            
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'delay' && nodeConfig.pauseType == "rate" && nodeConfig.z === currentFlowId) {
                    // Check if we should monitor this specific queue
                    const shouldMonitor = node.queueScanMode === "all" || 
                                        (node.queueScanMode === "specific" && node.selectedQueueIds.includes(nodeConfig.id));
                    
                    if (shouldMonitor) {
                        const delayNode = RED.nodes.getNode(nodeConfig.id);
                        
                        if (delayNode) {
                            const queueLength = delayNode?.buffer.length;
                            const droppedCount = delayNode.droppedMsgs;
                            const isDropping = delayNode.drop;

                            if (queueLength > node.queueLengthThreshold) {
                                const now = Date.now();
                                const lastMessageTime = node.lastMessageTimes[nodeConfig.id] || 0;
                                
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
                                
                                // Send grouped queue message if frequency interval has passed
                                if (now - node.lastQueueMessageTime >= node.queueMessageFrequency) {
                                    if (Object.keys(node.pendingQueueAlerts).length > 0) {
                                        slackNotifier.sendQueueAlert(node.pendingQueueAlerts, (msg) => node.warn(msg));
                                        node.pendingQueueAlerts = {}; // Clear pending alerts
                                        node.lastQueueMessageTime = now;
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }
        
        function startScanning() {
            scanCurrentFlow();
            
            if (node.scanInterval > 0) {
                scanTimer = setInterval(scanCurrentFlow, node.scanInterval);
            }
            
            // Start queue monitoring if enabled
            if (node.queueScanning) {
                queueMonitorTimer = setInterval(monitorQueues, node.queueScanInterval);
            }
        }
        
        node.on('input', function(msg) {
            scanCurrentFlow();
            msg.payload = { action: 'scan_completed', timestamp: new Date().toISOString() };
            node.send(msg);
        });
        
        node.on('close', function() {
            if (scanTimer) {
                clearInterval(scanTimer);
            }
            if (queueMonitorTimer) {
                clearInterval(queueMonitorTimer);
            }
        });
        
        RED.events.on('nodes-started', function() {
            scanCurrentFlow();
        });
        
        setTimeout(startScanning, 1000);
    }
    
    RED.nodes.registerType("code-analyzer", CodeAnalyzer);
};