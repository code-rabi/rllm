/**
 * Tracked Graph - Proxy wrapper for access tracking
 * 
 * Wraps the graph context in recursive Proxies to emit events
 * whenever the RLLM-generated code accesses properties.
 * This enables real-time visualization of graph traversal.
 */

export interface AccessEvent {
  type: "node_access" | "edge_access" | "property_access";
  path: string[];          // e.g., ["packages", "lodash@4.17.21", "diskSize"]
  nodeId?: string;         // extracted node ID if applicable
  timestamp: number;
}

export type AccessCallback = (event: AccessEvent) => void;

/**
 * Create a tracked graph that emits events on property access
 */
export function createTrackedGraph<T extends object>(
  target: T,
  onAccess: AccessCallback,
  path: string[] = []
): T {
  return new Proxy(target, {
    get(obj: any, prop: string | symbol): any {
      // Skip symbol properties and internal properties
      if (typeof prop === "symbol" || prop.startsWith("__")) {
        return obj[prop];
      }
      
      const propStr = String(prop);
      const currentPath = [...path, propStr];
      
      // Emit access event
      const event: AccessEvent = {
        type: detectAccessType(currentPath),
        path: currentPath,
        nodeId: extractNodeId(currentPath),
        timestamp: Date.now(),
      };
      
      onAccess(event);
      
      const value = obj[prop];
      
      // Recursively wrap objects and arrays
      if (value !== null && typeof value === "object") {
        // Don't wrap functions or special objects
        if (typeof value === "function") {
          return value;
        }
        
        return createTrackedGraph(value, onAccess, currentPath);
      }
      
      return value;
    },
    
    // Also track property enumeration (for Object.keys, for...in, etc.)
    ownKeys(obj: any): (string | symbol)[] {
      const keys = Reflect.ownKeys(obj);
      
      // Emit enumeration event
      onAccess({
        type: "property_access",
        path: [...path, "[keys]"],
        timestamp: Date.now(),
      });
      
      return keys;
    },
    
    // Track has checks (if ("prop" in obj))
    has(obj: any, prop: string | symbol): boolean {
      if (typeof prop !== "symbol") {
        onAccess({
          type: "property_access",
          path: [...path, `[has:${String(prop)}]`],
          timestamp: Date.now(),
        });
      }
      return prop in obj;
    },
  });
}

/**
 * Detect the type of access based on the path
 */
function detectAccessType(path: string[]): AccessEvent["type"] {
  if (path.length === 0) {
    return "property_access";
  }
  
  // Check if accessing packages
  if (path[0] === "packages" && path.length >= 2) {
    return "node_access";
  }
  
  // Check if accessing edges
  if (path[0] === "edges") {
    return "edge_access";
  }
  
  return "property_access";
}

/**
 * Extract node ID from access path if applicable
 */
function extractNodeId(path: string[]): string | undefined {
  // Pattern: ["packages", "lodash@4.17.21", ...]
  if (path[0] === "packages" && path.length >= 2) {
    const nodeId = path[1];
    // Check if it looks like a package ID (has @ and version)
    if (nodeId && nodeId.includes("@")) {
      return nodeId;
    }
  }
  
  return undefined;
}

/**
 * Debounce function to avoid flooding with too many events
 */
export function createDebouncedCallback(
  callback: AccessCallback,
  delayMs: number = 50
): AccessCallback {
  let timeout: NodeJS.Timeout | null = null;
  let pendingEvents: AccessEvent[] = [];
  
  return (event: AccessEvent) => {
    pendingEvents.push(event);
    
    if (timeout) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(() => {
      // Deduplicate events by path
      const uniqueEvents = new Map<string, AccessEvent>();
      for (const evt of pendingEvents) {
        const key = evt.path.join(".");
        if (!uniqueEvents.has(key)) {
          uniqueEvents.set(key, evt);
        }
      }
      
      // Emit unique events
      for (const evt of uniqueEvents.values()) {
        callback(evt);
      }
      
      pendingEvents = [];
      timeout = null;
    }, delayMs);
  };
}

/**
 * Filter to only emit node/edge access events (ignore property access)
 */
export function createFilteredCallback(
  callback: AccessCallback,
  types: AccessEvent["type"][] = ["node_access", "edge_access"]
): AccessCallback {
  return (event: AccessEvent) => {
    if (types.includes(event.type)) {
      callback(event);
    }
  };
}
