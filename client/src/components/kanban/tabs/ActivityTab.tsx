'use client';

import { Task, Activity } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { format, formatDistanceToNow } from 'date-fns';
import { 
  Activity as ActivityIcon, Plus, Edit2, 
  MoveRight, MessageSquare, User, GitBranch,
  CheckCircle, Clock
} from 'lucide-react';

interface ActivityTabProps {
  task: Task;
}

export default function ActivityTab({ task }: ActivityTabProps) {
  const activities = task.metadata?.activities || [];

  // Combine all activities including system-generated ones
  const allActivities: Activity[] = [
    {
      id: 'created',
      type: 'created',
      description: 'Task created',
      timestamp: task.createdAt,
      user: 'System',
    },
    ...activities,
  ];

  // Sort by timestamp descending (newest first)
  const sortedActivities = allActivities.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const getActivityIcon = (type: Activity['type']) => {
    switch (type) {
      case 'created':
        return <Plus className="h-4 w-4" />;
      case 'updated':
        return <Edit2 className="h-4 w-4" />;
      case 'moved':
        return <MoveRight className="h-4 w-4" />;
      case 'commented':
        return <MessageSquare className="h-4 w-4" />;
      case 'status_changed':
        return <CheckCircle className="h-4 w-4" />;
      case 'assigned':
        return <User className="h-4 w-4" />;
      default:
        return <ActivityIcon className="h-4 w-4" />;
    }
  };

  const getActivityColor = (type: Activity['type']) => {
    switch (type) {
      case 'created':
        return 'bg-green-500';
      case 'updated':
        return 'bg-blue-500';
      case 'moved':
        return 'bg-purple-500';
      case 'commented':
        return 'bg-yellow-500';
      case 'status_changed':
        return 'bg-indigo-500';
      case 'assigned':
        return 'bg-pink-500';
      default:
        return 'bg-gray-500';
    }
  };

  const renderActivityDetails = (activity: Activity) => {
    if (!activity.details) return null;

    const details = activity.details as any;

    return (
      <div className="mt-2 p-2 rounded bg-secondary/50 text-sm">
        {activity.type === 'updated' && details.prUrl && (
          <div className="flex items-center gap-2">
            <GitBranch className="h-3 w-3" />
            <a
              href={details.prUrl as string}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              View Pull Request
            </a>
          </div>
        )}
        {activity.type === 'status_changed' && details.from && details.to && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <span className="px-2 py-0.5 rounded text-xs bg-background">
              {details.from as string}
            </span>
            <MoveRight className="h-3 w-3" />
            <span className="px-2 py-0.5 rounded text-xs bg-background">
              {details.to as string}
            </span>
          </div>
        )}
        {activity.type === 'moved' && details.fromColumn && details.toColumn && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Column:</span>
            <span className="px-2 py-0.5 rounded text-xs bg-background">
              {details.fromColumn as string}
            </span>
            <MoveRight className="h-3 w-3" />
            <span className="px-2 py-0.5 rounded text-xs bg-background">
              {details.toColumn as string}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {sortedActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <ActivityIcon className="h-8 w-8 mb-2" />
            <p>No activity yet</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
            
            <div className="space-y-4">
              {sortedActivities.map((activity, index) => (
                <div key={activity.id} className="flex gap-3 relative">
                  {/* Timeline dot */}
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-white z-10",
                      getActivityColor(activity.type)
                    )}
                  >
                    {getActivityIcon(activity.type)}
                  </div>
                  
                  <div className="flex-1 pb-4">
                    <div className="bg-card rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {activity.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span>{activity.user || 'System'}</span>
                            <span>•</span>
                            <span title={format(new Date(activity.timestamp), 'PPpp')}>
                              {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                            </span>
                          </div>
                          {renderActivityDetails(activity)}
                        </div>
                      </div>
                    </div>
                    
                    {/* Show related info for first and last items */}
                    {index === 0 && task.completedAt && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        <span>
                          Task completed {formatDistanceToNow(new Date(task.completedAt), { addSuffix: true })}
                        </span>
                      </div>
                    )}
                    
                    {index === sortedActivities.length - 1 && task.timeSpent && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          Total time spent: {task.timeSpent} hours
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}