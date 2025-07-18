const { detectDebuggingTraits } = require('../lib/detector');

module.exports = function(RED) {
    function CodeAnalyzer(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        node.scanInterval = config.scanInterval || 30000;
        node.detectionLevel = config.detectionLevel || 1;
        
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
                        
                        const issueMessages = issues.map(issue => issue.message || issue);
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
            RED.nodes.eachNode(function (nodeConfig) {
                if (
                    nodeConfig.type === 'delay' &&
                    nodeConfig.pauseType == "rate" &&
                    nodeConfig.id == 'dd2eca35aae89faa'
                ) {
                    const delayNode = RED.nodes.getNode(nodeConfig.id);
                    
                    const queueLength = delayNode?.buffer.length;
                    const droppedCount = delayNode.droppedMsgs;
                    const isDropping = delayNode.drop;

                    node.warn(queueLength)
                }
            });
        }
        
        function startScanning() {
            scanCurrentFlow();
            
            if (node.scanInterval > 0) {
                scanTimer = setInterval(scanCurrentFlow, node.scanInterval);
            }
            
            // Start queue monitoring every 3 seconds
            queueMonitorTimer = setInterval(monitorQueues, 3000);
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