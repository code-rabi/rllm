#!/usr/bin/env npx tsx
/**
 * Visualize OOLONG Benchmark Results
 * 
 * Generates an HTML report with charts showing benchmark performance.
 * 
 * Usage:
 *   pnpm tsx benchmarks/visualize.ts [results-file]
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OolongBenchmarkResult } from "./oolong.js";

function findLatestResults(): string {
  const resultsDir = "./benchmarks/results";
  const files = readdirSync(resultsDir)
    .filter(f => f.startsWith("oolong-") && f.endsWith(".json"))
    .sort()
    .reverse();
  
  if (files.length === 0) {
    throw new Error("No benchmark results found in ./benchmarks/results/");
  }
  
  return join(resultsDir, files[0]!);
}

function generateHTML(results: OolongBenchmarkResult, modelName: string): string {
  const categories = Object.entries(results.summary.byCategory);
  const categoryLabels = categories.map(([cat]) => cat);
  const categoryCorrect = categories.map(([, stats]) => stats.correct);
  const categoryTotal = categories.map(([, stats]) => stats.total);
  const categoryAccuracy = categories.map(([, stats]) => (stats.accuracy * 100).toFixed(1));

  const taskTimes = results.results.map(r => r.usage.executionTimeMs / 1000);
  const taskLabels = results.tasks.map(t => t.id);
  const taskCorrect = results.results.map(r => r.correct ? 1 : 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OOLONG Benchmark Results - RLM-TS</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-card: #21262d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --warning: #d29922;
      --error: #f85149;
      --border: #30363d;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem;
    }
    
    .container { max-width: 1200px; margin: 0 auto; }
    
    header {
      text-align: center;
      margin-bottom: 3rem;
      padding: 2rem;
      background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-card) 100%);
      border-radius: 16px;
      border: 1px solid var(--border);
    }
    
    h1 {
      font-size: 2.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, var(--accent), var(--success));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    .subtitle { color: var(--text-secondary); font-size: 1.1rem; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
      margin-bottom: 3rem;
    }
    
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      text-align: center;
    }
    
    .stat-value {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }
    
    .stat-value.success { color: var(--success); }
    .stat-value.warning { color: var(--warning); }
    .stat-value.accent { color: var(--accent); }
    
    .stat-label { color: var(--text-secondary); font-size: 0.9rem; }
    
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 2rem;
      margin-bottom: 3rem;
    }
    
    .chart-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
    }
    
    .chart-title {
      font-size: 1.2rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }
    
    .chart-container { position: relative; height: 300px; }
    
    .results-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-card);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    
    .results-table th,
    .results-table td {
      padding: 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    .results-table th {
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.8rem;
      letter-spacing: 0.05em;
    }
    
    .results-table tr:last-child td { border-bottom: none; }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    
    .badge.success { background: rgba(63, 185, 80, 0.2); color: var(--success); }
    .badge.error { background: rgba(248, 81, 73, 0.2); color: var(--error); }
    
    footer {
      text-align: center;
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
      color: var(--text-secondary);
    }
    
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>OOLONG Benchmark Results</h1>
      <p class="subtitle">RLM-TS with ${modelName} • ${new Date().toLocaleDateString()}</p>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value ${results.summary.accuracy >= 0.7 ? 'success' : results.summary.accuracy >= 0.5 ? 'warning' : 'error'}">
          ${(results.summary.accuracy * 100).toFixed(1)}%
        </div>
        <div class="stat-label">Overall Accuracy</div>
      </div>
      <div class="stat-card">
        <div class="stat-value accent">${results.summary.correct}/${results.summary.total}</div>
        <div class="stat-label">Tasks Correct</div>
      </div>
      <div class="stat-card">
        <div class="stat-value accent">${(results.summary.avgTimeMs / 1000).toFixed(1)}s</div>
        <div class="stat-label">Avg Time per Task</div>
      </div>
      <div class="stat-card">
        <div class="stat-value accent">${(results.summary.totalTokens / 1000).toFixed(1)}k</div>
        <div class="stat-label">Total Tokens</div>
      </div>
    </div>
    
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">Accuracy by Category</div>
        <div class="chart-container">
          <canvas id="categoryChart"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Execution Time by Task</div>
        <div class="chart-container">
          <canvas id="timeChart"></canvas>
        </div>
      </div>
    </div>
    
    <div class="chart-card" style="margin-bottom: 2rem;">
      <div class="chart-title">Detailed Results</div>
      <table class="results-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Category</th>
            <th>Context Size</th>
            <th>Time</th>
            <th>Iterations</th>
            <th>Tokens</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${results.tasks.map((task, i) => {
            const result = results.results[i]!;
            return `
              <tr>
                <td>${task.name}</td>
                <td>${task.category}</td>
                <td>${Math.round(task.contextLength / 1000)}k chars</td>
                <td>${(result.usage.executionTimeMs / 1000).toFixed(1)}s</td>
                <td>${result.usage.rootCalls}</td>
                <td>${result.usage.tokenUsage.totalTokens.toLocaleString()}</td>
                <td><span class="badge ${result.correct ? 'success' : 'error'}">${result.correct ? '✓ Correct' : '✗ Failed'}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    
    <footer>
      <p>
        Based on the <a href="https://arxiv.org/abs/2512.24601">RLM Paper</a> •
        <a href="https://alexzhang13.github.io/blog/2025/rlm/">Blog Post</a> •
        <a href="https://huggingface.co/datasets/oolongbench/oolong-synth">OOLONG Dataset</a>
      </p>
    </footer>
  </div>
  
  <script>
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#30363d';
    
    // Category accuracy chart
    new Chart(document.getElementById('categoryChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(categoryLabels)},
        datasets: [{
          label: 'Accuracy (%)',
          data: ${JSON.stringify(categoryAccuracy)},
          backgroundColor: ${JSON.stringify(categoryAccuracy.map(acc => 
            parseFloat(acc) >= 70 ? 'rgba(63, 185, 80, 0.8)' : 
            parseFloat(acc) >= 50 ? 'rgba(210, 153, 34, 0.8)' : 
            'rgba(248, 81, 73, 0.8)'
          ))},
          borderRadius: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: 100, grid: { color: '#30363d' } },
          x: { grid: { display: false } }
        }
      }
    });
    
    // Time chart
    new Chart(document.getElementById('timeChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(taskLabels)},
        datasets: [{
          label: 'Time (seconds)',
          data: ${JSON.stringify(taskTimes.map(t => t.toFixed(1)))},
          backgroundColor: ${JSON.stringify(taskCorrect.map(c => 
            c ? 'rgba(88, 166, 255, 0.8)' : 'rgba(248, 81, 73, 0.8)'
          ))},
          borderRadius: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: '#30363d' } },
          x: { grid: { display: false } }
        }
      }
    });
  </script>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const resultsFile = args[0] ?? findLatestResults();
  const modelName = process.env.MODEL ?? "gpt-5-mini";
  
  console.log(`Loading results from: ${resultsFile}`);
  
  const results: OolongBenchmarkResult = JSON.parse(readFileSync(resultsFile, "utf-8"));
  const html = generateHTML(results, modelName);
  
  const outputFile = "./benchmarks/results/report.html";
  writeFileSync(outputFile, html);
  
  console.log(`\n✅ Report generated: ${outputFile}`);
  console.log(`\nOpen in browser to view the charts!`);
}

main().catch(console.error);

