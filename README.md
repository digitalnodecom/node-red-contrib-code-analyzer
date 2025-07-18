# Node-RED Code Analyzer

[![CI/CD Pipeline](https://github.com/your-username/node-red-contrib-code-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/node-red-contrib-code-analyzer/actions/workflows/ci.yml)
[![Coverage Status](https://codecov.io/gh/your-username/node-red-contrib-code-analyzer/branch/main/graph/badge.svg)](https://codecov.io/gh/your-username/node-red-contrib-code-analyzer)

A comprehensive Node-RED package that provides background services to detect debugging artifacts in function nodes and monitor queue performance across Node-RED flows.

## Features

- **🔍 Static Code Analysis**: Detects debugging artifacts in function nodes
- **📊 Queue Monitoring**: Monitors delay node queues and sends alerts
- **⚡ Performance Monitoring**: Tracks CPU, memory, and event loop metrics with sustained alerting
- **🔔 Slack Integration**: Sends formatted alerts to Slack channels
- **📈 Real-time Monitoring**: Continuous background scanning
- **🎯 Configurable Detection**: Multiple detection levels and thresholds
- **🖥️ Monaco Editor Integration**: Real-time highlighting and problem markers

## Detection Levels

The analyzer provides 3 levels of detection strictness:

### Level 1: Critical Issues
Detects only the most critical debugging artifacts:
- **Top-level return statements**: `return;` statements at the function's top level (not inside blocks)

### Level 2: Standard Issues
Includes Level 1 plus:
- **node.warn() statements**: Debugging output using Node-RED's warning system
- **TODO/FIXME comments**: Development reminders with colon syntax (`TODO:`, `FIXME:`)

### Level 3: Comprehensive Issues
Includes Level 2 plus:
- **Hardcoded test values**: Common test patterns like `= "test"`, `= "debug"`, `= "temp"`, `= 123`
- **Multiple empty lines**: 2 or more consecutive empty lines

## Ignore Directives

Sometimes you need to intentionally use debugging code or patterns that the analyzer would normally flag. You can use comment-based ignore directives to exclude specific lines or regions from analysis:

### Region Ignoring
```javascript
// @nr-analyzer-ignore-start
return; // This will be ignored
node.warn("This debug statement is intentional");
const test = "test"; // This hardcoded value is ignored
// @nr-analyzer-ignore-end
```

### Single Line Ignoring
```javascript
return; // @nr-analyzer-ignore-line
node.warn("debug"); // This line will be flagged
```

### Next Line Ignoring
```javascript
// @nr-analyzer-ignore-next
return; // This line will be ignored
node.warn("debug"); // This line will be flagged
```

### Supported Directive Formats
- `@nr-analyzer-ignore-*` (recommended)
- `@nr-analizer-ignore-*` (alternative spelling)
- Case insensitive: `@NR-ANALYZER-IGNORE-START` works the same
- Flexible spacing: `// @nr-analyzer-ignore-start` and `//   @nr-analyzer-ignore-start` both work

### What Gets Ignored
All detection levels respect ignore directives:
- **Level 1**: Top-level return statements
- **Level 2**: node.warn() calls and TODO/FIXME comments  
- **Level 3**: Hardcoded values and excessive empty lines

## Performance Monitoring

The performance monitoring feature continuously tracks your Node-RED instance's system metrics and provides intelligent alerting based on sustained threshold violations. Unlike traditional monitoring that alerts on momentary spikes, this system only triggers alerts when metrics remain above thresholds for a configured duration (e.g., CPU above 75% for 5+ minutes), preventing false alarms from temporary load spikes. All metrics are stored in a local SQLite database with automatic data retention management, and alerts include average values over the sustained period rather than instantaneous readings for more accurate performance insights.

### Performance Monitoring Configuration

| Field | Description | Recommended Value |
|-------|-------------|------------------|
| **Performance Monitoring** | Enable/disable system performance tracking | `Enabled` for production systems |
| **Performance Check Interval** | How often to collect metrics (seconds) | `10-30 seconds` |
| **CPU Threshold** | CPU usage percentage that triggers alerts | `70-80%` |
| **Memory Threshold** | Memory usage percentage that triggers alerts | `75-85%` |
| **Event Loop Lag Threshold** | Event loop delay in milliseconds | `10-50ms` |
| **Sustained Alert Duration** | Time metrics must exceed thresholds before alerting | `300 seconds (5 minutes)` |
| **Alert Cooldown** | Wait time between repeated alerts for same issue | `1800 seconds (30 minutes)` |
| **Database Retention** | Days to keep performance metrics in database | `7 days` |

### How It Works

1. **Continuous Monitoring**: Collects CPU, memory, and event loop metrics at regular intervals
2. **Sustained Analysis**: Only alerts when metrics exceed thresholds for the configured duration
3. **Smart Alerting**: Prevents notification spam with configurable cooldown periods
4. **Data Storage**: Uses SQLite database for historical data and trend analysis
5. **Automatic Cleanup**: Prunes old data based on retention settings

## Installation

```bash
npm install node-red-contrib-code-analyzer
```

## Usage

1. Add the "Code Analyzer" node to your Node-RED flow
2. Configure the detection settings in the node properties
3. Deploy the flow to start monitoring

## Development

### Prerequisites

- Node.js 16.x or higher
- npm 7.x or higher

### Installation

```bash
git clone https://github.com/your-username/node-red-contrib-code-analyzer.git
cd node-red-contrib-code-analyzer
npm install
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run linter
npm run lint
```

### Test Structure

Our test suite follows the **AAA pattern** (Arrange, Act, Assert) and includes:

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test end-to-end functionality
- **Edge Cases**: Handle malformed inputs and error conditions
- **Performance Tests**: Ensure scalability with large codebases

### Test Coverage

We maintain **80%+ test coverage** across all modules:

- `lib/detector.js` - Core detection logic
- `lib/slack-notifier.js` - Notification system
- `nodes/analyzer.js` - Node-RED integration

### Continuous Integration

GitHub Actions automatically runs:

- ✅ **Multi-Node Testing**: Tests on Node.js 16, 18, and 20
- 🔍 **Code Quality**: ESLint and formatting checks
- 🛡️ **Security Audit**: Vulnerability scanning
- 📊 **Coverage Reports**: Automatic coverage reporting
- 🚀 **Build Validation**: Ensures deployability

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for your changes
5. Ensure all tests pass (`npm test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Pull Request Requirements

- ✅ All tests must pass
- 📊 Coverage must remain above 80%
- 🔍 Code must pass linting
- 🛡️ No high-severity security vulnerabilities
- 📝 Include relevant tests for new features

## Configuration

### Detection Levels

- **Level 1**: Critical issues (top-level returns)
- **Level 2**: Important issues (node.warn, TODO comments)
- **Level 3**: Minor issues (hardcoded values, formatting)

### Code Analysis

- **Detection Levels**: Choose between 3 levels of strictness
- **Scan Interval**: Configurable automatic scanning frequency
- **Auto Start**: Automatically begin scanning on deployment
- **Monaco Integration**: Real-time editor highlighting and markers

### Queue Monitoring

- **Scan Interval**: Fixed at 3 seconds for optimal performance
- **Message Frequency**: Configurable notification throttling
- **Queue Selection**: Monitor all queues or specific selections
- **Threshold Settings**: Customizable queue length alerts

### Performance Monitoring

- **Sustained Alerting**: Only alerts on prolonged threshold violations
- **SQLite Storage**: Local database for metrics history and trends
- **Configurable Thresholds**: Set CPU, memory, and event loop limits
- **Automatic Cleanup**: Intelligent data retention management

### Slack Integration

Configure your Slack webhook URL to receive formatted alerts:

```javascript
{
  "slackWebhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
}
```

## License

ISC License - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [Documentation](https://github.com/your-username/node-red-contrib-code-analyzer/wiki)
- 🐛 [Issue Tracker](https://github.com/your-username/node-red-contrib-code-analyzer/issues)
- 💬 [Discussions](https://github.com/your-username/node-red-contrib-code-analyzer/discussions)