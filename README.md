# Node-RED Code Analyzer

A Node-RED package that continuously monitors all function nodes in the current flow to detect debugging artifacts and forgotten debugging code. Features Monaco editor integration with real-time highlighting and problem markers.

## Features

- **Background monitoring**: Continuously scans all function nodes in the current flow
- **Visual indicators**: Shows red status indicators on function nodes with debugging issues
- **Level-based detection**: Choose detection strictness from 3 predefined levels
- **Monaco editor integration**: Highlights problematic lines with markers and visual indicators
- **Set-and-forget**: Works automatically within the current flow without modifying existing nodes

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
2. **Configure settings**: Double-click to configure scan interval and detection level
3. **Deploy**: The analyzer will automatically start scanning all function nodes in the current flow
4. **Monitor**: Function nodes with debugging issues will show red status indicators
5. **Edit function nodes**: When you open a function node with issues, you'll see highlighted lines and problem markers in the Monaco editor

## Configuration Options

- **Scan Interval**: How often to scan all function nodes (default: 30 seconds)
- **Detection Level**: Choose from 3 levels of detection strictness (1, 2, or 3)
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

### Level 1 Examples
```javascript
// Top-level return (critical issue)
return;  // ← This will be flagged

// This is NOT flagged (inside a block)
if (someCondition) {
    return;  // ← This will NOT be flagged
}
```

### Level 2 Examples
```javascript
// Level 1 issues plus:

// node.warn() statements
node.warn("Debug message");  // ← This will be flagged

// TODO/FIXME comments with colon
// TODO: fix this later  // ← This will be flagged
// FIXME: broken logic  // ← This will be flagged
```

### Level 3 Examples
```javascript
// Level 2 issues plus:

// Hardcoded test values
let testValue = "test";  // ← This will be flagged
let debugVar = "debug";  // ← This will be flagged
let tempVar = "temp";    // ← This will be flagged
let number = 123;        // ← This will be flagged
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