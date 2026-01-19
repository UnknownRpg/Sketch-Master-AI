
import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { SoundManager } from '../services/soundManager';

interface Props {
  onSnapshot?: (base64: string) => void;
  isActive: boolean;
}

export interface DrawingMetrics {
  strokeCount: number;
  lastStrokeTime: number;
  hesitationSeconds: number;
  totalDrawingTime: number;
  clearCount: number;
  undoCount: number;
  averageSpeed: number; // pixels per ms roughly
}

export interface CanvasHandle {
  clear: () => void;
  getSnapshot: () => string;
  setColor: (color: string) => void;
  undo: () => void;
  redo: () => void;
  getMetrics: () => DrawingMetrics;
}

const MAX_HISTORY = 50;
type LineStyle = 'solid' | 'dashed' | 'dotted';

const COLOR_PRESETS = [
  '#ffffff', '#000000', '#f43f5e', '#ec4899', '#d946ef', 
  '#a855f7', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', 
  '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308', 
  '#f59e0b', '#f97316', '#ef4444'
];

const DrawingCanvas = forwardRef<CanvasHandle, Props>(({ onSnapshot, isActive }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#ffffff');
  const [lineWidth, setLineWidth] = useState(5);
  const [lineStyle, setLineStyle] = useState<LineStyle>('solid');
  
  // Metrics Tracking
  const metrics = useRef<DrawingMetrics>({
    strokeCount: 0,
    lastStrokeTime: Date.now(),
    hesitationSeconds: 0,
    totalDrawingTime: 0,
    clearCount: 0,
    undoCount: 0,
    averageSpeed: 0
  });

  const lastPos = useRef<{x: number, y: number} | null>(null);
  const drawStartTime = useRef<number>(0);
  
  // Undo/Redo stacks
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);

  const saveState = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL();
    undoStack.current.push(dataUrl);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift();
    }
    redoStack.current = [];
  };

  const restoreState = (dataUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      saveState();
      metrics.current.clearCount++;
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    },
    setColor: (newColor: string) => {
      setColor(newColor);
    },
    undo: () => {
      if (undoStack.current.length === 0 || !canvasRef.current) return;
      metrics.current.undoCount++;
      const currentState = canvasRef.current.toDataURL();
      redoStack.current.push(currentState);
      const previousState = undoStack.current.pop()!;
      restoreState(previousState);
    },
    redo: () => {
      if (redoStack.current.length === 0 || !canvasRef.current) return;
      const currentState = canvasRef.current.toDataURL();
      undoStack.current.push(currentState);
      const nextState = redoStack.current.pop()!;
      restoreState(nextState);
    },
    getSnapshot: () => {
      if (!canvasRef.current) return '';
      return canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];
    },
    getMetrics: () => {
      // Calculate final hesitation before returning
      if (!isDrawing) {
        metrics.current.hesitationSeconds = (Date.now() - metrics.current.lastStrokeTime) / 1000;
      }
      return { ...metrics.current };
    }
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const tempData = canvas.toDataURL();
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0);
          img.src = tempData;
        }
      }
    };

    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isActive) return;
    saveState();
    setIsDrawing(true);
    metrics.current.strokeCount++;
    drawStartTime.current = Date.now();
    SoundManager.play('drawStart');
    draw(e);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      SoundManager.play('drawEnd');
      metrics.current.lastStrokeTime = Date.now();
      metrics.current.totalDrawingTime += (Date.now() - drawStartTime.current);
    }
    setIsDrawing(false);
    lastPos.current = null;
    const ctx = canvasRef.current?.getContext('2d');
    ctx?.beginPath();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !isActive || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const rect = canvasRef.current.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    if (lastPos.current) {
      const dist = Math.sqrt(Math.pow(x - lastPos.current.x, 2) + Math.pow(y - lastPos.current.y, 2));
      metrics.current.averageSpeed = (metrics.current.averageSpeed + dist) / 2;
    }
    lastPos.current = { x, y };

    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;

    if (lineStyle === 'dashed') {
      ctx.setLineDash([lineWidth * 3, lineWidth * 2]);
    } else if (lineStyle === 'dotted') {
      ctx.setLineDash([1, lineWidth * 2]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  return (
    <div className="relative w-full h-full bg-slate-800 rounded-2xl overflow-hidden shadow-2xl border-4 border-slate-700">
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseUp={stopDrawing}
        onMouseMove={draw}
        onTouchStart={startDrawing}
        onTouchEnd={stopDrawing}
        onTouchMove={draw}
        className="w-full h-full block"
      />
      
      <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-3 bg-black/70 backdrop-blur-xl p-3 rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide py-1 pr-4">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 shrink-0 transition-all hover:scale-110 active:scale-95 ${color === c ? 'border-white scale-110 ring-2 ring-white/20' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="h-8 w-px bg-white/10 shrink-0" />
            <button 
              onClick={() => colorInputRef.current?.click()}
              className={`w-9 h-9 rounded-xl border-2 shrink-0 flex items-center justify-center transition-all hover:bg-white/10 ${!COLOR_PRESETS.includes(color) ? 'border-indigo-400 bg-indigo-500/20' : 'border-white/20'}`}
            >
              <div 
                className="w-5 h-5 rounded shadow-sm border border-white/20" 
                style={{ background: `linear-gradient(45deg, ${color}, #ffffff55), conic-gradient(red, yellow, lime, aqua, blue, magenta, red)` }}
              />
              <input ref={colorInputRef} type="color" value={color} onChange={(e) => setColor(e.target.value)} className="sr-only" />
            </button>
          </div>

          <div className="flex bg-white/5 rounded-xl p-1 border border-white/10 shrink-0">
            {(['solid', 'dashed', 'dotted'] as LineStyle[]).map(style => (
              <button
                key={style}
                onClick={() => setLineStyle(style)}
                className={`px-3 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${lineStyle === style ? 'bg-indigo-500 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
              >
                {style}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
               onClick={() => ref && 'current' in ref && ref.current?.undo()}
               className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-30 text-white border border-white/5"
               disabled={undoStack.current.length === 0}
            >
              Undo
            </button>
            <button
               onClick={() => ref && 'current' in ref && ref.current?.redo()}
               className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-30 text-white border border-white/5"
               disabled={redoStack.current.length === 0}
            >
              Redo
            </button>
          </div>
        </div>
        
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 flex-1">
            <span className="text-[10px] text-white/50 uppercase font-black tracking-widest shrink-0">Stroke Size</span>
            <input
              type="range" min="1" max="40" value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
            />
            <span className="text-[10px] text-white font-mono w-6 text-right shrink-0">{lineWidth}</span>
          </div>
          <button
             onClick={() => ref && 'current' in ref && ref.current?.clear()}
             className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/30 text-red-400 rounded-lg text-[10px] font-black transition-all border border-red-500/30 uppercase tracking-widest active:scale-95"
          >
            Clear Canvas
          </button>
        </div>
      </div>
    </div>
  );
});

export default DrawingCanvas;
