function detectDebuggingTraits(code, level = 1) {
    const issues = [];
    
    // Handle null, undefined, or empty input
    if (!code || typeof code !== 'string') {
        return issues;
    }
    
    const lines = code.split('\n');
    
    if (level >= 1) {
        let braceDepth = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            
            if (braceDepth === 1 && /^\s*return\s*;?\s*(?:\/\/.*)?$/.test(trimmed)) {
                issues.push({
                    type: 'top-level-return',
                    message: 'Remove this top-level return statement',
                    line: i + 1,
                    column: line.indexOf('return') + 1,
                    endColumn: line.indexOf('return') + 'return'.length + 1,
                    severity: 'warning'
                });
            }
            
            braceDepth += openBraces - closeBraces;
        }
    }
    
    if (level >= 2) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const warnMatch = line.match(/node\.warn\s*\(/);
            if (warnMatch) {
                issues.push({
                    type: 'node-warn',
                    message: 'Remove this node.warn() debugging statement',
                    line: i + 1,
                    column: warnMatch.index + 1,
                    endColumn: warnMatch.index + warnMatch[0].length + 1,
                    severity: 'info'
                });
            }
        }
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const todoMatch = line.match(/(TODO|FIXME):/i);
            if (todoMatch) {
                issues.push({
                    type: 'todo-comment',
                    message: `${todoMatch[1].toUpperCase()} comment found - consider resolving`,
                    line: i + 1,
                    column: todoMatch.index + 1,
                    endColumn: line.length + 1,
                    severity: 'info'
                });
            }
        }
    }
    
    if (level >= 3) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const testMatch = line.match(/=\s*["']test["']/);
            const debugMatch = line.match(/=\s*["']debug["']/);
            const tempMatch = line.match(/=\s*["']temp["']/);
            const numberMatch = line.match(/=\s*123[^0-9]/);
            
            if (testMatch) {
                issues.push({
                    type: 'hardcoded-test',
                    message: 'Remove hardcoded test value',
                    line: i + 1,
                    column: testMatch.index + 1,
                    endColumn: testMatch.index + testMatch[0].length + 1,
                    severity: 'warning'
                });
            }
            
            if (debugMatch) {
                issues.push({
                    type: 'hardcoded-debug',
                    message: 'Remove hardcoded debug value',
                    line: i + 1,
                    column: debugMatch.index + 1,
                    endColumn: debugMatch.index + debugMatch[0].length + 1,
                    severity: 'warning'
                });
            }
            
            if (tempMatch) {
                issues.push({
                    type: 'hardcoded-temp',
                    message: 'Remove hardcoded temp value',
                    line: i + 1,
                    column: tempMatch.index + 1,
                    endColumn: tempMatch.index + tempMatch[0].length + 1,
                    severity: 'warning'
                });
            }
            
            if (numberMatch) {
                issues.push({
                    type: 'hardcoded-number',
                    message: 'Remove hardcoded test number',
                    line: i + 1,
                    column: numberMatch.index + 1,
                    endColumn: numberMatch.index + numberMatch[0].length + 1,
                    severity: 'warning'
                });
            }
        }
        
        let consecutiveEmptyLines = 0;
        let emptyLineStart = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.trim() === '') {
                if (consecutiveEmptyLines === 0) {
                    emptyLineStart = i;
                }
                consecutiveEmptyLines++;
            } else {
                if (consecutiveEmptyLines >= 2) {
                    issues.push({
                        type: 'multiple-empty-lines',
                        message: `Remove excessive empty lines (${consecutiveEmptyLines} consecutive empty lines)`,
                        line: emptyLineStart + 1,
                        endLine: emptyLineStart + consecutiveEmptyLines,
                        column: 1,
                        endColumn: 1,
                        severity: 'info'
                    });
                }
                consecutiveEmptyLines = 0;
            }
        }
        
        if (consecutiveEmptyLines >= 2) {
            issues.push({
                type: 'multiple-empty-lines',
                message: `Remove excessive empty lines (${consecutiveEmptyLines} consecutive empty lines)`,
                line: emptyLineStart + 1,
                endLine: emptyLineStart + consecutiveEmptyLines,
                column: 1,
                endColumn: 1,
                severity: 'info'
            });
        }
    }
    
    return issues;
}

module.exports = {
    detectDebuggingTraits
};