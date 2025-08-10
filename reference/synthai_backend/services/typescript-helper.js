const fs = require('fs/promises');
const path = require('path');

class TypeScriptHelper {
  /**
   * Ensure proper TypeScript configuration for strict type checking
   */
  async ensureStrictTypeChecking(projectPath) {
    const tsconfigPath = path.join(projectPath, 'tsconfig.json');
    
    try {
      const content = await fs.readFile(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(content);
      
      // Ensure compiler options exist
      if (!tsconfig.compilerOptions) {
        tsconfig.compilerOptions = {};
      }
      
      // Add strict type checking options
      const strictOptions = {
        strict: true,
        noImplicitAny: true,
        strictNullChecks: true,
        strictFunctionTypes: true,
        strictBindCallApply: true,
        strictPropertyInitialization: true,
        noImplicitThis: true,
        alwaysStrict: true,
        noUnusedLocals: false, // Allow unused locals for development
        noUnusedParameters: false, // Allow unused parameters for development
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      };
      
      // Merge with existing options
      tsconfig.compilerOptions = {
        ...tsconfig.compilerOptions,
        ...strictOptions
      };
      
      // Write back the updated config
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8');
      
      return true;
    } catch (error) {
      console.error('Error updating TypeScript config:', error);
      return false;
    }
  }
  
  /**
   * Create type declaration files for common patterns
   */
  async createTypeDeclarations(projectPath) {
    const typesDir = path.join(projectPath, 'src', 'types');
    
    try {
      // Create types directory
      await fs.mkdir(typesDir, { recursive: true });
      
      // Create common type declarations
      const globalTypes = `// Global type declarations
declare global {
  // Common event types
  type ChangeEvent = React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  type ClickEvent = React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>;
  type SubmitEvent = React.FormEvent<HTMLFormElement>;
  
  // Common prop types
  interface BaseProps {
    className?: string;
    children?: React.ReactNode;
  }
  
  // Utility types
  type Optional<T> = T | undefined;
  type Nullable<T> = T | null;
  type Maybe<T> = T | null | undefined;
}

export {};
`;
      
      await fs.writeFile(path.join(typesDir, 'global.d.ts'), globalTypes, 'utf-8');
      
      // Create component types
      const componentTypes = `// Common component type patterns
import { ReactNode } from 'react';

export interface LayoutProps {
  children: ReactNode;
  className?: string;
}

export interface PageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string | string[] | undefined>;
}

export interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export interface LoadingProps {
  className?: string;
}
`;
      
      await fs.writeFile(path.join(typesDir, 'components.ts'), componentTypes, 'utf-8');
      
      return true;
    } catch (error) {
      console.error('Error creating type declarations:', error);
      return false;
    }
  }
}

module.exports = TypeScriptHelper;