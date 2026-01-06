#!/usr/bin/env python3
"""
Generate benchmark chart for RLM-TS (matching paper Figure 1 style)
"""
import matplotlib.pyplot as plt
import numpy as np

# Data from benchmark
context_lengths = ["8k", "16k", "33k", "66k", "131k", "262k", "524k", "1M"]
sniah_scores = [100.0, 100.0, 100.0, 100.0, 80.0, 100.0, 100.0, 100.0]
pairs_scores = [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0]
oolong_scores = [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0]

# Create figure
fig, ax = plt.subplots(1, 1, figsize=(10, 6))

# Colors matching the paper (Figure 1)
sniah_color = '#1f77b4'   # Blue (like paper)
pairs_color = '#c0392b'   # Dark red (OOLONG-Pairs in paper)
oolong_color = '#d35400'  # Orange (OOLONG in paper)

# Plot lines with different markers
x = np.arange(len(context_lengths))
ax.plot(x, sniah_scores, 'o-', color=sniah_color, linewidth=2, markersize=8, label='S-NIAH')
ax.plot(x, pairs_scores, 's-', color=pairs_color, linewidth=2, markersize=8, label='OOLONG-Pairs')
ax.plot(x, oolong_scores, '^-', color=oolong_color, linewidth=2, markersize=8, label='OOLONG')

# Styling
ax.set_xlabel('Input Context Length (log scale)', fontsize=12)
ax.set_ylabel('Score (%)', fontsize=12)
ax.set_title('RLM-TS (gpt-5.2)', fontsize=14, fontweight='bold')
ax.set_xticks(x)
ax.set_xticklabels(context_lengths)
ax.set_ylim(0, 105)
ax.set_yticks([0, 20, 40, 60, 80, 100])
ax.grid(True, alpha=0.3)
ax.legend(loc='lower left', fontsize=11)

# Background shading (green = within context window)
ax.axvspan(-0.5, len(context_lengths) - 0.5, alpha=0.08, color='green')

plt.tight_layout()
plt.savefig('benchmarks/results/rlm_ts_benchmark.png', dpi=150, bbox_inches='tight')
print('Saved: benchmarks/results/rlm_ts_benchmark.png')
plt.close()
