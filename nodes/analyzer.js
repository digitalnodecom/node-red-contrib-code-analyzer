const { detectDebuggingTraits } = require('../lib/detector');

module.exports = function(RED) {
    function CodeAnalyzer(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Configuration
        node.scanInterval = config.scanInterval || 30000; // 30 seconds default
        node.enabledChecks = config.enabledChecks || ['return', 'console', 'todo', 'debugger'];
        
        let scanTimer;
        
        function scanAllNodes() {
            let totalIssues = 0;
            
            // Use RED.nodes.eachNode to iterate through all nodes
            RED.nodes.eachNode(function (nodeConfig) {
                node.warn(nodeConfig);
                if (nodeConfig.type === 'function' && nodeConfig.func) {
                    const issues = detectDebuggingTraits(nodeConfig.func);
                    
                    if (issues.length > 0) {
                        totalIssues += issues.length;
                        
                        // Try to get the actual node instance
                        const functionNode = RED.nodes.getNode(nodeConfig.id);
                        if (functionNode && functionNode.status) {
                            functionNode.status({
                                fill: "red",
                                shape: "dot",
                                text: `debugging traits noticed`
                            });
                        }
                        
                        node.warn(`Function node ${nodeConfig.id} (${nodeConfig.name || 'unnamed'}) has debugging issues: ${issues.join(', ')}`);
                    } else {
                        // Clear status if no issues
                        const functionNode = RED.nodes.getNode(nodeConfig.id);
                        if (functionNode && functionNode.status) {
                            functionNode.status({});
                        }
                    }
                }
            });
            
            // Update analyzer node status
            if (totalIssues > 0) {
                node.status({
                    fill: "yellow",
                    shape: "dot",
                    text: `Found ${totalIssues} debugging traits`
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
            scanAllNodes();
            
            // Set up periodic scanning
            if (node.scanInterval > 0) {
                scanTimer = setInterval(scanAllNodes, node.scanInterval);
            }
        }
        
        // Handle input messages (manual trigger)
        node.on('input', function(msg) {
            scanAllNodes();
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