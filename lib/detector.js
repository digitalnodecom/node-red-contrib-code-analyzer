function detectDebuggingTraits(code, level = 1) {
    const issues = [];
    const lines = code.split('\n');
    
    // Level 1: Critical top-level return statements
    if (level >= 1) {
        // Detect true top-level return statements (not inside blocks)
        let braceDepth = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Track brace depth to determine if we're at top level
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            
            // Check for top-level return before updating brace depth
            if (braceDepth === 0 && /^\s*return\s*;?\s*$/.test(trimmed)) {
                issues.push({
                    type: "top-level-return",
                    message: "Remove this top-level return statement",
                    line: i + 1,
                    column: line.indexOf('return') + 1,
                    endColumn: line.indexOf('return') + 'return'.length + 1,
                    severity: "warning"
                });
            }
            
            braceDepth += openBraces - closeBraces;
        }
    }
    
    // Level 2: Level 1 + node.warn() + TODO/FIXME comments
    if (level >= 2) {
        // Detect node.warn() statements
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const warnMatch = line.match(/node\.warn\s*\(/);
            if (warnMatch) {
                issues.push({
                    type: "node-warn",
                    message: "Remove this node.warn() debugging statement",
                    line: i + 1,
                    column: warnMatch.index + 1,
                    endColumn: warnMatch.index + warnMatch[0].length + 1,
                    severity: "info"
                });
            }
        }
        
        // Detect TODO/FIXME comments
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const todoMatch = line.match(/(TODO|FIXME):/i);
            if (todoMatch) {
                issues.push({
                    type: "todo-comment",
                    message: `${todoMatch[1].toUpperCase()} comment found - consider resolving`,
                    line: i + 1,
                    column: todoMatch.index + 1,
                    endColumn: line.length + 1,
                    severity: "info"
                });
            }
        }
    }
    
    // Level 3: Level 2 + hardcoded variables
    if (level >= 3) {
        // Detect hardcoded test values
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const testMatch = line.match(/=\s*["']test["']/);
            const debugMatch = line.match(/=\s*["']debug["']/);
            const tempMatch = line.match(/=\s*["']temp["']/);
            const numberMatch = line.match(/=\s*123[^0-9]/);
            
            if (testMatch) {
                issues.push({
                    type: "hardcoded-test",
                    message: "Remove hardcoded test value",
                    line: i + 1,
                    column: testMatch.index + 1,
                    endColumn: testMatch.index + testMatch[0].length + 1,
                    severity: "warning"
                });
            }
            
            if (debugMatch) {
                issues.push({
                    type: "hardcoded-debug",
                    message: "Remove hardcoded debug value",
                    line: i + 1,
                    column: debugMatch.index + 1,
                    endColumn: debugMatch.index + debugMatch[0].length + 1,
                    severity: "warning"
                });
            }
            
            if (tempMatch) {
                issues.push({
                    type: "hardcoded-temp",
                    message: "Remove hardcoded temp value",
                    line: i + 1,
                    column: tempMatch.index + 1,
                    endColumn: tempMatch.index + tempMatch[0].length + 1,
                    severity: "warning"
                });
            }
            
            if (numberMatch) {
                issues.push({
                    type: "hardcoded-number",
                    message: "Remove hardcoded test number",
                    line: i + 1,
                    column: numberMatch.index + 1,
                    endColumn: numberMatch.index + numberMatch[0].length + 1,
                    severity: "warning"
                });
            }
        }
    }
    
    return issues;
}

module.exports = {
    detectDebuggingTraits
};