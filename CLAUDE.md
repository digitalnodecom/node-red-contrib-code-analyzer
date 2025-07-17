# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node-RED package called "node-red-contrib-code-analyzer" that provides a background service to detect debugging artifacts in function nodes across Node-RED flows. The package continuously monitors all function nodes and flags those containing debugging code like console.log statements, standalone returns, TODO comments, and hardcoded test values.

## Architecture

The codebase follows a typical Node-RED package structure:

- `lib/detector.js` - Core detection logic containing regex patterns for identifying debugging artifacts
- `nodes/analyzer.js` - Node-RED runtime logic that manages scanning, timers, and status updates
- `nodes/analyzer.html` - Editor UI definition with configuration options and help text
- `package.json` - Standard Node-RED package configuration with node registration

### Key Components

**Detection Engine** (`lib/detector.js`): Uses regex patterns to identify debugging patterns:
- Standalone return statements
- Console.log statements  
- TODO/FIXME comments
- Debugger statements
- Hardcoded test values

**Analyzer Node** (`nodes/analyzer.js`): 
- Iterates through all Node-RED function nodes using `RED.nodes.eachNode()`
- Sets status indicators on function nodes with issues
- Manages periodic scanning with configurable intervals
- Handles manual scan triggers via input messages

**Editor UI** (`nodes/analyzer.html`):
- Provides configuration for scan intervals and enabled checks
- Registers the node in the "utility" category
- Includes comprehensive help documentation

## Development Commands

The package.json only defines a basic test script that exits with an error. There are no build, lint, or other development commands configured.

## Installation and Usage

This is a Node-RED package that gets installed into a Node-RED instance. Once installed, users add the "Code Analyzer" node to any flow, configure the scan settings, and it automatically monitors all function nodes in the background.

## Key Behaviors

- The analyzer scans all function nodes across all flows (not just the current flow)
- Function nodes with issues display red status indicators
- The analyzer node itself shows green (no issues) or yellow (issues found) status
- Scanning can be triggered manually by sending any message to the analyzer node
- The node uses a configurable scan interval (default 30 seconds)