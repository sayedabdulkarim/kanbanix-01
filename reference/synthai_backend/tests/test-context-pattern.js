/**
 * Focused test for Context API pattern generation
 * Tests that Context files have correct exports
 */

const { AgentService } = require('../services/agent-service');

async function testContextPattern() {
  console.log('=== TESTING CONTEXT PATTERN ===\n');
  
  const agentService = new AgentService();
  
  // Mock the LLM to return a predictable TODO context
  const originalCallLLM = agentService.taskGenerator.callLLM;
  
  agentService.taskGenerator.callLLM = async (prompt) => {
    console.log('Mocking LLM response for:', prompt.substring(0, 100) + '...\n');
    
    if (prompt.includes('Create a detailed task list')) {
      return JSON.stringify({
        tasks: [
          {
            id: "task-1",
            name: "Create TodoContext with provider",
            description: "Create context for state management",
            dependencies: [],
            files: ["src/context/TodoContext.tsx"],
            priority: 1
          },
          {
            id: "task-2", 
            name: "Create TodoList component",
            description: "Component to display todos",
            dependencies: ["task-1"],
            files: ["src/components/TodoList.tsx"],
            priority: 2
          }
        ]
      });
    }
    
    if (prompt.includes('Create TodoContext with provider')) {
      return JSON.stringify({
        files: [{
          path: "src/context/TodoContext.tsx",
          content: `'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

// Todo type
interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

// Context type
interface TodoContextType {
  todos: Todo[];
  addTodo: (text: string) => void;
  toggleTodo: (id: number) => void;
  deleteTodo: (id: number) => void;
}

// Create context
export const TodoContext = createContext<TodoContextType | undefined>(undefined);

// Custom hook
export function useTodoContext() {
  const context = useContext(TodoContext);
  if (!context) {
    throw new Error('useTodoContext must be used within TodoProvider');
  }
  return context;
}

// Provider component
export function TodoProvider({ children }: { children: ReactNode }) {
  const [todos, setTodos] = useState<Todo[]>([]);

  const addTodo = (text: string) => {
    setTodos([...todos, { id: Date.now(), text, completed: false }]);
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  return (
    <TodoContext.Provider value={{ todos, addTodo, toggleTodo, deleteTodo }}>
      {children}
    </TodoContext.Provider>
  );
}`,
          action: "create"
        }],
        description: "Created TodoContext with provider"
      });
    }
    
    if (prompt.includes('Create TodoList component')) {
      return JSON.stringify({
        files: [{
          path: "src/components/TodoList.tsx",
          content: `'use client';

import { useTodoContext } from '@/context/TodoContext';

export default function TodoList() {
  const { todos, toggleTodo, deleteTodo } = useTodoContext();

  return (
    <div className="space-y-2">
      {todos.map(todo => (
        <div key={todo.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => toggleTodo(todo.id)}
          />
          <span className={todo.completed ? 'line-through' : ''}>{todo.text}</span>
          <button onClick={() => deleteTodo(todo.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}`,
          action: "create"
        }],
        description: "Created TodoList component"
      });
    }
    
    return 'Mocked response';
  };
  
  // Also mock PRD generation
  agentService.prdService.generatePRD = async () => {
    return "Simple TODO app PRD with context";
  };
  
  try {
    const result = await agentService.processRequirement("Create a TODO app");
    
    console.log('Files generated:', Object.keys(result.files).length);
    
    // Check context file
    const contextFile = result.files['/src/context/TodoContext.tsx'];
    if (contextFile) {
      console.log('\n✓ Context file found');
      
      // Check exports
      const hasContextExport = contextFile.includes('export const TodoContext');
      const hasHookExport = contextFile.includes('export function useTodoContext');
      const hasProviderExport = contextFile.includes('export function TodoProvider');
      
      console.log('  Exports:');
      console.log(`    TodoContext: ${hasContextExport ? '✓' : '✗'}`);
      console.log(`    useTodoContext: ${hasHookExport ? '✓' : '✗'}`);
      console.log(`    TodoProvider: ${hasProviderExport ? '✓' : '✗'}`);
    } else {
      console.log('\n✗ Context file not found');
    }
    
    // Check component imports
    const listFile = result.files['/src/components/TodoList.tsx'];
    if (listFile) {
      console.log('\n✓ TodoList component found');
      
      const importsFromContext = listFile.includes("from '@/context/TodoContext'");
      const importsHook = listFile.includes('useTodoContext');
      
      console.log('  Imports:');
      console.log(`    From context: ${importsFromContext ? '✓' : '✗'}`);
      console.log(`    Uses hook: ${importsHook ? '✓' : '✗'}`);
    }
    
    // Check validation
    if (result.feedback) {
      console.log('\n⚠ Validation errors:', result.feedback);
    } else {
      console.log('\n✓ No validation errors');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Restore original
    agentService.taskGenerator.callLLM = originalCallLLM;
  }
}

// Run test
testContextPattern().catch(console.error);