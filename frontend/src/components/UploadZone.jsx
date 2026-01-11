import React, { useState, useCallback } from 'react';

const UploadZone = ({ onFileSelect }) => {
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    }, [onFileSelect]);

    const handleChange = useCallback((e) => {
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
        }
    }, [onFileSelect]);

    return (
        <div
            className={`
                relative overflow-hidden border border-dashed p-12 text-center transition-all duration-300 group
                ${isDragging
                    ? 'border-emerald-500 bg-emerald-500/5'
                    : 'border-white/10 hover:border-emerald-500/50 hover:bg-white/5'
                }
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Corner Markers for Tech feel */}
            <div className={`absolute top-0 left-0 w-3 h-3 border-t border-l transition-colors duration-300 ${isDragging ? 'border-emerald-400' : 'border-white/30 group-hover:border-emerald-500/50'}`}></div>
            <div className={`absolute top-0 right-0 w-3 h-3 border-t border-r transition-colors duration-300 ${isDragging ? 'border-emerald-400' : 'border-white/30 group-hover:border-emerald-500/50'}`}></div>
            <div className={`absolute bottom-0 left-0 w-3 h-3 border-b border-l transition-colors duration-300 ${isDragging ? 'border-emerald-400' : 'border-white/30 group-hover:border-emerald-500/50'}`}></div>
            <div className={`absolute bottom-0 right-0 w-3 h-3 border-b border-r transition-colors duration-300 ${isDragging ? 'border-emerald-400' : 'border-white/30 group-hover:border-emerald-500/50'}`}></div>

            <input
                type="file"
                accept="audio/*"
                onChange={handleChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
            />

            <div className="relative z-10 flex flex-col items-center gap-6">
                <div className={`
                    w-16 h-16 flex items-center justify-center border transition-all duration-300
                    ${isDragging
                        ? 'border-emerald-500 text-emerald-500 scale-105'
                        : 'border-white/10 text-white/50 group-hover:border-emerald-500/50 group-hover:text-emerald-400'
                    }
                `}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-8 h-8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                </div>

                <div className="space-y-1">
                    <h3 className={`text-sm font-bold uppercase tracking-widest transition-colors ${isDragging ? 'text-emerald-400' : 'text-white group-hover:text-emerald-300'}`}>
                        Audio Source
                    </h3>
                    <p className="text-xs text-white/40 font-mono">
                        [DRAG AND DROP] or [CLICK]
                    </p>
                </div>

                <div className="flex gap-4 text-[10px] text-white/20 uppercase tracking-widest font-mono border-t border-white/5 pt-4">
                    <span>MP3</span>
                    <span>WAV</span>
                    <span>FLAC</span>
                </div>
            </div>
        </div>
    );
};

export default UploadZone;
