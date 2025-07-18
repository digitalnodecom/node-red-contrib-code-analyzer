const { detectDebuggingTraits } = require('../lib/detector');

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
        
        let scanTimer;
        let queueMonitorTimer;
        
        // Function to send Slack message
        function sendSlackMessage(message) {
            if (!node.slackWebhookUrl) {
                // Fallback to node.warn if no Slack URL configured
                node.warn(message);
                return;
            }
            
            const payload = {
                text: message,
                username: "Node-RED Queue Monitor",
                icon_emoji: ":warning:"
            };
            
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            };
            
            fetch(node.slackWebhookUrl, options)
                .catch(error => {
                    node.error(`Failed to send Slack message: ${error.message}`);
                    // Fallback to node.warn on error
                    node.warn(message);
                });
        }
        
        // Function to send grouped queue message
        function sendGroupedQueueMessage(alerts) {
            // Try to get Node-RED instance URL
            const nodeRedUrl = process.env.NODE_RED_BASE_URL || 
                              (RED.settings && RED.settings.httpNodeRoot ? 
                               `http://localhost:${RED.settings.uiPort || 1880}${RED.settings.httpNodeRoot}` : 
                               `http://localhost:${RED.settings.uiPort || 1880}`);
            
            const alertCount = Object.keys(alerts).length;
            const totalItems = Object.values(alerts).reduce((sum, alert) => sum + alert.queueLength, 0);
            
            // Group alerts by flow
            const flowGroups = {};
            Object.entries(alerts).forEach(([queueId, alert]) => {
                if (!flowGroups[alert.flowName]) {
                    flowGroups[alert.flowName] = [];
                }
                flowGroups[alert.flowName].push(alert);
            });
            
            let message = `🚨 *Queue Alert Summary - ${alertCount} Queue${alertCount > 1 ? 's' : ''} Need Attention*\n\n`;
            message += `📊 *Total Items in Queues:* ${totalItems}\n\n`;
            
            // Add details for each flow
            Object.entries(flowGroups).forEach(([flowName, flowAlerts]) => {
                message += `🔶 *Flow: ${flowName}*\n`;
                flowAlerts.forEach(alert => {
                    message += `   • ${alert.queueName}: ${alert.queueLength} items\n`;
                });
                message += `\n`;
            });
            
            message += `📝 *Recommended Action:* Please review and optimize queue processing or increase rate limits to prevent bottlenecks.\n\n`;
            message += `🔗 *Node-RED Instance:* ${nodeRedUrl}`;
            
            sendSlackMessage(message);
        }
        
        // Function to send code analysis message
        function sendCodeAnalysisMessage(flowId, totalIssues, nodesWithIssues) {
            // Get flow information
            let flowName = `Flow ${flowId.substring(0, 8)}`;
            RED.nodes.eachNode(function(n) {
                if (n.type === 'tab' && n.id === flowId) {
                    flowName = n.label || n.name || flowName;
                }
            });
            
            // Try to get Node-RED instance URL
            const nodeRedUrl = process.env.NODE_RED_BASE_URL || 
                              (RED.settings && RED.settings.httpNodeRoot ? 
                               `http://localhost:${RED.settings.uiPort || 1880}${RED.settings.httpNodeRoot}` : 
                               `http://localhost:${RED.settings.uiPort || 1880}`);
            
            // Collect all problematic nodes with their issues
            const problematicNodes = [];
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === flowId && nodeConfig._debugIssues) {
                    const issues = nodeConfig._debugIssues;
                    const nodeName = nodeConfig.name || `Function ${nodeConfig.id.substring(0, 8)}`;
                    
                    // Group issues by level
                    const level1Issues = issues.filter(issue => issue.type === "top-level-return");
                    const level2Issues = issues.filter(issue => issue.type === "node-warn" || issue.type === "todo-comment");
                    const level3Issues = issues.filter(issue => !level1Issues.includes(issue) && !level2Issues.includes(issue));
                    
                    let nodeIssues = [];
                    if (level1Issues.length > 0) {
                        nodeIssues.push(`🔴 **Critical**: ${level1Issues.length} top-level return statement${level1Issues.length > 1 ? 's' : ''}`);
                    }
                    if (level2Issues.length > 0) {
                        const warnCount = issues.filter(i => i.type === "node-warn").length;
                        const todoCount = issues.filter(i => i.type === "todo-comment").length;
                        if (warnCount > 0) nodeIssues.push(`🟡 **Warning**: ${warnCount} node.warn() statement${warnCount > 1 ? 's' : ''}`);
                        if (todoCount > 0) nodeIssues.push(`🟡 **Todo**: ${todoCount} TODO/FIXME comment${todoCount > 1 ? 's' : ''}`);
                    }
                    if (level3Issues.length > 0) {
                        nodeIssues.push(`🔵 **Info**: ${level3Issues.length} minor issue${level3Issues.length > 1 ? 's' : ''} (hardcoded values, formatting)`);
                    }
                    
                    if (nodeIssues.length > 0) {
                        problematicNodes.push({
                            name: nodeName,
                            issues: nodeIssues,
                            totalIssues: issues.length
                        });
                    }
                }
            });
            
            let message = `🔍 **Code Analysis Alert - ${totalIssues} Issue${totalIssues > 1 ? 's' : ''} Found**\n\n`;
            message += `📊 **Summary**: ${nodesWithIssues} function node${nodesWithIssues > 1 ? 's' : ''} in flow "${flowName}" need${nodesWithIssues === 1 ? 's' : ''} attention\n\n`;
            
            // List each problematic node
            problematicNodes.forEach(node => {
                message += `📝 **${node.name}** (${node.totalIssues} issue${node.totalIssues > 1 ? 's' : ''})\n`;
                node.issues.forEach(issue => {
                    message += `   ${issue}\n`;
                });
                message += `\n`;
            });
            
            message += `💡 **Recommended Action**: Review and clean up debugging code before production deployment\n\n`;
            message += `🔗 **Node-RED Instance**: ${nodeRedUrl}`;
            
            sendSlackMessage(message);
        }
        
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
                    sendCodeAnalysisMessage(currentFlowId, totalIssues, nodesWithIssues);
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
                                        sendGroupedQueueMessage(node.pendingQueueAlerts);
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