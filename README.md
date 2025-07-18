# Node-RED Code Analyzer

[![CI/CD Pipeline](https://github.com/your-username/node-red-contrib-code-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/node-red-contrib-code-analyzer/actions/workflows/ci.yml)
[![Coverage Status](https://codecov.io/gh/your-username/node-red-contrib-code-analyzer/branch/main/graph/badge.svg)](https://codecov.io/gh/your-username/node-red-contrib-code-analyzer)

A comprehensive Node-RED package that provides background services to detect debugging artifacts in function nodes and monitor queue performance across Node-RED flows.

## Features

- **🔍 Static Code Analysis**: Detects debugging artifacts in function nodes
- **📊 Queue Monitoring**: Monitors delay node queues and sends alerts
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

### Queue Monitoring

- **Scan Interval**: Fixed at 3 seconds for optimal performance
- **Message Frequency**: Configurable notification throttling
- **Queue Selection**: Monitor all queues or specific selections
- **Threshold Settings**: Customizable queue length alerts

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