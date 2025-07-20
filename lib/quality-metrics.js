const { detectDebuggingTraits } = require('./detector');

class QualityMetrics {
    constructor() {
        // Quality scoring weights
        this.weights = {
            // Critical issues (Level 1)
            'top-level-return': 20,
            
            // Important issues (Level 2)
            'console-log': 8,
            'debugger-statement': 15,
            'node-warn': 10,
            'todo-comment': 5,
            'unused-variable': 3,
            
            // Minor issues (Level 3)
            'hardcoded-test': 4,
            'multiple-empty-lines': 1
        };
        
        // Complexity factors
        this.complexityFactors = {
            linesOfCode: 0.1,
            cyclomaticComplexity: 2.0,
            nestingDepth: 1.5,
            functionCount: 0.5
        };
    }

    // Calculate quality score for a single node
    calculateNodeQualityScore(issues, linesOfCode = 0) {
        let baseScore = 100;
        let totalDeduction = 0;

        // Deduct points based on issues found
        issues.forEach(issue => {
            const weight = this.weights[issue.type] || 1;
            totalDeduction += weight;
        });

        // Apply penalty scaling based on lines of code (more serious for larger functions)
        const sizeMultiplier = Math.min(1 + (linesOfCode / 200), 2); // Cap at 2x penalty
        totalDeduction *= sizeMultiplier;

        const qualityScore = Math.max(0, baseScore - totalDeduction);
        return Math.round(qualityScore * 100) / 100;
    }

    // Calculate complexity score for code
    calculateComplexityScore(code) {
        if (!code || typeof code !== 'string') {
            return 0;
        }

        let complexity = 0;
        const lines = code.split('\n');
        const linesOfCode = lines.filter(line => line.trim() && !line.trim().startsWith('//')).length;

        // Lines of code factor
        complexity += linesOfCode * this.complexityFactors.linesOfCode;

        // Cyclomatic complexity indicators
        const cyclomaticKeywords = [
            /\bif\s*\(/g, /\bwhile\s*\(/g, /\bfor\s*\(/g, 
            /\bcatch\s*\(/g, /\bswitch\s*\(/g, /\bcase\s+/g,
            /&&|\|\|/g, /\?.*:/g  // Logical operators and ternary
        ];

        cyclomaticKeywords.forEach(pattern => {
            const matches = (code.match(pattern) || []).length;
            complexity += matches * this.complexityFactors.cyclomaticComplexity;
        });

        // Nesting depth (approximate by counting braces)
        let maxNesting = 0;
        let currentNesting = 0;
        for (const char of code) {
            if (char === '{') {
                currentNesting++;
                maxNesting = Math.max(maxNesting, currentNesting);
            } else if (char === '}') {
                currentNesting--;
            }
        }
        complexity += maxNesting * this.complexityFactors.nestingDepth;

        // Function count
        const functionCount = (code.match(/function\s+\w+\s*\(/g) || []).length;
        complexity += functionCount * this.complexityFactors.functionCount;

        return Math.round(complexity * 100) / 100;
    }

    // Calculate flow-level quality metrics
    calculateFlowQualityMetrics(nodeConfigs, detectionLevel = 2) {
        let totalIssues = 0;
        let nodesWithIssues = 0;
        let totalFunctionNodes = 0;
        let totalComplexity = 0;
        const issueTypes = new Set();
        const nodeMetrics = [];

        nodeConfigs.forEach(nodeConfig => {
            if (nodeConfig.type === 'function' && nodeConfig.func) {
                totalFunctionNodes++;
                
                const issues = detectDebuggingTraits(nodeConfig.func, detectionLevel);
                const linesOfCode = nodeConfig.func.split('\n').length;
                const complexityScore = this.calculateComplexityScore(nodeConfig.func);
                const qualityScore = this.calculateNodeQualityScore(issues, linesOfCode);

                totalComplexity += complexityScore;
                totalIssues += issues.length;
                
                if (issues.length > 0) {
                    nodesWithIssues++;
                    issues.forEach(issue => issueTypes.add(issue.type));
                }

                nodeMetrics.push({
                    nodeId: nodeConfig.id,
                    nodeName: nodeConfig.name || `Function Node ${nodeConfig.id.substring(0, 8)}`,
                    issuesCount: issues.length,
                    issueDetails: issues,
                    complexityScore: complexityScore,
                    linesOfCode: linesOfCode,
                    qualityScore: qualityScore
                });
            }
        });

        // Calculate overall flow quality score
        const avgComplexityScore = totalFunctionNodes > 0 ? totalComplexity / totalFunctionNodes : 0;
        const issueRatio = totalFunctionNodes > 0 ? totalIssues / totalFunctionNodes : 0;
        
        // Flow quality score combines issue density and complexity
        let flowQualityScore = 100;
        
        // Penalty for issue ratio (0-50 point deduction)
        flowQualityScore -= Math.min(issueRatio * 25, 50);
        
        // Penalty for high complexity (0-30 point deduction)
        const complexityPenalty = Math.min(avgComplexityScore / 2, 30);
        flowQualityScore -= complexityPenalty;
        
        // Bonus for having no issues
        if (totalIssues === 0 && totalFunctionNodes > 0) {
            flowQualityScore = Math.min(100, flowQualityScore + 10);
        }

        return {
            totalIssues,
            nodesWithIssues,
            totalFunctionNodes,
            issueTypes: Array.from(issueTypes),
            qualityScore: Math.max(0, Math.round(flowQualityScore * 100) / 100),
            complexityScore: Math.round(avgComplexityScore * 100) / 100,
            nodeMetrics
        };
    }

    // Calculate overall system quality trends
    calculateSystemQualityTrends(allFlowMetrics) {
        if (!allFlowMetrics || allFlowMetrics.length === 0) {
            return {
                overallQuality: 100,
                technicalDebt: 0,
                complexity: 0,
                flowCount: 0,
                affectedNodes: 0
            };
        }

        const totalFlows = allFlowMetrics.length;
        const totalNodes = allFlowMetrics.reduce((sum, flow) => sum + flow.totalFunctionNodes, 0);
        const totalIssues = allFlowMetrics.reduce((sum, flow) => sum + flow.totalIssues, 0);
        const totalAffectedNodes = allFlowMetrics.reduce((sum, flow) => sum + flow.nodesWithIssues, 0);

        // Overall quality (weighted average of flow qualities)
        const totalWeightedQuality = allFlowMetrics.reduce((sum, flow) => {
            return sum + (flow.qualityScore * flow.totalFunctionNodes);
        }, 0);
        const overallQuality = totalNodes > 0 ? totalWeightedQuality / totalNodes : 100;

        // Technical debt metric (issues per node ratio, scaled 0-100)
        const technicalDebt = totalNodes > 0 ? Math.min((totalIssues / totalNodes) * 20, 100) : 0;

        // Overall complexity (weighted average)
        const totalWeightedComplexity = allFlowMetrics.reduce((sum, flow) => {
            return sum + (flow.complexityScore * flow.totalFunctionNodes);
        }, 0);
        const overallComplexity = totalNodes > 0 ? totalWeightedComplexity / totalNodes : 0;

        return {
            overallQuality: Math.round(overallQuality * 100) / 100,
            technicalDebt: Math.round(technicalDebt * 100) / 100,
            complexity: Math.round(overallComplexity * 100) / 100,
            flowCount: totalFlows,
            affectedNodes: totalAffectedNodes
        };
    }

    // Get quality grade based on score
    getQualityGrade(score) {
        if (score >= 95) return { grade: 'A+', color: '#22c55e', description: 'Excellent' };
        if (score >= 90) return { grade: 'A', color: '#16a34a', description: 'Very Good' };
        if (score >= 85) return { grade: 'A-', color: '#65a30d', description: 'Good' };
        if (score >= 80) return { grade: 'B+', color: '#84cc16', description: 'Above Average' };
        if (score >= 75) return { grade: 'B', color: '#eab308', description: 'Average' };
        if (score >= 70) return { grade: 'B-', color: '#f59e0b', description: 'Below Average' };
        if (score >= 65) return { grade: 'C+', color: '#f97316', description: 'Fair' };
        if (score >= 60) return { grade: 'C', color: '#ea580c', description: 'Poor' };
        if (score >= 50) return { grade: 'C-', color: '#dc2626', description: 'Very Poor' };
        return { grade: 'F', color: '#991b1b', description: 'Critical' };
    }

    // Get issue severity classification
    getIssueSeverity(issueType) {
        if (['top-level-return', 'debugger-statement'].includes(issueType)) {
            return { level: 'critical', color: '#dc2626', priority: 1 };
        }
        if (['console-log', 'node-warn', 'unused-variable', 'todo-comment'].includes(issueType)) {
            return { level: 'warning', color: '#f59e0b', priority: 2 };
        }
        return { level: 'info', color: '#3b82f6', priority: 3 };
    }

    // Generate quality report for a flow
    generateFlowQualityReport(flowMetrics) {
        const grade = this.getQualityGrade(flowMetrics.qualityScore);
        const criticalIssues = flowMetrics.issueTypes.filter(type => 
            this.getIssueSeverity(type).level === 'critical'
        ).length;
        const warningIssues = flowMetrics.issueTypes.filter(type => 
            this.getIssueSeverity(type).level === 'warning'
        ).length;

        return {
            ...flowMetrics,
            grade: grade,
            criticalIssues,
            warningIssues,
            healthPercentage: Math.round((flowMetrics.totalFunctionNodes - flowMetrics.nodesWithIssues) / Math.max(1, flowMetrics.totalFunctionNodes) * 100),
            recommendations: this.generateRecommendations(flowMetrics)
        };
    }

    // Generate improvement recommendations
    generateRecommendations(flowMetrics) {
        const recommendations = [];

        if (flowMetrics.totalIssues === 0) {
            recommendations.push({
                type: 'success',
                message: 'Excellent! No code quality issues detected.',
                action: 'Maintain current coding standards'
            });
            return recommendations;
        }

        // Critical issues
        if (flowMetrics.issueTypes.includes('top-level-return')) {
            recommendations.push({
                type: 'critical',
                message: 'Remove top-level return statements',
                action: 'Refactor functions to use proper control flow'
            });
        }

        if (flowMetrics.issueTypes.includes('debugger-statement')) {
            recommendations.push({
                type: 'critical',
                message: 'Remove debugger statements',
                action: 'Clean up debugging code before deployment'
            });
        }

        // Warning issues
        if (flowMetrics.issueTypes.includes('console-log')) {
            recommendations.push({
                type: 'warning',
                message: 'Replace console.log with proper logging',
                action: 'Use node.log() or remove debugging statements'
            });
        }

        if (flowMetrics.issueTypes.includes('unused-variable')) {
            recommendations.push({
                type: 'info',
                message: 'Remove unused variables',
                action: 'Clean up variable declarations to improve readability'
            });
        }

        if (flowMetrics.complexityScore > 20) {
            recommendations.push({
                type: 'warning',
                message: 'High code complexity detected',
                action: 'Consider breaking down complex functions into smaller ones'
            });
        }

        if (flowMetrics.nodesWithIssues / flowMetrics.totalFunctionNodes > 0.5) {
            recommendations.push({
                type: 'warning',
                message: 'Many nodes have quality issues',
                action: 'Focus on systematic code review and refactoring'
            });
        }

        return recommendations;
    }
}

module.exports = QualityMetrics;