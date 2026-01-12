/**
 * Build dependency graph from parsed node_modules
 * 
 * Creates nodes and edges suitable for visualization and RLLM queries.
 */

import type { PackageInfo, ParsedNodeModules } from "./parse-node-modules.js";

export interface GraphNode {
  id: string;              // "lodash@4.17.21"
  name: string;            // "lodash"
  version: string;         // "4.17.21"
  diskSize: number;        // bytes
  license?: string;
  description?: string;
  isHoisted: boolean;
  isDuplicate: boolean;    // true if another version exists
  duplicateOf?: string[];  // other version IDs
  dependents: string[];    // packages that depend on this
  dependencyCount: number; // total number of dependencies
}

export interface GraphEdge {
  id: string;              // "react@18.2.0->scheduler"
  source: string;          // "react@18.2.0"
  target: string;          // target package name (not full ID, as version may vary)
  targetId?: string;       // resolved target ID if found
  versionRange: string;    // "^0.23.0"
  type: "prod" | "dev" | "peer" | "optional";
}

export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  nodesByName: Map<string, string[]>; // name -> [id1, id2, ...]
  stats: {
    totalPackages: number;
    totalDuplicates: number;
    totalSize: number;
    largestPackage: { id: string; size: number };
    mostDependents: { id: string; count: number };
  };
}

/**
 * Build graph from parsed node_modules
 */
export function buildGraph(parsed: ParsedNodeModules): DependencyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const nodesByName = new Map<string, string[]>();
  
  // Build nodes
  for (const [id, pkg] of parsed.packages) {
    const duplicateIds = parsed.duplicates.get(pkg.name);
    const isDuplicate = duplicateIds !== undefined && duplicateIds.length > 1;
    
    const node: GraphNode = {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      diskSize: pkg.diskSize,
      license: pkg.license,
      description: pkg.description,
      isHoisted: pkg.isHoisted,
      isDuplicate,
      duplicateOf: isDuplicate ? duplicateIds.filter(did => did !== id) : undefined,
      dependents: [],
      dependencyCount: 0,
    };
    
    nodes.set(id, node);
    
    // Index by name
    if (!nodesByName.has(pkg.name)) {
      nodesByName.set(pkg.name, []);
    }
    nodesByName.get(pkg.name)!.push(id);
  }
  
  // Build edges and count dependencies
  for (const [id, pkg] of parsed.packages) {
    const node = nodes.get(id)!;
    
    // Process all dependency types
    const depTypes: Array<[Record<string, string>, "prod" | "dev" | "peer" | "optional"]> = [
      [pkg.dependencies, "prod"],
      [pkg.devDependencies, "dev"],
      [pkg.peerDependencies, "peer"],
      [pkg.optionalDependencies, "optional"],
    ];
    
    for (const [deps, type] of depTypes) {
      for (const [depName, versionRange] of Object.entries(deps)) {
        node.dependencyCount++;
        
        // Try to resolve the target package
        const targetIds = nodesByName.get(depName);
        const targetId = targetIds?.[0]; // Use first match (could be smarter with semver)
        
        const edge: GraphEdge = {
          id: `${id}->${depName}`,
          source: id,
          target: depName,
          targetId,
          versionRange,
          type,
        };
        
        edges.push(edge);
        
        // Add to dependents list
        if (targetId) {
          const targetNode = nodes.get(targetId);
          if (targetNode) {
            targetNode.dependents.push(id);
          }
        }
      }
    }
  }
  
  // Calculate stats
  let totalSize = 0;
  let largestPackage = { id: "", size: 0 };
  let mostDependents = { id: "", count: 0 };
  
  for (const [id, node] of nodes) {
    totalSize += node.diskSize;
    
    if (node.diskSize > largestPackage.size) {
      largestPackage = { id, size: node.diskSize };
    }
    
    if (node.dependents.length > mostDependents.count) {
      mostDependents = { id, count: node.dependents.length };
    }
  }
  
  const stats = {
    totalPackages: nodes.size,
    totalDuplicates: parsed.duplicates.size,
    totalSize,
    largestPackage,
    mostDependents,
  };
  
  return {
    nodes,
    edges,
    nodesByName,
    stats,
  };
}

/**
 * Convert graph to JSON-serializable format for context
 */
export function graphToContext(graph: DependencyGraph) {
  return {
    packages: Object.fromEntries(graph.nodes),
    edges: graph.edges,
    packagesByName: Object.fromEntries(graph.nodesByName),
    stats: graph.stats,
  };
}

/**
 * Convert graph to force-graph-3d format
 */
export function graphToForceGraph(graph: DependencyGraph) {
  const nodes = Array.from(graph.nodes.values()).map(node => ({
    id: node.id,
    name: node.name,
    version: node.version,
    diskSize: node.diskSize,
    isDuplicate: node.isDuplicate,
    isHoisted: node.isHoisted,
    dependents: node.dependents.length,
  }));
  
  const links = graph.edges
    .filter(edge => edge.targetId) // Only include edges with resolved targets
    .map(edge => ({
      source: edge.source,
      target: edge.targetId!,
      type: edge.type,
      versionRange: edge.versionRange,
    }));
  
  return { nodes, links };
}
