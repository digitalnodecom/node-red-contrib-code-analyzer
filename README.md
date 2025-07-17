# Node-RED Code Analyzer

A Node-RED package that continuously monitors all function nodes across all flows to detect debugging artifacts and forgotten debugging code.

## Features

- **Background monitoring**: Continuously scans all function nodes across all flows
- **Visual indicators**: Shows red status indicators on function nodes with debugging issues
- **Configurable detection**: Choose which types of debugging artifacts to detect
- **Set-and-forget**: Works automatically across all flows without modifying existing nodes

## Detection Capabilities

The analyzer detects:

- **Standalone return statements**: `return;` statements that exit functions early
- **Console.log statements**: Left-over debugging output
- **TODO/FIXME comments**: Development reminders
- **Debugger statements**: JavaScript debugger calls
- **Hardcoded test values**: Common test patterns like `= "test"` or `= 123`

## Installation

### From npm (if published)
```bash
npm install node-red-contrib-code-analyzer
```

### Local installation
1. Copy this package to your Node-RED user directory
2. Navigate to the package directory
3. Install dependencies:
```bash
npm install
```
4. Restart Node-RED

## Usage

1. **Add the analyzer node**: Drag a "Code Analyzer" node from the utility category into any flow
2. **Configure settings**: Double-click to configure scan interval and enabled checks
3. **Deploy**: The analyzer will automatically start scanning all function nodes
4. **Monitor**: Function nodes with debugging issues will show red status indicators

## Configuration Options

- **Scan Interval**: How often to scan all function nodes (default: 30 seconds)
- **Enable Checks**: Select which types of debugging artifacts to detect
- **Auto Start**: Whether to start scanning automatically when deployed

## Status Indicators

### Analyzer Node
- **Green dot**: No debugging traits found
- **Yellow dot**: Found debugging traits (shows count)

### Function Nodes
- **Red dot**: "debugging traits noticed" when issues are detected
- **No status**: Clean function node with no issues

## Manual Scanning

Send any message to the analyzer node to trigger an immediate scan of all function nodes.

## Example Function Node Issues

The analyzer will flag these patterns:

```javascript
// Standalone return (early exit)
if (someCondition) {
    return;  // ← This will be flagged
}

// Console output
console.log("Debug message");  // ← This will be flagged

// TODO comments
// TODO: fix this later  // ← This will be flagged

// Debugger statements
debugger;  // ← This will be flagged

// Test values
let testValue = "test";  // ← This will be flagged
```

## Advanced Usage

### Programmatic Control
```javascript
// Trigger manual scan
msg.payload = { action: "scan" };
return msg;
```

### Integration with CI/CD
The analyzer can be used to prevent deployment of flows with debugging code by monitoring the output messages.

## Troubleshooting

- **No status updates**: Ensure the analyzer node is properly deployed and started
- **Missing detections**: Check that the scan interval is appropriate for your use case
- **Performance issues**: Increase scan interval for large Node-RED installations

## Development

### Project Structure
```
node-red-contrib-code-analyzer/
├── package.json
├── nodes/
│   ├── analyzer.js          # Node runtime logic
│   └── analyzer.html         # Editor UI
├── lib/
│   └── detector.js          # Core detection logic
└── README.md
```

### Adding New Detection Patterns

Edit `lib/detector.js` to add new debugging patterns:

```javascript
// Example: Detect alert statements
if (/alert\s*\(/m.test(code)) {
    issues.push("Alert statement found");
}
```

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.