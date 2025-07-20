// Dashboard JavaScript
class QualityDashboard {
    constructor() {
        this.charts = {};
        this.refreshInterval = null;
        this.currentTimeframe = 24; // hours
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadDashboardData();
        this.startAutoRefresh();
    }

    setupEventListeners() {
        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadDashboardData();
        });

        // Trend timeframe buttons
        document.querySelectorAll('.trend-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const hours = parseInt(e.target.dataset.hours);
                this.updateTimeframe(hours);
            });
        });

        // Performance metric selector
        document.getElementById('performanceMetricSelect').addEventListener('change', (e) => {
            this.updatePerformanceChart(e.target.value);
        });
    }

    async loadDashboardData() {
        try {
            this.showLoading(true);
            
            const [summary, qualityTrends, problematicNodes, alerts] = await Promise.all([
                this.fetchAPI('/code-analyzer/api/dashboard/summary'),
                this.fetchAPI(`/code-analyzer/api/dashboard/quality-trends?hours=${this.currentTimeframe}`),
                this.fetchAPI('/code-analyzer/api/dashboard/problematic-nodes?limit=10'),
                this.fetchAPI('/code-analyzer/api/dashboard/alerts?limit=20')
            ]);

            this.updateOverviewCards(summary);
            this.updateQualityTrendChart(qualityTrends);
            this.updateFlowsList(summary.quality.flows);
            this.updateProblematicNodesList(problematicNodes.nodes);
            this.updateAlertsList(alerts.alerts);
            
            // Load performance chart
            await this.updatePerformanceChart('cpu');
            
            this.updateLastUpdated(summary.timestamp);
            this.showLoading(false);
            
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
            this.showError('Failed to load dashboard data. Please check your connection.');
            this.showLoading(false);
        }
    }

    async fetchAPI(endpoint) {
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }

    updateOverviewCards(data) {
        const { quality } = data;
        const { systemTrends, overallGrade, summary } = quality;

        // Overall Quality
        document.getElementById('overallQuality').textContent = `${systemTrends.overallQuality}%`;
        const gradeElement = document.getElementById('qualityGrade');
        const gradeText = document.getElementById('gradeText');
        gradeElement.style.backgroundColor = overallGrade.color + '20';
        gradeElement.style.color = overallGrade.color;
        gradeText.textContent = `${overallGrade.grade} - ${overallGrade.description}`;

        // Technical Debt
        document.getElementById('technicalDebt').textContent = `${systemTrends.technicalDebt}%`;
        document.getElementById('totalIssues').textContent = `${summary.totalIssues} total issues`;

        // Flows
        document.getElementById('totalFlows').textContent = summary.totalFlows;
        document.getElementById('totalNodes').textContent = `${summary.totalNodes} function nodes`;

        // Complexity
        document.getElementById('avgComplexity').textContent = systemTrends.complexity;
    }

    updateQualityTrendChart(data) {
        const ctx = document.getElementById('qualityTrendChart').getContext('2d');
        
        if (this.charts.qualityTrend) {
            this.charts.qualityTrend.destroy();
        }

        const chartData = data.trends.slice(-50).reverse(); // Last 50 points, chronological order
        
        this.charts.qualityTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.map(point => new Date(point.created_at).toLocaleTimeString()),
                datasets: [{
                    label: 'Quality Score',
                    data: chartData.map(point => point.quality_score),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: {
                            color: '#f3f4f6'
                        }
                    },
                    x: {
                        grid: {
                            color: '#f3f4f6'
                        }
                    }
                },
                elements: {
                    point: {
                        radius: 3,
                        hoverRadius: 6
                    }
                }
            }
        });
    }

    async updatePerformanceChart(metricType) {
        try {
            const data = await this.fetchAPI(`/code-analyzer/api/dashboard/performance-metrics?type=${metricType}&count=50`);
            
            const ctx = document.getElementById('performanceChart').getContext('2d');
            
            if (this.charts.performance) {
                this.charts.performance.destroy();
            }

            const chartData = data.metrics;
            const label = metricType === 'cpu' ? 'CPU Usage (%)' : 'Memory Usage (%)';
            const color = metricType === 'cpu' ? '#10b981' : '#f59e0b';
            
            this.charts.performance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartData.map(point => new Date(point.created_at).toLocaleTimeString()),
                    datasets: [{
                        label: label,
                        data: chartData.map(point => point.value),
                        borderColor: color,
                        backgroundColor: color + '20',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: metricType === 'cpu' ? 100 : 100,
                            grid: {
                                color: '#f3f4f6'
                            }
                        },
                        x: {
                            grid: {
                                color: '#f3f4f6'
                            }
                        }
                    },
                    elements: {
                        point: {
                            radius: 2,
                            hoverRadius: 5
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Failed to update performance chart:', error);
        }
    }

    updateFlowsList(flows) {
        const container = document.getElementById('flowsList');
        
        if (!flows || flows.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-4">No flows analyzed yet</p>';
            return;
        }

        container.innerHTML = flows.slice(0, 10).map((flow, index) => {
            const qualityColor = this.getQualityColor(flow.quality_score);
            const healthPercentage = Math.round((flow.total_function_nodes - flow.nodes_with_issues) / Math.max(1, flow.total_function_nodes) * 100);
            
            return `
                <div class="bg-gray-50 rounded-lg overflow-hidden">
                    <div class="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-100 transition-colors flow-toggle"
                         data-flow-id="${flow.flow_id}">
                        <div class="flex-1">
                            <div class="flex items-center">
                                <h4 class="font-medium text-gray-900">${flow.flow_name || `Flow ${flow.flow_id.substring(0, 8)}`}</h4>
                                <span class="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium" 
                                      style="background-color: ${qualityColor}20; color: ${qualityColor}">
                                    ${flow.quality_score}%
                                </span>
                                <i class="fas fa-chevron-down ml-2 text-gray-400 transition-transform flow-chevron"></i>
                            </div>
                            <div class="mt-1 text-sm text-gray-600">
                                ${flow.total_issues} issues in ${flow.total_function_nodes} nodes (${healthPercentage}% healthy)
                            </div>
                            <div class="mt-2 w-full bg-gray-200 rounded-full h-2">
                                <div class="bg-green-500 h-2 rounded-full" 
                                     style="width: ${healthPercentage}%"></div>
                            </div>
                        </div>
                        <div class="ml-4 text-right">
                            <div class="text-sm font-medium" style="color: ${qualityColor}">
                                ${this.getQualityGrade(flow.quality_score).grade}
                            </div>
                            <div class="text-xs text-gray-500">
                                Complexity: ${flow.complexity_score}
                            </div>
                        </div>
                    </div>
                    <div class="flow-details hidden" data-flow-id="${flow.flow_id}">
                        <div class="px-4 pb-4">
                            <div class="text-center text-gray-500">
                                <div class="loading-spinner mx-auto mb-2" style="width: 20px; height: 20px;"></div>
                                Loading flow details...
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Add event listeners after DOM is updated
        container.querySelectorAll('.flow-toggle').forEach(element => {
            element.addEventListener('click', (e) => {
                const flowId = element.dataset.flowId;
                this.toggleFlowDetails(flowId, element);
            });
        });
    }
    
    async toggleFlowDetails(flowId, element) {
        const detailsContainer = element.parentElement.querySelector('.flow-details');
        const chevron = element.querySelector('.flow-chevron');
        
        if (detailsContainer.classList.contains('hidden')) {
            // Expand details
            detailsContainer.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
            
            // Load flow details if not already loaded
            if (!detailsContainer.dataset.loaded) {
                await this.loadFlowDetails(flowId, detailsContainer);
                detailsContainer.dataset.loaded = 'true';
            }
        } else {
            // Collapse details
            detailsContainer.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
        }
    }
    
    async loadFlowDetails(flowId, container) {
        try {
            const flowDetails = await this.fetchAPI(`/code-analyzer/api/dashboard/flows/${flowId}/details`);
            
            container.innerHTML = `
                <div class="px-4 pb-4 border-t border-gray-200 bg-white">
                    <div class="py-3">
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            <div class="text-center">
                                <div class="text-2xl font-bold text-red-600">${flowDetails.criticalIssues}</div>
                                <div class="text-xs text-gray-500">Critical</div>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-orange-600">${flowDetails.warningIssues}</div>
                                <div class="text-xs text-gray-500">Warnings</div>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-blue-600">${flowDetails.infoIssues}</div>
                                <div class="text-xs text-gray-500">Info</div>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-600">${flowDetails.healthPercentage}%</div>
                                <div class="text-xs text-gray-500">Healthy</div>
                            </div>
                        </div>
                        
                        ${flowDetails.recommendations.length > 0 ? `
                        <div class="mb-4 p-3 bg-blue-50 rounded-lg">
                            <h5 class="text-sm font-medium text-blue-900 mb-2">Recommendations:</h5>
                            <div class="space-y-1">
                                ${flowDetails.recommendations.map(rec => `
                                    <div class="flex items-start">
                                        <i class="fas ${rec.type === 'critical' ? 'fa-exclamation-circle text-red-600' : 
                                                    rec.type === 'warning' ? 'fa-exclamation-triangle text-orange-600' : 
                                                    'fa-info-circle text-blue-600'} text-sm mt-0.5 mr-2"></i>
                                        <div class="text-sm text-gray-700">
                                            <span class="font-medium">${rec.message}</span> - ${rec.action}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        ` : ''}
                        
                        <div class="space-y-3">
                            <h5 class="text-sm font-semibold text-gray-900">Function Nodes (${flowDetails.nodes.length}):</h5>
                            ${this.renderFlowNodes(flowDetails.nodes)}
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            container.innerHTML = `
                <div class="px-4 pb-4 border-t border-gray-200 bg-red-50">
                    <div class="text-red-600 text-sm py-2">
                        <i class="fas fa-exclamation-circle mr-2"></i>
                        Failed to load flow details: ${error.message}
                    </div>
                </div>
            `;
        }
    }
    
    renderFlowNodes(nodes) {
        if (!nodes || nodes.length === 0) {
            return '<div class="text-gray-500 text-sm">No function nodes found</div>';
        }
        
        return nodes.map(node => {
            const qualityColor = this.getQualityColor(node.qualityScore);
            const hasIssues = node.issuesCount > 0;
            
            return `
                <div class="border border-gray-200 rounded-lg ${hasIssues ? 'bg-red-50' : 'bg-green-50'}">
                    <div class="p-3">
                        <div class="flex items-center justify-between">
                            <div class="flex-1">
                                <div class="flex items-center">
                                    <h6 class="font-medium text-gray-900">${node.nodeName}</h6>
                                    <span class="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium" 
                                          style="background-color: ${qualityColor}20; color: ${qualityColor}">
                                        ${node.qualityGrade.grade}
                                    </span>
                                    ${node.criticalIssues > 0 ? 
                                        `<i class="fas fa-exclamation-circle text-red-600 ml-2" title="${node.criticalIssues} critical issues"></i>` : 
                                        node.warningIssues > 0 ? 
                                        `<i class="fas fa-exclamation-triangle text-orange-600 ml-2" title="${node.warningIssues} warnings"></i>` :
                                        `<i class="fas fa-check-circle text-green-600 ml-2" title="No issues"></i>`
                                    }
                                </div>
                                <div class="text-xs text-gray-600 mt-1">
                                    ${node.linesOfCode} lines • Complexity: ${node.complexityScore} • Quality: ${node.qualityScore}%
                                </div>
                            </div>
                        </div>
                        
                        ${hasIssues ? `
                        <div class="mt-3 space-y-2">
                            <h6 class="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                Issues (${node.issuesCount}):
                            </h6>
                            ${node.issues.map(issue => `
                                <div class="flex items-start p-2 bg-white rounded border-l-4 ${
                                    issue.severity === 'critical' ? 'border-red-500' :
                                    issue.severity === 'warning' ? 'border-orange-500' : 
                                    'border-blue-500'
                                }">
                                    <div class="flex-shrink-0 mt-0.5">
                                        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white" 
                                              style="background-color: ${issue.color}">
                                            ${issue.priority}
                                        </span>
                                    </div>
                                    <div class="ml-2 flex-1">
                                        <div class="flex items-center">
                                            <span class="text-xs font-semibold uppercase tracking-wide" 
                                                  style="color: ${issue.color}">
                                                ${issue.severity}
                                            </span>
                                            <span class="ml-2 text-xs text-gray-500">
                                                Line ${issue.line}${issue.column ? `, Col ${issue.column}` : ''}
                                            </span>
                                            <span class="ml-2 text-xs text-gray-400">
                                                -${issue.weight} pts
                                            </span>
                                        </div>
                                        <div class="text-sm text-gray-800 mt-1">
                                            ${issue.message}
                                        </div>
                                        <div class="text-xs text-gray-500 mt-1">
                                            Type: ${issue.type.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        ` : `
                        <div class="mt-3 p-2 bg-green-100 rounded-lg text-center">
                            <i class="fas fa-check-circle text-green-600 mr-2"></i>
                            <span class="text-sm text-green-800 font-medium">No issues found - excellent code quality!</span>
                        </div>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    updateProblematicNodesList(nodes) {
        const container = document.getElementById('problematicNodesList');
        
        if (!nodes || nodes.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-4">No problematic nodes found</p>';
            return;
        }

        container.innerHTML = nodes.map(node => {
            const qualityColor = this.getQualityColor(node.quality_score);
            const severityIcon = node.issues_count >= 5 ? 'fa-exclamation-circle' : 
                               node.issues_count >= 3 ? 'fa-exclamation-triangle' : 'fa-info-circle';
            const severityColor = node.issues_count >= 5 ? '#ef4444' : 
                                 node.issues_count >= 3 ? '#f59e0b' : '#3b82f6';
            
            return `
                <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                    <div class="flex-shrink-0">
                        <i class="fas ${severityIcon} text-lg" style="color: ${severityColor}"></i>
                    </div>
                    <div class="ml-4 flex-1">
                        <div class="flex items-center">
                            <h4 class="font-medium text-gray-900">${node.node_name}</h4>
                            <span class="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium" 
                                  style="background-color: ${qualityColor}20; color: ${qualityColor}">
                                ${node.quality_score}%
                            </span>
                        </div>
                        <div class="mt-1 text-sm text-gray-600">
                            ${node.issues_count} issues • ${node.lines_of_code} lines • Complexity: ${node.complexity_score}
                        </div>
                    </div>
                    <div class="ml-4 text-right">
                        <div class="text-sm font-medium" style="color: ${qualityColor}">
                            ${this.getQualityGrade(node.quality_score).grade}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateAlertsList(alerts) {
        const container = document.getElementById('alertsList');
        
        if (!alerts || alerts.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-4">No recent alerts</p>';
            return;
        }

        container.innerHTML = alerts.slice(0, 10).map(alert => {
            const alertTime = new Date(alert.created_at).toLocaleString();
            const alertIcon = this.getAlertIcon(alert.metric_type);
            const alertColor = this.getAlertColor(alert.current_value, alert.threshold_value);
            
            return `
                <div class="flex items-center p-3 border border-gray-200 rounded-lg">
                    <div class="flex-shrink-0">
                        <i class="fas ${alertIcon} text-lg" style="color: ${alertColor}"></i>
                    </div>
                    <div class="ml-3 flex-1">
                        <div class="text-sm font-medium text-gray-900">
                            ${alert.metric_type.toUpperCase()} Alert
                        </div>
                        <div class="text-sm text-gray-600">
                            ${alert.current_value}% (threshold: ${alert.threshold_value}%) for ${alert.duration_minutes.toFixed(1)} minutes
                        </div>
                    </div>
                    <div class="ml-3 text-right">
                        <div class="text-xs text-gray-500">${alertTime}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateTimeframe(hours) {
        this.currentTimeframe = hours;
        
        // Update button states
        document.querySelectorAll('.trend-btn').forEach(btn => {
            btn.classList.remove('bg-blue-100', 'text-blue-800');
            btn.classList.add('bg-gray-100', 'text-gray-600');
        });
        
        document.querySelector(`[data-hours="${hours}"]`).classList.remove('bg-gray-100', 'text-gray-600');
        document.querySelector(`[data-hours="${hours}"]`).classList.add('bg-blue-100', 'text-blue-800');
        
        // Reload quality trends
        this.loadQualityTrends();
    }

    async loadQualityTrends() {
        try {
            const qualityTrends = await this.fetchAPI(`/code-analyzer/api/dashboard/quality-trends?hours=${this.currentTimeframe}`);
            this.updateQualityTrendChart(qualityTrends);
        } catch (error) {
            console.error('Failed to load quality trends:', error);
        }
    }

    updateLastUpdated(timestamp) {
        document.getElementById('lastUpdated').textContent = new Date(timestamp).toLocaleTimeString();
    }

    showLoading(show) {
        document.getElementById('loadingState').classList.toggle('hidden', !show);
        document.getElementById('dashboardContent').classList.toggle('hidden', show);
    }

    showError(message) {
        // You could implement a toast notification here
        console.error(message);
    }

    startAutoRefresh() {
        // Refresh every 5 minutes
        this.refreshInterval = setInterval(() => {
            this.loadDashboardData();
        }, 5 * 60 * 1000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // Utility functions
    getQualityColor(score) {
        if (score >= 90) return '#10b981';
        if (score >= 75) return '#84cc16';
        if (score >= 60) return '#f59e0b';
        return '#ef4444';
    }

    getQualityGrade(score) {
        if (score >= 95) return { grade: 'A+', color: '#22c55e' };
        if (score >= 90) return { grade: 'A', color: '#16a34a' };
        if (score >= 85) return { grade: 'A-', color: '#65a30d' };
        if (score >= 80) return { grade: 'B+', color: '#84cc16' };
        if (score >= 75) return { grade: 'B', color: '#eab308' };
        if (score >= 70) return { grade: 'B-', color: '#f59e0b' };
        if (score >= 65) return { grade: 'C+', color: '#f97316' };
        if (score >= 60) return { grade: 'C', color: '#ea580c' };
        if (score >= 50) return { grade: 'C-', color: '#dc2626' };
        return { grade: 'F', color: '#991b1b' };
    }

    getAlertIcon(metricType) {
        switch (metricType) {
            case 'cpu': return 'fa-microchip';
            case 'memory': return 'fa-memory';
            case 'eventLoop': return 'fa-clock';
            default: return 'fa-exclamation-triangle';
        }
    }

    getAlertColor(currentValue, thresholdValue) {
        const ratio = currentValue / thresholdValue;
        if (ratio >= 1.5) return '#dc2626';
        if (ratio >= 1.2) return '#f59e0b';
        return '#3b82f6';
    }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    new QualityDashboard();
});