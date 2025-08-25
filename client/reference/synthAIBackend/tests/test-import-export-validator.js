/**
 * Test the import/export validator
 */

const ImportExportValidator = require('../services/import-export-validator');

async function testImportExportValidator() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 TESTING IMPORT/EXPORT VALIDATOR');
  console.log('='.repeat(60));
  
  const validator = new ImportExportValidator();
  
  // Test Case 1: Valid imports and exports
  console.log('\n📋 Test 1: Valid Imports and Exports');
  const validFiles = {
    '/src/components/Button.tsx': `'use client';

export default function Button({ children, onClick }) {
  return <button onClick={onClick}>{children}</button>;
}`,
    
    '/src/components/Input.tsx': `'use client';

export function Input({ value, onChange }) {
  return <input value={value} onChange={onChange} />;
}

export function TextArea({ value, onChange }) {
  return <textarea value={value} onChange={onChange} />;
}`,
    
    '/src/hooks/useCounter.ts': `'use client';

import { useState } from 'react';

export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  return { count, setCount };
}`,
    
    '/src/app/page.tsx': `'use client';

import Button from '@/components/Button';
import { Input, TextArea } from '@/components/Input';
import { useCounter } from '@/hooks/useCounter';

export default function Home() {
  const { count, setCount } = useCounter();
  
  return (
    <div>
      <Button onClick={() => setCount(count + 1)}>Click me</Button>
      <Input value={count} onChange={(e) => setCount(e.target.value)} />
      <TextArea value="test" onChange={() => {}} />
    </div>
  );
}`
  };
  
  const result1 = validator.validate(validFiles);
  console.log(`Valid: ${result1.valid ? '✅' : '❌'}`);
  if (result1.errors.length > 0) {
    console.log('Errors:', result1.errors);
  }
  
  // Test Case 2: Missing default export
  console.log('\n📋 Test 2: Missing Default Export');
  const missingDefaultFiles = {
    '/src/components/Card.tsx': `'use client';

// Oops, forgot default export
export function CardHeader() {
  return <div>Header</div>;
}`,
    
    '/src/app/page.tsx': `'use client';

import Card from '@/components/Card'; // This should fail

export default function Home() {
  return <Card />;
}`
  };
  
  const result2 = validator.validate(missingDefaultFiles);
  console.log(`Valid: ${result2.valid ? '❌' : '✅'} (should be invalid)`);
  console.log('Expected error:', result2.errors[0]);
  
  // Test Case 3: Missing named export
  console.log('\n📋 Test 3: Missing Named Export');
  const missingNamedFiles = {
    '/src/utils/helpers.ts': `
export function formatDate(date) {
  return date.toLocaleDateString();
}

// formatCurrency is not exported`,
    
    '/src/components/Price.tsx': `'use client';

import { formatDate, formatCurrency } from '@/utils/helpers'; // formatCurrency doesn't exist

export default function Price({ date, amount }) {
  return (
    <div>
      {formatDate(date)} - {formatCurrency(amount)}
    </div>
  );
}`
  };
  
  const result3 = validator.validate(missingNamedFiles);
  console.log(`Valid: ${result3.valid ? '❌' : '✅'} (should be invalid)`);
  console.log('Expected error:', result3.errors[0]);
  
  // Test Case 4: Complex import patterns
  console.log('\n📋 Test 4: Complex Import Patterns');
  const complexFiles = {
    '/src/types/index.ts': `
export interface User {
  id: string;
  name: string;
}

export type Status = 'active' | 'inactive';

export const DEFAULT_USER = { id: '1', name: 'Test' };`,
    
    '/src/context/UserContext.tsx': `'use client';

import { createContext } from 'react';
import { User, Status, DEFAULT_USER } from '@/types';

export const UserContext = createContext<User>(DEFAULT_USER);

export function useUser() {
  return { user: DEFAULT_USER, status: 'active' as Status };
}`,
    
    '/src/app/page.tsx': `'use client';

import { UserContext, useUser } from '@/context/UserContext';
import type { User } from '@/types'; // Type imports should be handled

export default function Home() {
  const { user } = useUser();
  return <div>{user.name}</div>;
}`
  };
  
  const result4 = validator.validate(complexFiles);
  console.log(`Valid: ${result4.valid ? '✅' : '❌'}`);
  if (result4.errors.length > 0) {
    console.log('Errors:', result4.errors);
  }
  
  // Test Case 5: Path resolution
  console.log('\n📋 Test 5: Path Resolution');
  const pathFiles = {
    '/src/components/common/Button.tsx': `'use client';

export default function Button() {
  return <button>Click</button>;
}`,
    
    '/src/components/common/index.ts': `
export { default as Button } from './Button';
export { Input } from './Input';`,
    
    '/src/components/common/Input.tsx': `'use client';

export function Input() {
  return <input />;
}`,
    
    '/src/app/page.tsx': `'use client';

import Button from '@/components/common/Button'; // Direct import
import { Button as Btn, Input } from '@/components/common'; // Index import

export default function Home() {
  return (
    <div>
      <Button />
      <Btn />
      <Input />
    </div>
  );
}`
  };
  
  const result5 = validator.validate(pathFiles);
  console.log(`Valid: ${result5.valid ? '✅' : '❌'}`);
  if (result5.errors.length > 0) {
    console.log('Errors:', result5.errors);
  }
  
  // Test Case 6: Mixed imports
  console.log('\n📋 Test 6: Mixed Default and Named Imports');
  const mixedFiles = {
    '/src/lib/utils.ts': `
export default function log(message) {
  console.log(message);
}

export function debug(message) {
  console.debug(message);
}

export const version = '1.0.0';`,
    
    '/src/app/page.tsx': `'use client';

import log, { debug, version } from '@/lib/utils';

export default function Home() {
  log('Home page loaded');
  debug('Version: ' + version);
  return <div>Home</div>;
}`
  };
  
  const result6 = validator.validate(mixedFiles);
  console.log(`Valid: ${result6.valid ? '✅' : '❌'}`);
  if (result6.errors.length > 0) {
    console.log('Errors:', result6.errors);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const tests = [
    { name: 'Valid imports/exports', passed: result1.valid === true },
    { name: 'Missing default export detection', passed: result2.valid === false },
    { name: 'Missing named export detection', passed: result3.valid === false },
    { name: 'Complex patterns', passed: result4.valid === true },
    { name: 'Path resolution', passed: result5.valid === true },
    { name: 'Mixed imports', passed: result6.valid === true }
  ];
  
  tests.forEach(test => {
    console.log(`${test.passed ? '✅' : '❌'} ${test.name}`);
  });
  
  const allPassed = tests.every(t => t.passed);
  
  console.log('\n' + '='.repeat(60));
  console.log(`Import/Export Validator Test: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('='.repeat(60));
  
  return allPassed;
}

// Run test
testImportExportValidator()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });