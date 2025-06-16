
import React from 'react';
import { ModelMode } from '../types';

interface ModeSelectorProps {
  currentMode: ModelMode;
  onModeChange: (mode: ModelMode) => void;
  isProcessing: boolean;
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ currentMode, onModeChange, isProcessing }) => {
  return (
    <div className="flex items-center space-x-2 p-1 bg-gray-700 rounded-lg">
      {(Object.keys(ModelMode) as Array<keyof typeof ModelMode>).map((key) => {
        const mode = ModelMode[key];
        return (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            disabled={isProcessing}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors
              ${currentMode === mode 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}
              ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            {mode} Mode
          </button>
        );
      })}
    </div>
  );
};

export default ModeSelector;
