/**
 * Parse node_modules directory into a structured graph
 * 
 * Walks the node_modules tree, reads package.json files,
 * calculates disk sizes, and detects duplicates.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

export interface PackageInfo {
  id: string;              // "lodash@4.17.21"
  name: string;            // "lodash"
  version: string;         // "4.17.21"
  path: string;            // relative path from target root
  diskSize: number;        // bytes on disk
  license?: string;
  description?: string;
  isHoisted: boolean;      // true if at top-level node_modules
  dependencies: Record<string, string>;     // prod deps
  devDependencies: Record<string, string>;  // dev deps
  peerDependencies: Record<string, string>; // peer deps
  optionalDependencies: Record<string, string>; // optional deps
}

export interface ParsedNodeModules {
  packages: Map<string, PackageInfo>;
  duplicates: Map<string, string[]>; // name -> [id1, id2, ...]
  rootPath: string;
}

/**
 * Calculate directory size recursively
 */
function getDirSize(dirPath: string): number {
  let totalSize = 0;
  
  try {
    const items = readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = join(dirPath, item);
      const stats = statSync(itemPath);
      
      if (stats.isDirectory()) {
        totalSize += getDirSize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (err) {
    // Ignore permission errors, symlink issues, etc.
  }
  
  return totalSize;
}

/**
 * Parse a single package.json file
 */
function parsePackageJson(pkgPath: string, relativePath: string, isHoisted: boolean): PackageInfo | null {
  try {
    const pkgJsonPath = join(pkgPath, "package.json");
    
    if (!existsSync(pkgJsonPath)) {
      return null;
    }
    
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const name = pkgJson.name as string;
    const version = pkgJson.version as string;
    
    if (!name || !version) {
      return null;
    }
    
    const id = `${name}@${version}`;
    const diskSize = getDirSize(pkgPath);
    
    return {
      id,
      name,
      version,
      path: relativePath,
      diskSize,
      license: pkgJson.license,
      description: pkgJson.description,
      isHoisted,
      dependencies: pkgJson.dependencies || {},
      devDependencies: pkgJson.devDependencies || {},
      peerDependencies: pkgJson.peerDependencies || {},
      optionalDependencies: pkgJson.optionalDependencies || {},
    };
  } catch (err) {
    console.warn(`Failed to parse ${pkgPath}:`, err);
    return null;
  }
}

/**
 * Recursively walk node_modules directory
 */
function walkNodeModules(
  nodeModulesPath: string,
  rootPath: string,
  packages: Map<string, PackageInfo>,
  isTopLevel: boolean = true
): void {
  if (!existsSync(nodeModulesPath)) {
    return;
  }
  
  try {
    const items = readdirSync(nodeModulesPath);
    
    for (const item of items) {
      // Skip hidden files and .bin
      if (item.startsWith(".")) {
        continue;
      }
      
      const itemPath = join(nodeModulesPath, item);
      const stats = statSync(itemPath);
      
      if (!stats.isDirectory()) {
        continue;
      }
      
      // Handle scoped packages (@org/package)
      if (item.startsWith("@")) {
        const scopedItems = readdirSync(itemPath);
        for (const scopedItem of scopedItems) {
          const scopedPath = join(itemPath, scopedItem);
          const scopedStats = statSync(scopedPath);
          
          if (scopedStats.isDirectory()) {
            const relativePath = relative(rootPath, scopedPath);
            const pkgInfo = parsePackageJson(scopedPath, relativePath, isTopLevel);
            
            if (pkgInfo) {
              packages.set(pkgInfo.id, pkgInfo);
              
              // Recursively check for nested node_modules
              const nestedNodeModules = join(scopedPath, "node_modules");
              if (existsSync(nestedNodeModules)) {
                walkNodeModules(nestedNodeModules, rootPath, packages, false);
              }
            }
          }
        }
      } else {
        // Regular package
        const relativePath = relative(rootPath, itemPath);
        const pkgInfo = parsePackageJson(itemPath, relativePath, isTopLevel);
        
        if (pkgInfo) {
          packages.set(pkgInfo.id, pkgInfo);
          
          // Recursively check for nested node_modules
          const nestedNodeModules = join(itemPath, "node_modules");
          if (existsSync(nestedNodeModules)) {
            walkNodeModules(nestedNodeModules, rootPath, packages, false);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Failed to walk ${nodeModulesPath}:`, err);
  }
}

/**
 * Detect duplicate packages (same name, different versions)
 */
function detectDuplicates(packages: Map<string, PackageInfo>): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  
  for (const [id, pkg] of packages) {
    if (!byName.has(pkg.name)) {
      byName.set(pkg.name, []);
    }
    byName.get(pkg.name)!.push(id);
  }
  
  // Filter to only packages with multiple versions
  const duplicates = new Map<string, string[]>();
  for (const [name, ids] of byName) {
    if (ids.length > 1) {
      duplicates.set(name, ids);
    }
  }
  
  return duplicates;
}

/**
 * Parse node_modules directory
 * 
 * @param targetPath - Path to project root (containing node_modules)
 * @returns Parsed node_modules data
 */
export function parseNodeModules(targetPath: string): ParsedNodeModules {
  const nodeModulesPath = join(targetPath, "node_modules");
  const packages = new Map<string, PackageInfo>();
  
  console.log(`Parsing node_modules at: ${nodeModulesPath}`);
  
  walkNodeModules(nodeModulesPath, targetPath, packages);
  
  const duplicates = detectDuplicates(packages);
  
  console.log(`Found ${packages.size} packages, ${duplicates.size} with duplicates`);
  
  return {
    packages,
    duplicates,
    rootPath: targetPath,
  };
}
