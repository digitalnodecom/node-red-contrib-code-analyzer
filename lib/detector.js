// Parse ignore directives from code lines
function parseIgnoreDirectives(lines) {
    const ignoreRegions = [];
    const ignoreLines = new Set();
    const ignoreNextLines = new Set();
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Check for ignore-start directive
        if (trimmed.match(/\/\/\s*@nr-analyzer-ignore-start/i)) {
            // Find the corresponding end directive
            for (let j = i + 1; j < lines.length; j++) {
                const endLine = lines[j].trim();
                if (endLine.match(/\/\/\s*@nr-analyzer-ignore-end/i)) {
                    ignoreRegions.push({ start: i + 1, end: j + 1 }); // 1-based line numbers
                    break;
                }
            }
        }
        
        // Check for single line ignore
        if (trimmed.match(/\/\/\s*@nr-analyzer-ignore-line/i)) {
            ignoreLines.add(i + 1); // 1-based line numbers
        }
        
        // Check for ignore-next directive
        if (trimmed.match(/\/\/\s*@nr-analyzer-ignore-next/i)) {
            if (i + 1 < lines.length) {
                ignoreNextLines.add(i + 2); // 1-based line numbers (next line)
            }
        }
    }
    
    return { ignoreRegions, ignoreLines, ignoreNextLines };
}

// Check if a line should be ignored based on ignore directives
function shouldIgnoreLine(lineNumber, ignoreRegions, ignoreLines, ignoreNextLines) {
    // Check if line is in ignore regions
    for (const region of ignoreRegions) {
        if (lineNumber >= region.start && lineNumber <= region.end) {
            return true;
        }
    }
    
    // Check if line is explicitly ignored
    if (ignoreLines.has(lineNumber)) {
        return true;
    }
    
    // Check if line is marked as ignore-next
    if (ignoreNextLines.has(lineNumber)) {
        return true;
    }
    
    return false;
}

function detectDebuggingTraits(code, level = 1) {
    const issues = [];
    
    // Handle null, undefined, or empty input
    if (!code || typeof code !== 'string') {
        return issues;
    }
    
    const lines = code.split('\n');
    
    // Parse ignore directives
    const { ignoreRegions, ignoreLines, ignoreNextLines } = parseIgnoreDirectives(lines);
    
    if (level >= 1) {
        let braceDepth = 0;
        let controlStructureStack = [];
        let pendingControlStructures = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const lineNumber = i + 1;
            
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            
            // Check if this line contains a control structure keyword
            const controlStructurePattern = /\b(if|else|for|while|do|switch|try|catch|finally)\b/i;
            if (controlStructurePattern.test(trimmed)) {
                pendingControlStructures.push(true);
            }
            
            // When we encounter opening braces, check if we have pending control structures
            if (openBraces > 0) {
                for (let j = 0; j < openBraces; j++) {
                    // Check if this is an arrow function (skip it for control structures)
                    const isArrowFunction = /=>\s*\{/.test(trimmed);
                    
                    // If we have pending control structures and this is not an arrow function
                    if (pendingControlStructures.length > 0 && !isArrowFunction) {
                        controlStructureStack.push(braceDepth + 1 + j);
                        pendingControlStructures.pop();
                    }
                    // Also check if the control structure and brace are on the same line
                    else if (controlStructurePattern.test(trimmed)) {
                        controlStructureStack.push(braceDepth + 1 + j);
                    }
                }
            }
            
            // Remove control structures from stack when we exit their blocks
            if (closeBraces > 0) {
                for (let j = 0; j < closeBraces; j++) {
                    const exitDepth = braceDepth + 1 - j;
                    const stackIndex = controlStructureStack.indexOf(exitDepth);
                    if (stackIndex !== -1) {
                        controlStructureStack.splice(stackIndex, 1);
                    }
                }
            }
            
            if (/^\s*return\s*;?\s*(?:\/\/.*)?$/.test(trimmed)) {
                // Only flag as top-level return if:
                // 1. braceDepth === 0 (raw function body like Node-RED)
                // 2. braceDepth === 1 AND not in any control structure (function wrapper like tests)
                const isInControlStructure = controlStructureStack.length > 0;
                const isTopLevelReturn = braceDepth === 0 || (braceDepth === 1 && !isInControlStructure);
                
                if (isTopLevelReturn) {
                    // Check if this line should be ignored
                    if (!shouldIgnoreLine(lineNumber, ignoreRegions, ignoreLines, ignoreNextLines)) {
                        issues.push({
                            type: 'top-level-return',
                            message: 'Remove this top-level return statement',
                            line: lineNumber,
                            column: line.indexOf('return') + 1,
                            endColumn: line.indexOf('return') + 'return'.length + 1,
                            severity: 'warning'
                        });
                    }
                }
            }
            
            braceDepth += openBraces - closeBraces;
        }
    }
    
    if (level >= 2) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            
            const warnMatch = line.match(/node\.warn\s*\(/);
            if (warnMatch && !shouldIgnoreLine(lineNumber, ignoreRegions, ignoreLines, ignoreNextLines)) {
                issues.push({
                    type: 'node-warn',
                    message: 'Remove this node.warn() debugging statement',
                    line: lineNumber,
                    column: warnMatch.index + 1,
                    endColumn: warnMatch.index + warnMatch[0].length + 1,
                    severity: 'info'
                });
            }
        }
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;
            
            const todoMatch = line.match(/(TODO|FIXME):/i);
            if (todoMatch && !shouldIgnoreLine(lineNumber, ignoreRegions, ignoreLines, ignoreNextLines)) {
                issues.push({
                    type: 'todo-comment',
                    message: `${todoMatch[1].toUpperCase()} comment found - consider resolving`,
                    line: lineNumber,
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
            const lineNumber = i + 1;
            
            // Skip if line should be ignored
            if (shouldIgnoreLine(lineNumber, ignoreRegions, ignoreLines, ignoreNextLines)) {
                continue;
            }
            
            const testMatch = line.match(/=\s*["']test["']/);
            const debugMatch = line.match(/=\s*["']debug["']/);
            const tempMatch = line.match(/=\s*["']temp["']/);
            const numberMatch = line.match(/=\s*123[^0-9]/);
            
            if (testMatch) {
                issues.push({
                    type: 'hardcoded-test',
                    message: 'Remove hardcoded test value',
                    line: lineNumber,
                    column: testMatch.index + 1,
                    endColumn: testMatch.index + testMatch[0].length + 1,
                    severity: 'warning'
                });
            }
            
            if (debugMatch) {
                issues.push({
                    type: 'hardcoded-debug',
                    message: 'Remove hardcoded debug value',
                    line: lineNumber,
                    column: debugMatch.index + 1,
                    endColumn: debugMatch.index + debugMatch[0].length + 1,
                    severity: 'warning'
                });
            }
            
            if (tempMatch) {
                issues.push({
                    type: 'hardcoded-temp',
                    message: 'Remove hardcoded temp value',
                    line: lineNumber,
                    column: tempMatch.index + 1,
                    endColumn: tempMatch.index + tempMatch[0].length + 1,
                    severity: 'warning'
                });
            }
            
            if (numberMatch) {
                issues.push({
                    type: 'hardcoded-number',
                    message: 'Remove hardcoded test number',
                    line: lineNumber,
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
            const lineNumber = i + 1;
            
            if (line.trim() === '') {
                if (consecutiveEmptyLines === 0) {
                    emptyLineStart = i;
                }
                consecutiveEmptyLines++;
            } else {
                if (consecutiveEmptyLines >= 2) {
                    // Check if the empty line region overlaps with any ignore regions
                    const regionStart = emptyLineStart + 1;
                    const regionEnd = emptyLineStart + consecutiveEmptyLines;
                    
                    let shouldIgnoreRegion = false;
                    for (let lineNum = regionStart; lineNum <= regionEnd; lineNum++) {
                        if (shouldIgnoreLine(lineNum, ignoreRegions, ignoreLines, ignoreNextLines)) {
                            shouldIgnoreRegion = true;
                            break;
                        }
                    }
                    
                    if (!shouldIgnoreRegion) {
                        issues.push({
                            type: 'multiple-empty-lines',
                            message: `Remove excessive empty lines (${consecutiveEmptyLines} consecutive empty lines)`,
                            line: regionStart,
                            endLine: regionEnd,
                            column: 1,
                            endColumn: 1,
                            severity: 'info'
                        });
                    }
                }
                consecutiveEmptyLines = 0;
            }
        }
        
        if (consecutiveEmptyLines >= 2) {
            // Check if the empty line region overlaps with any ignore regions
            const regionStart = emptyLineStart + 1;
            const regionEnd = emptyLineStart + consecutiveEmptyLines;
            
            let shouldIgnoreRegion = false;
            for (let lineNum = regionStart; lineNum <= regionEnd; lineNum++) {
                if (shouldIgnoreLine(lineNum, ignoreRegions, ignoreLines, ignoreNextLines)) {
                    shouldIgnoreRegion = true;
                    break;
                }
            }
            
            if (!shouldIgnoreRegion) {
                issues.push({
                    type: 'multiple-empty-lines',
                    message: `Remove excessive empty lines (${consecutiveEmptyLines} consecutive empty lines)`,
                    line: regionStart,
                    endLine: regionEnd,
                    column: 1,
                    endColumn: 1,
                    severity: 'info'
                });
            }
        }
    }
    
    return issues;
}

module.exports = {
    detectDebuggingTraits,
    parseIgnoreDirectives,
    shouldIgnoreLine
};