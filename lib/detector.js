function detectDebuggingTraits(code) {
    const issues = [];
    
    // Detect standalone return statements
    if (/^\s*return\s*;/m.test(code)) {
        issues.push("Standalone return statement found");
    }
    
    // Detect early returns with simple conditions (common debugging pattern)
    if (/^\s*if\s*\([^)]*\)\s*{\s*return\s*;?\s*}/m.test(code)) {
        issues.push("Early return with simple condition found");
    }
    
    // Detect console.log statements
    if (/console\.log\s*\(/m.test(code)) {
        issues.push("Console.log statement found");
    }
    
    // Detect TODO/FIXME comments
    if (/(TODO|FIXME|HACK|XXX)/i.test(code)) {
        issues.push("TODO/FIXME comment found");
    }
    
    // Detect hardcoded test values (common patterns)
    if (/=\s*["']test["']/m.test(code) || /=\s*123[^0-9]/m.test(code)) {
        issues.push("Potential hardcoded test value found");
    }
    
    // Detect debugger statements
    if (/debugger\s*;/m.test(code)) {
        issues.push("Debugger statement found");
    }
    
    return issues;
}

module.exports = {
    detectDebuggingTraits
};