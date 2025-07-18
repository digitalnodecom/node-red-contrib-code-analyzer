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
                                
                                // Only send message if frequency interval has passed
                                if (now - lastMessageTime >= node.queueMessageFrequency) {
                                    // Get flow information
                                    let flowName = `Flow ${currentFlowId.substring(0, 8)}`;
                                    RED.nodes.eachNode(function(n) {
                                        if (n.type === 'tab' && n.id === currentFlowId) {
                                            flowName = n.label || n.name || flowName;
                                        }
                                    });
                                    
                                    // Try to get Node-RED instance URL
                                    const nodeRedUrl = process.env.NODE_RED_BASE_URL || 
                                                      (RED.settings && RED.settings.httpNodeRoot ? 
                                                       `http://localhost:${RED.settings.uiPort || 1880}${RED.settings.httpNodeRoot}` : 
                                                       `http://localhost:${RED.settings.uiPort || 1880}`);
                                    
                                    const queueName = nodeConfig.name || `Queue ${nodeConfig.id.substring(0, 8)}`;
                                    const message = `🚨 *Queue Alert - Action Required*\n\n` +
                                                   `*Queue:* ${queueName}\n` +
                                                   `*Flow:* ${flowName}\n` +
                                                   `*Items in Queue:* ${queueLength}\n\n` +
                                                   `📝 *Recommended Action:* Please review and optimize the queue processing or increase the rate limit to prevent bottlenecks.\n\n` +
                                                   `🔗 *Node-RED Instance:* ${nodeRedUrl}`;
                                    
                                    sendSlackMessage(message);
                                    node.lastMessageTimes[nodeConfig.id] = now;
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