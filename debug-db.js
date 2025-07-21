#!/usr/bin/env node

console.log('=== Database Initialization Debug Tool ===');
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('Working directory:', process.cwd());

try {
    console.log('\n1. Testing better-sqlite3 import...');
    const Database = require('better-sqlite3');
    console.log('✅ better-sqlite3 imported successfully');
    
    console.log('\n2. Testing database creation...');
    const testDbPath = './test_db.db';
    const db = new Database(testDbPath);
    console.log('✅ Database created successfully at:', testDbPath);
    
    console.log('\n3. Testing database operations...');
    db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)');
    const stmt = db.prepare('INSERT INTO test (name) VALUES (?)');
    const result = stmt.run('test_entry');
    console.log('✅ Database operations successful, inserted ID:', result.lastInsertRowid);
    
    console.log('\n4. Testing database query...');
    const selectStmt = db.prepare('SELECT * FROM test WHERE id = ?');
    const row = selectStmt.get(result.lastInsertRowid);
    console.log('✅ Database query successful:', row);
    
    console.log('\n5. Cleaning up...');
    db.close();
    console.log('✅ Database closed successfully');
    
    // Clean up test file
    const fs = require('fs');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
        console.log('✅ Test database file cleaned up');
    }
    
    console.log('\n6. Testing PerformanceDatabase class...');
    const PerformanceDatabase = require('./lib/performance-db.js');
    const perfDb = new PerformanceDatabase('./debug_performance.db');
    
    setTimeout(() => {
        console.log('Database initialized:', perfDb.initialized);
        console.log('Database path:', perfDb.dbPath);
        
        if (perfDb.initialized) {
            console.log('✅ PerformanceDatabase initialization successful');
        } else {
            console.log('❌ PerformanceDatabase initialization failed');
        }
        
        perfDb.close();
        
        // Clean up debug database
        const debugDbPath = './debug_performance.db';
        if (fs.existsSync(debugDbPath)) {
            fs.unlinkSync(debugDbPath);
            console.log('✅ Debug database file cleaned up');
        }
        
        console.log('\n=== Debug Complete ===');
        console.log('If this script runs successfully but you still see errors in Node-RED,');
        console.log('the issue is likely related to:');
        console.log('- File permissions in Node-RED user directory');
        console.log('- Different Node.js version in Node-RED vs command line');
        console.log('- Missing write permissions in Node-RED working directory');
    }, 500);
    
} catch (error) {
    console.error('\n❌ Error during database testing:');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('\nThis indicates a problem with better-sqlite3 installation or compatibility.');
    console.error('Try running: npm rebuild better-sqlite3');
}