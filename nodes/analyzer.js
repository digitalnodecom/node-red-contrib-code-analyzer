const { detectDebuggingTraits } = require('../lib/detector');

module.exports = function(RED) {
    function CodeAnalyzer(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Configuration
        node.scanInterval = config.scanInterval || 30000; // 30 seconds default
        node.detectionLevel = config.detectionLevel || 1; // Level 1 default
        
        let scanTimer;
        
        function scanCurrentFlow() {
            let totalIssues = 0;
            let nodesWithIssues = 0;
            
            // Get the current flow ID from this analyzer node
            const currentFlowId = node.z;
            
            // First, clear all existing statuses in the current flow
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.z === currentFlowId) {
                    const functionNode = RED.nodes.getNode(nodeConfig.id);
                    if (functionNode && functionNode.status) {
                        functionNode.status({});
                    }
                }
            });
            
            // Now scan for issues in the current flow only
            RED.nodes.eachNode(function (nodeConfig) {
                if (nodeConfig.type === 'function' && nodeConfig.func && nodeConfig.z === currentFlowId) {
                    const issues = detectDebuggingTraits(nodeConfig.func, node.detectionLevel);
                    
                    if (issues.length > 0) {
                        totalIssues += issues.length;
                        nodesWithIssues++;
                        
                        // Store detailed issues for Monaco integration
                        nodeConfig._debugIssues = issues;
                        
                        // Try to get the actual node instance
                        const functionNode = RED.nodes.getNode(nodeConfig.id);
                        if (functionNode && functionNode.status) {
                            functionNode.status({
                                fill: "red",
                                shape: "dot",
                                text: `debugging traits noticed`
                            });
                        }
                        
                        const issueMessages = issues.map(issue => issue.message || issue);
                        node.warn(`Function node ${nodeConfig.id} (${nodeConfig.name || 'unnamed'}) has debugging issues: ${issueMessages.join(', ')}`);
                    } else {
                        // Clear stored issues if no problems found
                        delete nodeConfig._debugIssues;
                    }
                }
            });
            
            // Update analyzer node status
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
        
        // Start scanning
        function startScanning() {
            // Initial scan
            scanCurrentFlow();
            
            // Set up periodic scanning
            if (node.scanInterval > 0) {
                scanTimer = setInterval(scanCurrentFlow, node.scanInterval);
            }
        }
        
        // Handle input messages (manual trigger)
        node.on('input', function(msg) {
            scanCurrentFlow();
            msg.payload = { action: 'scan_completed', timestamp: new Date().toISOString() };
            node.send(msg);
        });
        
        // Handle node close
        node.on('close', function() {
            if (scanTimer) {
                clearInterval(scanTimer);
            }
        });
        
        // Start scanning when node is ready
        setTimeout(startScanning, 1000); // Small delay to ensure all nodes are loaded
    }
    
    RED.nodes.registerType("code-analyzer", CodeAnalyzer);
};