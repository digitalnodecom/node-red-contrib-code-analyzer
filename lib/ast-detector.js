const { parseScript } = require('meriyah');

// Parse ignore directives from code lines (reused from regex implementation)
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

// Adjust line numbers in AST after wrapping code
function adjustLineNumbers(node, offset) {
    if (!node || typeof node !== 'object') return;
    
    if (node.loc && node.loc.start) {
        node.loc.start.line += offset;
        node.loc.end.line += offset;
    }
    
    for (let key in node) {
        if (node.hasOwnProperty(key)) {
            let child = node[key];
            if (Array.isArray(child)) {
                child.forEach(item => adjustLineNumbers(item, offset));
            } else if (child && typeof child === 'object') {
                adjustLineNumbers(child, offset);
            }
        }
    }
}

// AST-based debugging traits detector
function detectDebuggingTraitsAST(code, level = 1, options = {}) {
    const issues = [];
    
    // Handle null, undefined, or empty input
    if (!code || typeof code !== 'string') {
        return issues;
    }
    
    const lines = code.split('\n');
    
    // Parse ignore directives
    const { ignoreRegions, ignoreLines, ignoreNextLines } = parseIgnoreDirectives(lines);
    
    let ast;
    try {
        // Try parsing as a script first (allows top-level returns in Node-RED context)
        try {
            ast = parseScript(code, {
                loc: true,
                ranges: true,
                module: false,
                webcompat: true
            });
        } catch (scriptError) {
            // If script parsing fails due to top-level return, wrap in function
            if (scriptError.message.includes('Illegal return statement')) {
                const wrappedCode = `function nodeRedWrapper() {\n${code}\n}`;
                ast = parseScript(wrappedCode, {
                    loc: true,
                    ranges: true,
                    module: false,
                    webcompat: true
                });
                // Adjust line numbers for wrapped code
                adjustLineNumbers(ast, -1);
            } else {
                throw scriptError;
            }
        }
    } catch (error) {
        // If AST parsing fails, fall back to regex-based detection
        console.warn('AST parsing failed, falling back to regex detection:', error.message);
        return detectDebuggingTraitsRegex(code, level);
    }
    
    // Traverse the AST to find issues
    function traverse(node, parent = null, depth = 0) {
        if (!node || typeof node !== 'object' || !node.type) return;
        
        const nodeLineNumber = node.loc ? node.loc.start.line : null;
        
        // Skip if this line should be ignored
        if (nodeLineNumber && shouldIgnoreLine(nodeLineNumber, ignoreRegions, ignoreLines, ignoreNextLines)) {
            return;
        }
        
        // Level 1: Detect top-level return statements (ONLY empty returns)
        if (level >= 1 && node.type === 'ReturnStatement') {
            // IMPORTANT: Only flag empty returns (debugging artifacts), not returns with values
            const isEmptyReturn = !node.argument || node.argument === null;
            
            if (isEmptyReturn) {
                // Check if this return is TRULY at the top level (not inside any control structures)
                let currentNode = node;
                let isInNestedFunction = false;
                let isInControlStructure = false;
                let isAtTopLevel = false;
                
                while (currentNode && currentNode.parent) {
                    const parentNode = currentNode.parent;
                    
                    // If we find a function declaration/expression that's not our wrapper, we're nested
                    if ((parentNode.type === 'FunctionDeclaration' || 
                         parentNode.type === 'FunctionExpression' || 
                         parentNode.type === 'ArrowFunctionExpression') &&
                        !(parentNode.type === 'FunctionDeclaration' && 
                          parentNode.id && parentNode.id.name === 'nodeRedWrapper')) {
                        isInNestedFunction = true;
                        break;
                    }
                    
                    // Check if we're inside any control structure
                    if (parentNode.type === 'IfStatement' || 
                        parentNode.type === 'ForStatement' || 
                        parentNode.type === 'WhileStatement' || 
                        parentNode.type === 'DoWhileStatement' || 
                        parentNode.type === 'ForInStatement' || 
                        parentNode.type === 'ForOfStatement' || 
                        parentNode.type === 'SwitchStatement' || 
                        parentNode.type === 'TryStatement' || 
                        parentNode.type === 'CatchClause' || 
                        parentNode.type === 'WithStatement') {
                        isInControlStructure = true;
                    }
                    
                    // If we reach the Program or our wrapper function, we're at top level
                    if (parentNode.type === 'Program' || 
                        (parentNode.type === 'FunctionDeclaration' && 
                         parentNode.id && parentNode.id.name === 'nodeRedWrapper')) {
                        isAtTopLevel = true;
                        break;
                    }
                    
                    currentNode = parentNode;
                }
                
                // Debug logging (if enabled)
                if (options && options.debug) {
                    console.log('Return statement found:', {
                        line: nodeLineNumber,
                        parentType: parent ? parent.type : 'no parent',
                        isEmptyReturn,
                        hasArgument: !!node.argument,
                        isInNestedFunction,
                        isInControlStructure,
                        isAtTopLevel,
                        parentParentType: parent && parent.parent ? parent.parent.type : 'no grandparent'
                    });
                }
                
                // Only flag empty returns that are at top level AND not in control structures AND not in nested functions
                if (isAtTopLevel && !isInControlStructure && !isInNestedFunction) {
                    if (nodeLineNumber) {
                        issues.push({
                            type: 'top-level-return',
                            message: 'Remove this top-level return statement',
                            line: nodeLineNumber,
                            column: node.loc.start.column + 1,
                            endColumn: node.loc.end.column + 1,
                            severity: 'warning'
                        });
                    }
                }
            }
        }
        
        // Level 2: Detect console.log, node.warn, and debugger statements
        if (level >= 2) {
            // Detect console.log and console.* calls
            if (node.type === 'CallExpression' && 
                node.callee && node.callee.type === 'MemberExpression' &&
                node.callee.object && node.callee.object.name === 'console') {
                
                if (nodeLineNumber) {
                    issues.push({
                        type: 'console-log',
                        message: `Remove this console.${node.callee.property.name}() debugging statement`,
                        line: nodeLineNumber,
                        column: node.loc.start.column + 1,
                        endColumn: node.loc.end.column + 1,
                        severity: 'info'
                    });
                }
            }
            
            // Detect node.warn calls
            if (node.type === 'CallExpression' && 
                node.callee && node.callee.type === 'MemberExpression' &&
                node.callee.object && node.callee.object.name === 'node' &&
                node.callee.property && node.callee.property.name === 'warn') {
                
                if (nodeLineNumber) {
                    issues.push({
                        type: 'node-warn',
                        message: 'Remove this node.warn() debugging statement',
                        line: nodeLineNumber,
                        column: node.loc.start.column + 1,
                        endColumn: node.loc.end.column + 1,
                        severity: 'info'
                    });
                }
            }
            
            // Detect debugger statements
            if (node.type === 'DebuggerStatement') {
                if (nodeLineNumber) {
                    issues.push({
                        type: 'debugger-statement',
                        message: 'Remove this debugger statement',
                        line: nodeLineNumber,
                        column: node.loc.start.column + 1,
                        endColumn: node.loc.end.column + 1,
                        severity: 'warning'
                    });
                }
            }
        }
        
        // Level 3: Detect hardcoded test values
        if (level >= 3) {
            // Detect hardcoded string assignments
            if (node.type === 'AssignmentExpression' && 
                node.right && node.right.type === 'Literal' && 
                typeof node.right.value === 'string') {
                
                const value = node.right.value.toLowerCase();
                if (value === 'test' || value === 'debug' || value === 'temp') {
                    if (nodeLineNumber) {
                        issues.push({
                            type: `hardcoded-${value}`,
                            message: `Remove hardcoded ${value} value`,
                            line: nodeLineNumber,
                            column: node.right.loc.start.column + 1,
                            endColumn: node.right.loc.end.column + 1,
                            severity: 'warning'
                        });
                    }
                }
            }
            
            // Detect hardcoded variable declarations
            if (node.type === 'VariableDeclarator' && 
                node.init && node.init.type === 'Literal') {
                
                if (typeof node.init.value === 'string') {
                    const value = node.init.value.toLowerCase();
                    if (value === 'test' || value === 'debug' || value === 'temp') {
                        if (nodeLineNumber) {
                            issues.push({
                                type: `hardcoded-${value}`,
                                message: `Remove hardcoded ${value} value`,
                                line: nodeLineNumber,
                                column: node.init.loc.start.column + 1,
                                endColumn: node.init.loc.end.column + 1,
                                severity: 'warning'
                            });
                        }
                    }
                } else if (typeof node.init.value === 'number' && node.init.value === 123) {
                    if (nodeLineNumber) {
                        issues.push({
                            type: 'hardcoded-number',
                            message: 'Remove hardcoded test number',
                            line: nodeLineNumber,
                            column: node.init.loc.start.column + 1,
                            endColumn: node.init.loc.end.column + 1,
                            severity: 'warning'
                        });
                    }
                }
            }
        }
        
        // Recursively traverse child nodes (avoid infinite recursion)
        const visited = new Set();
        for (let key in node) {
            if (node.hasOwnProperty(key) && key !== 'parent' && key !== 'loc' && key !== 'range') {
                let child = node[key];
                if (Array.isArray(child)) {
                    child.forEach(item => {
                        if (item && typeof item === 'object' && item.type && !visited.has(item)) {
                            visited.add(item);
                            item.parent = node; // Set parent reference
                            traverse(item, node, depth + 1);
                        }
                    });
                } else if (child && typeof child === 'object' && child.type && !visited.has(child)) {
                    visited.add(child);
                    child.parent = node; // Set parent reference
                    traverse(child, node, depth + 1);
                }
            }
        }
    }
    
    traverse(ast);
    
    // Level 3: Check for multiple empty lines (still needs line-by-line analysis)
    if (level >= 3) {
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
    
    // Level 2: Check for TODO/FIXME comments (still needs line-by-line analysis)
    if (level >= 2) {
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
    
    return issues;
}

// Fallback regex-based detection for when AST parsing fails
function detectDebuggingTraitsRegex(code, level = 1) {
    // Import the original regex-based detector
    const { detectDebuggingTraits } = require('./detector');
    return detectDebuggingTraits(code, level);
}

module.exports = {
    detectDebuggingTraitsAST,
    parseIgnoreDirectives,
    shouldIgnoreLine
};