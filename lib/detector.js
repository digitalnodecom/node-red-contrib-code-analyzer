function detectDebuggingTraits(code, level = 1) {
    const issues = [];
    
    // Level 1: Critical top-level return statements
    if (level >= 1) {
        // Detect true top-level return statements (not inside blocks)
        // Split by lines and check each line individually
        const lines = code.split('\n');
        let braceDepth = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Track brace depth to determine if we're at top level
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            
            // Check for top-level return before updating brace depth
            if (braceDepth === 0 && /^\s*return\s*;?\s*$/.test(trimmed)) {
                issues.push("Top-level return statement found");
            }
            
            braceDepth += openBraces - closeBraces;
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