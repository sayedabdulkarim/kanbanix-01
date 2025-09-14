'use client';

import React from 'react';
import { CheckCircle, Circle, AlertCircle, Loader2 } from 'lucide-react';

interface Subtask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
}

interface SubtaskProgressProps {
  subtasks: Subtask[];
  overallProgress: number;
}

export const SubtaskProgress: React.FC<SubtaskProgressProps> = ({ 
  subtasks, 
  overallProgress 
}) => {
  const getStatusIcon = (status: Subtask['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'running':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Circle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: Subtask['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-50';
      case 'running':
        return 'text-blue-600 bg-blue-50';
      case 'failed':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Overall Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-gray-700">Task Progress</h3>
          <span className="text-sm text-gray-500">{Math.round(overallProgress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div 
            className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Subtasks List */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-gray-600 uppercase tracking-wider">
          Subtasks ({subtasks.filter(s => s.status === 'completed').length}/{subtasks.length})
        </h4>
        
        <div className="space-y-1">
          {subtasks.map((subtask, index) => (
            <div 
              key={subtask.id}
              className={`flex items-start gap-3 p-2 rounded-md transition-all duration-200 ${
                subtask.status === 'running' ? 'ring-2 ring-blue-500 ring-opacity-50' : ''
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {getStatusIcon(subtask.status)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${
                    subtask.status === 'completed' ? 'text-gray-600 line-through' : 'text-gray-800'
                  }`}>
                    {index + 1}. {subtask.name}
                  </span>
                  
                  {subtask.status !== 'pending' && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(subtask.status)}`}>
                      {subtask.status}
                    </span>
                  )}
                </div>
                
                {subtask.message && (
                  <p className="text-xs text-gray-500 mt-1">{subtask.message}</p>
                )}
                
                {subtask.status === 'running' && (
                  <div className="mt-2 w-full bg-gray-100 rounded-full h-1 overflow-hidden">
                    <div 
                      className="bg-blue-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${subtask.progress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SubtaskProgress;