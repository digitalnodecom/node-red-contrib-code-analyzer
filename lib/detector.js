function detectDebuggingTraits(code, level = 1) {
    const issues = [];
    
    // Level 1: Critical top-level return statements
    if (level >= 1) {
        // Detect standalone return statements
        if (/^\s*return\s*;/m.test(code)) {
            issues.push("Standalone return statement found");
        }
        
        // Detect early returns with simple conditions (common debugging pattern)
        if (/^\s*if\s*\([^)]*\)\s*{\s*return\s*;?\s*}/m.test(code)) {
            issues.push("Early return with simple condition found");
        }
    }
    
    // Level 2: Level 1 + node.warn() + TODO/FIXME comments
    if (level >= 2) {
        // Detect node.warn() statements
        if (/node\.warn\s*\(/m.test(code)) {
            issues.push("node.warn() statement found");
        }
        
        // Detect TODO/FIXME comments
        if (/(TODO|FIXME):/i.test(code)) {
            issues.push("TODO/FIXME comment found");
        }
    }
    
    // Level 3: Level 2 + hardcoded variables
    if (level >= 3) {
        // Detect hardcoded test values (common patterns)
        if (/=\s*["']test["']/m.test(code) || /=\s*123[^0-9]/m.test(code)) {
            issues.push("Potential hardcoded test value found");
        }
        
        // Detect other hardcoded patterns
        if (/=\s*["']debug["']/m.test(code) || /=\s*["']temp["']/m.test(code)) {
            issues.push("Potential hardcoded debug value found");
        }
    }
    
    return issues;
}

module.exports = {
    detectDebuggingTraits
};