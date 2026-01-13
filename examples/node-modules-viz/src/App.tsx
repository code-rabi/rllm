import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';
import './App.css';

interface GraphData {
  nodes: any[];
  links: any[];
}

interface Stats {
  totalPackages: number;
  totalLinks: number;
  directDeps: number;
}

interface ActivityLogEntry {
  id: number;
  type: string;
  timestamp: number;
  iteration?: number;
  code?: string;
  response?: string;
  output?: string;
  error?: string;
  answer?: string;
  prompt?: string;
  expanded?: boolean;
}

const EXAMPLE_QUERIES = [
  { label: '🔍 Find Duplicates', query: 'Which packages have multiple versions installed? List them with their sizes.' },
  { label: '📊 Largest Packages', query: 'What are the 5 largest packages by disk size?' },
  { label: '⭐ Most Popular', query: 'Which packages have the most dependents?' },
  { label: '💾 Total Size', query: 'How much total disk space is used by all packages?' },
  { label: '⚖️ MIT Licenses', query: 'List all packages with MIT license.' },
  { label: '🔗 Dependency Path', query: 'Show the dependency chain from the root to typescript.' },
];

function App() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState('Connecting...');
  const [statusClass, setStatusClass] = useState('');
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const activityLogRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);
  
  const fgRef = useRef<any>();
  const [highlightedNodes, setHighlightedNodes] = useState(new Set<string>());
  const accessQueue = useRef<string[]>([]);
  const isProcessingQueue = useRef(false);
  const bloomPassAdded = useRef(false);

  // Add bloom post-processing and lighting for realistic look
  useEffect(() => {
    if (fgRef.current && graphData.nodes.length > 0 && !bloomPassAdded.current) {
      // Add bloom pass
      const bloomPass = new UnrealBloomPass();
      bloomPass.strength = 3;
      bloomPass.radius = 1;
      bloomPass.threshold = 0.7;
      fgRef.current.postProcessingComposer().addPass(bloomPass);
      
      // Add realistic lighting to the scene
      const scene = fgRef.current.scene();
      
      // Ambient light for base illumination
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
      scene.add(ambientLight);
      
      // Key light (main directional light)
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.0) as any;
      keyLight.position.set(200, 200, 200);
      scene.add(keyLight);
      
      // Fill light (softer, from opposite side)
      const fillLight = new THREE.DirectionalLight(0x8888ff, 0.5) as any;
      fillLight.position.set(-200, 0, -200);
      scene.add(fillLight);
      
      // Rim light for edge highlights
      const rimLight = new THREE.DirectionalLight(0xffffcc, 0.3) as any;
      rimLight.position.set(0, -200, 200);
      scene.add(rimLight);
      
      bloomPassAdded.current = true;
    }
  }, [graphData.nodes.length]);
  
  // Process access events with smooth delay
  const processAccessQueue = useCallback(() => {
    if (isProcessingQueue.current || accessQueue.current.length === 0) return;
    
    isProcessingQueue.current = true;
    
    const processNext = () => {
      const nodeId = accessQueue.current.shift();
      if (!nodeId) {
        isProcessingQueue.current = false;
        return;
      }
      
      // Highlight this node
      setHighlightedNodes(prev => {
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
      
      // Clear highlight after a bit
      setTimeout(() => {
        setHighlightedNodes(prev => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }, 300);
      
      // Process next with delay (30ms for smooth stream effect)
      if (accessQueue.current.length > 0) {
        setTimeout(processNext, 60);
      } else {
        isProcessingQueue.current = false;
      }
    };
    
    processNext();
  }, []);

  // WebSocket connection
  useEffect(() => {
    // Try to connect directly to port 3737, or fall back to same port if in dev container
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = import.meta.env.DEV ? '4242' : window.location.port;
    const wsUrl = `${protocol}//${window.location.hostname}:${port}`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    const websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
      console.log('WebSocket connected');
      setStatus('🟢 Connected');
      setStatusClass('connected');
    };
    
    websocket.onclose = () => {
      console.log('WebSocket disconnected');
      setStatus('🔴 Disconnected');
      setStatusClass('error');
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('🔴 Error');
      setStatusClass('error');
    };
    
    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleMessage(message);
    };
    
    setWs(websocket);
    
    return () => websocket.close();
  }, []);

  const handleMessage = (message: any) => {
    switch (message.type) {
      case 'graph_data':
        setGraphData(message.data.graph);
        setStats(message.data.stats);
        break;
      case 'access_event':
        if (message.data.nodeId) {
          // Add to queue for smooth streaming effect
          accessQueue.current.push(message.data.nodeId);
          processAccessQueue();
        }
        break;
      case 'status':
        if (message.status === 'running') {
          setIsRunning(true);
          setStatus('🤖 Running Query...');
          setStatusClass('running');
        } else if (message.status === 'completed') {
          setIsRunning(false);
          setStatus('🟢 Connected');
          setStatusClass('connected');
        } else if (message.status === 'error') {
          setIsRunning(false);
          setStatus('🔴 Error');
          setStatusClass('error');
        }
        break;
      case 'result':
        // answer is now { message: string, data?: unknown }
        const answer = message.data.answer;
        const displayResult = typeof answer === 'object' && answer?.message 
          ? answer.message 
          : String(answer);
        setResult(displayResult);
        setShowResult(true);
        setTimeout(() => setShowResult(false), 10000);
        break;
      case 'rllm_event':
        const event = message.data;
        const entry: ActivityLogEntry = {
          id: logIdCounter.current++,
          type: event.type,
          timestamp: event.timestamp,
          iteration: event.iteration,
          code: event.code,
          response: event.response,
          output: event.output,
          error: event.error,
          answer: event.answer,
          prompt: event.prompt,
        };
        setActivityLog(prev => [...prev.slice(-50), entry]); // Keep last 50 entries
        // Auto-scroll to bottom
        setTimeout(() => {
          activityLogRef.current?.scrollTo({ top: activityLogRef.current.scrollHeight, behavior: 'smooth' });
        }, 50);
        break;
    }
  };


  const runQuery = () => {
    if (!query.trim() || !ws || isRunning) return;
    setActivityLog([]); // Clear log for new query
    ws.send(JSON.stringify({ type: 'run_query', query }));
  };

  const toggleExpand = (id: number) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'iteration_start': return '🔄';
      case 'llm_query_start': return '🤔';
      case 'llm_query_end': return '💬';
      case 'code_execution_start': return '⚡';
      case 'code_execution_end': return '✅';
      case 'final_answer': return '🎯';
      default: return '📝';
    }
  };

  const getEventLabel = (type: string) => {
    switch (type) {
      case 'iteration_start': return 'Iteration';
      case 'llm_query_start': return 'Querying LLM...';
      case 'llm_query_end': return 'LLM Response';
      case 'code_execution_start': return 'Running Code';
      case 'code_execution_end': return 'Code Complete';
      case 'final_answer': return 'Final Answer';
      default: return type;
    }
  };

  const nodeColor = useCallback((node: any) => {
    if (highlightedNodes.has(node.id)) return '#ffff00'; // Bright yellow for bloom
    return node.color || '#58a6ff';
  }, [highlightedNodes]);

  const nodeVal = useCallback((node: any) => {
    // Make highlighted nodes 3x bigger
    const baseSize = node.val || 5;
    return highlightedNodes.has(node.id) ? baseSize * 3 : baseSize;
  }, [highlightedNodes]);

  // Check if a link connects two highlighted nodes
  const isLinkHighlighted = useCallback((link: any) => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    return highlightedNodes.has(sourceId) && highlightedNodes.has(targetId);
  }, [highlightedNodes]);

  // Link color - electric cyan when both nodes are highlighted
  const linkColor = useCallback((link: any) => {
    return isLinkHighlighted(link) ? '#00ffff' : 'rgba(139, 148, 158, 0.3)';
  }, [isLinkHighlighted]);

  // Link width - thicker for highlighted links
  const linkWidth = useCallback((link: any) => {
    return isLinkHighlighted(link) ? 6 : 1;
  }, [isLinkHighlighted]);

  // Particles - more on highlighted links for flowing effect
  const linkDirectionalParticles = useCallback((link: any) => {
    return isLinkHighlighted(link) ? 8 : 0;
  }, [isLinkHighlighted]);

  // Particle speed - faster for highlighted links
  const linkDirectionalParticleSpeed = useCallback((link: any) => {
    return isLinkHighlighted(link) ? 0.02 : 0.004;
  }, [isLinkHighlighted]);

  // Particle width - bigger for highlighted links  
  const linkDirectionalParticleWidth = useCallback((link: any) => {
    return isLinkHighlighted(link) ? 4 : 1;
  }, [isLinkHighlighted]);

  // Particle color - matches the link color
  const linkDirectionalParticleColor = useCallback((link: any) => {
    return isLinkHighlighted(link) ? '#ffff00' : 'rgba(139, 148, 158, 0.5)';
  }, [isLinkHighlighted]);

  // High-quality sphere geometry (reused for performance)
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(1, 64, 64), []);

  // Custom node rendering with realistic materials
  const nodeThreeObject = useCallback((node: any) => {
    const isHighlighted = highlightedNodes.has(node.id);
    const baseSize = node.val || 5;
    const size = isHighlighted ? baseSize * 1.5 : baseSize * 0.8;
    
    // Get node color
    const colorHex = isHighlighted ? '#ffff00' : (node.color || '#58a6ff');
    const color = new THREE.Color(colorHex);
    
    // Create material with realistic properties
    const material = new THREE.MeshPhysicalMaterial({
      color: color,
      metalness: 0.3,
      roughness: 0.4,
      emissive: isHighlighted ? color : new THREE.Color(0x000000),
      emissiveIntensity: isHighlighted ? 0.2 : 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.25,
    });
    
    const mesh = new THREE.Mesh(sphereGeometry, material as any) as any;
    mesh.scale.set(size, size, size);
    
    return mesh;
  }, [highlightedNodes, sphereGeometry]);

  return (
    <div className="app">
      <header className="header">
        <h1>📦 node_modules Graph Analyzer</h1>
        <div className={`status ${statusClass}`}>{status}</div>
      </header>

      <div className="query-panel">
        <div className="query-input-container">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runQuery()}
            placeholder="Ask a question about your dependencies..."
            disabled={isRunning}
          />
          <button onClick={runQuery} disabled={isRunning || !query.trim()}>
            Run Query
          </button>
        </div>
        <div className="example-queries">
          {EXAMPLE_QUERIES.map((ex, i) => (
            <button
              key={i}
              className="example-query-btn"
              onClick={() => {
                setQuery(ex.query);
                if (ws && !isRunning) {
                  ws.send(JSON.stringify({ type: 'run_query', query: ex.query }));
                }
              }}
              disabled={isRunning}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <div className="stats-panel">
          <div className="stat-row">
            <span className="stat-label">Packages</span>
            <span className="stat-value">{stats.totalPackages}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Dependencies</span>
            <span className="stat-value">{stats.totalLinks}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Direct Deps</span>
            <span className="stat-value highlight">{stats.directDeps}</span>
          </div>
        </div>
      )}

      <div className="legend">
        <div className="legend-title">Node Colors</div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#ff6b6b' }} />
          <span>Root</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#4ecdc4' }} />
          <span>Direct Dependency</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#6c9bcf' }} />
          <span>Transitive Dependency</span>
        </div>
      </div>

      {showResult && (
        <div className="result-panel">
          <pre>{result}</pre>
        </div>
      )}

      {/* Activity Log Panel */}
      <div className="activity-log">
        <div className="activity-log-header">
          <span>🔍 Activity Log</span>
          {activityLog.length > 0 && (
            <button className="clear-log-btn" onClick={() => setActivityLog([])}>Clear</button>
          )}
        </div>
        <div className="activity-log-content" ref={activityLogRef}>
          {activityLog.length === 0 ? (
            <div className="activity-log-empty">Run a query to see activity...</div>
          ) : (
            activityLog.map(entry => (
              <div key={entry.id} className={`activity-entry activity-${entry.type}`}>
                  <div 
                  className="activity-entry-header"
                  onClick={() => (entry.code || entry.response || entry.output || entry.answer || entry.prompt) && toggleExpand(entry.id)}
                >
                  <span className="activity-icon">{getEventIcon(entry.type)}</span>
                  <span className="activity-label">{getEventLabel(entry.type)}</span>
                  {entry.iteration && <span className="activity-iteration">#{entry.iteration}</span>}
                  {(entry.code || entry.response || entry.output || entry.answer || entry.prompt) && (
                    <span className="activity-expand">{expandedEntries.has(entry.id) ? '▼' : '▶'}</span>
                  )}
                </div>
                {expandedEntries.has(entry.id) && (
                  <div className="activity-entry-content">
                    {entry.prompt && (
                      <div className="activity-prompt">
                        <div className="activity-code-label">Prompt:</div>
                        <pre>{entry.prompt.slice(0, 500)}{entry.prompt.length > 500 ? '...' : ''}</pre>
                      </div>
                    )}
                    {entry.code && (
                      <div className="activity-code">
                        <div className="activity-code-label">Code:</div>
                        <pre>{entry.code}</pre>
                      </div>
                    )}
                    {entry.response && (
                      <div className="activity-response">
                        <div className="activity-code-label">Response:</div>
                        <pre>{entry.response.slice(0, 500)}{entry.response.length > 500 ? '...' : ''}</pre>
                      </div>
                    )}
                    {entry.output && (
                      <div className="activity-output">
                        <div className="activity-code-label">Output:</div>
                        <pre>{entry.output}</pre>
                      </div>
                    )}
                    {entry.error && (
                      <div className="activity-error">
                        <div className="activity-code-label">Error:</div>
                        <pre>{entry.error}</pre>
                      </div>
                    )}
                    {entry.answer && (
                      <div className="activity-answer">
                        <div className="activity-code-label">Answer:</div>
                        <pre>{typeof entry.answer === 'object' ? JSON.stringify(entry.answer, null, 2) : entry.answer}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {graphData.nodes.length > 0 ? (
        <ForceGraph3D
          ref={fgRef}
          graphData={graphData}
          nodeLabel={(node: any) => `${node.name}${node.version ? '@' + node.version : ''}`}
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={0.6}
          linkDirectionalParticles={linkDirectionalParticles}
          linkDirectionalParticleSpeed={linkDirectionalParticleSpeed}
          linkDirectionalParticleWidth={linkDirectionalParticleWidth}
          linkDirectionalParticleColor={linkDirectionalParticleColor}
          backgroundColor="#000002"
          enableNodeDrag={true}
          enableNavigationControls={true}
          showNavInfo={false}
        />
      ) : (
        <div className="loading">
          <div className="spinner" />
          <div>Loading graph data...</div>
        </div>
      )}
    </div>
  );
}

export default App;
