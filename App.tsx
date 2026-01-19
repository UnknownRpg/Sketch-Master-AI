
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob as GenAIBlob, Type, FunctionDeclaration } from '@google/genai';
import { GameState, GameMode, DrawingPrompt, TranscriptionItem, MultiplayerMessage, Player } from './types';
import { PROMPTS, Icons } from './constants';
import DrawingCanvas, { CanvasHandle, DrawingMetrics } from './components/DrawingCanvas';
import { encode, decode, decodeAudioData } from './services/audioUtils';
import { SoundManager } from './services/soundManager';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const SESSION_ID = Math.random().toString(36).substring(7);
const DEV_MODE = true; 

const SYSTEM_PROMPT = `
## 🎮 SYSTEM PROMPT — Sketch Master AI

**Role:**
You are Sketch Master AI, a live drawing game commentator and judge.
You watch players draw in real time and provide short, witty, emotionally intelligent voice commentary that reacts to how they are drawing — speed, hesitation, confidence, corrections — not just what they draw.

### 🎯 Core Behavior Rules
* Speak in short, punchy sentences (5–12 words).
* Do not narrate every stroke.
* Comment only when something meaningful happens.
* Tone: playful, observant, slightly dramatic.
* You can judge a single player (SOLO) or compare two players (BATTLE/ONLINE).
* If two players are present, use their metrics to decide who to praise or tease.

### 🧠 Interpretation Rules
Interpret numeric scores as normalized (0–1).
Only speak if:
- commentary.cooldown_active is false.
- events contains at least one true value.
- time.remaining_pct crosses 0.30, 0.15, or 0.05.

### 🏆 Scoring Rules
- Use the awardPoints tool frequently when you see good effort, confidence, or creative shapes.
- In BATTLE/ONLINE, Player 1 is the primary/local user. Player 2 is the opponent.
`;

const awardPointsFunctionDeclaration: FunctionDeclaration = {
  name: 'awardPoints',
  parameters: {
    type: Type.OBJECT,
    description: 'Award points to a specific user for their drawing progress and creativity.',
    properties: {
      playerId: { type: Type.NUMBER, description: 'Player ID (1 or 2).' },
      points: { type: Type.NUMBER, description: 'Points (10-100).' },
      reason: { type: Type.STRING, description: 'Reason for award.' },
    },
    required: ['playerId', 'points', 'reason'],
  },
};

const MetricRow: React.FC<{ label: string; value: number; trend?: string; warn?: boolean }> = ({ label, value, trend, warn }) => {
  const bars = Math.round(value * 10);
  const displayValue = value.toFixed(2);
  return (
    <div className="flex flex-col gap-0.5 mb-1.5">
      <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-tighter">
        <span className={warn ? 'text-red-400' : 'text-green-400/70'}>{label}</span>
        <span className={warn ? 'text-red-400' : ''}>{displayValue} {trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : ''} {warn ? '⚠' : ''}</span>
      </div>
      <div className="flex font-mono text-[10px] leading-none tracking-[-2px]">
        <span className={warn ? 'text-red-400' : 'text-green-400'}>{"█".repeat(bars)}</span>
        <span className="text-white/10">{"░".repeat(10 - bars)}</span>
      </div>
    </div>
  );
};

const DebugOverlay: React.FC<{ metrics: any }> = ({ metrics }) => {
  if (!DEV_MODE || !metrics) return null;
  return (
    <div className="fixed top-4 right-4 bg-black/90 backdrop-blur-sm text-green-400 p-3 rounded-lg border border-green-500/30 z-[100] shadow-2xl font-mono min-w-[160px] select-none">
      <MetricRow label="CONFIDENCE" value={metrics.confidence.score} trend={metrics.confidence.trend} />
      <MetricRow label="EFFICIENCY" value={metrics.efficiency.score} warn={metrics.efficiency.panic_detected} />
      <MetricRow label="CLARITY" value={metrics.clarity.score} />
      <div className="h-px bg-green-500/20 my-2" />
      <div className="flex justify-between text-[10px] font-black">
        <span>TIME</span>
        <span>{Math.round(metrics.time.remaining_pct * 100)}%</span>
      </div>
      <div className="flex justify-between text-[10px] font-black mt-1">
        <span>AI VOICE</span>
        <span className={metrics.commentary.cooldown_active ? 'text-yellow-500/50' : 'text-green-400'}>
          {metrics.commentary.cooldown_active ? 'COOLDOWN' : 'READY'}
        </span>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.LOBBY);
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.SOLO);
  const [currentPrompt, setCurrentPrompt] = useState<DrawingPrompt>(PROMPTS[0]);
  const [timeLeft, setTimeLeft] = useState(60);
  const [scores, setScores] = useState<Record<number, number>>({ 1: 0, 2: 0 });
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastAward, setLastAward] = useState<{ reason: string; playerId: number } | null>(null);
  const [activeTip, setActiveTip] = useState<{ tip: string; target: string } | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [currentMetricsPayload, setCurrentMetricsPayload] = useState<any>(null);

  // Online State
  const [roomCode, setRoomCode] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [opponent, setOpponent] = useState<Player | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [remoteCanvasData, setRemoteCanvasData] = useState<string | null>(null);

  const canvasRef1 = useRef<CanvasHandle>(null);
  const canvasRef2 = useRef<CanvasHandle>(null);
  const sessionRef = useRef<any>(null);
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const frameIntervalRef = useRef<number | null>(null);
  const syncIntervalRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastCommentTime = useRef(0);

  const cleanupSession = useCallback(() => {
    if (sessionRef.current) { sessionRef.current.close(); sessionRef.current = null; }
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
    if (syncIntervalRef.current) { clearInterval(syncIntervalRef.current); syncIntervalRef.current = null; }
    sourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleMessage = useCallback((msg: MultiplayerMessage) => {
    switch (msg.type) {
      case 'PLAYER_JOINED':
        if (isHost && !opponent) {
          setOpponent({ id: msg.senderId, name: 'Opponent', score: 0, isReady: true });
          SoundManager.play('point');
          channelRef.current?.postMessage({ type: 'PLAYER_JOINED', senderId: SESSION_ID, payload: { isHost: true, prompt: currentPrompt } });
        } else if (!isHost && msg.payload.isHost) {
          setOpponent({ id: msg.senderId, name: 'Host', score: 0, isReady: true });
          setCurrentPrompt(msg.payload.prompt);
          SoundManager.play('point');
        }
        break;
      case 'GAME_START': if (!isHost) { setCurrentPrompt(msg.payload.prompt); startGame(true); } break;
      case 'SYNC_CANVAS': if (msg.senderId !== SESSION_ID) setRemoteCanvasData(msg.payload.data); break;
      case 'SYNC_SCORE': if (msg.senderId !== SESSION_ID) setScores(prev => ({ ...prev, 2: msg.payload.score })); break;
      case 'GAME_OVER': if (gameState === GameState.PLAYING) endGame(); break;
    }
  }, [isHost, opponent, currentPrompt, gameState]);

  const connectToRoom = (code: string, asHost: boolean) => {
    if (channelRef.current) channelRef.current.close();
    const channel = new BroadcastChannel(`sketch-master-${code}`);
    channel.onmessage = (e) => handleMessage(e.data);
    channelRef.current = channel;
    setRoomCode(code); setIsHost(asHost); setGameState(GameState.WAITING);
    channel.postMessage({ type: 'PLAYER_JOINED', senderId: SESSION_ID, payload: {} });
  };

  const getMetricsPayload = (phase: 'live' | 'end' = 'live') => {
    const canvasMetrics = canvasRef1.current?.getMetrics();
    if (!canvasMetrics) return null;
    const time_remaining_pct = timeLeft / 60;
    const confidence_score = Math.min(1, Math.max(0, (canvasMetrics.strokeCount / 40) + (canvasMetrics.averageSpeed / 200) - (canvasMetrics.hesitationSeconds / 10)));
    const efficiency_score = Math.min(1, Math.max(0, (canvasMetrics.strokeCount / (canvasMetrics.totalDrawingTime / 1000 + 1)) * 5));
    const clarity_score = Math.min(1, Math.max(0, (canvasMetrics.strokeCount / 25)));

    return {
      phase,
      time: { remaining_pct: time_remaining_pct },
      confidence: {
        score: parseFloat(confidence_score.toFixed(2)),
        trend: canvasMetrics.averageSpeed > 60 ? "rising" : canvasMetrics.hesitationSeconds > 3 ? "falling" : "stable",
        hesitation_seconds: canvasMetrics.hesitationSeconds,
        redraw_rate: parseFloat((canvasMetrics.undoCount / (canvasMetrics.strokeCount + 1)).toFixed(2))
      },
      efficiency: {
        score: parseFloat(efficiency_score.toFixed(2)),
        panic_detected: time_remaining_pct < 0.15 && canvasMetrics.averageSpeed > 120
      },
      clarity: { 
        score: parseFloat(clarity_score.toFixed(2)), 
        recognizable_early: canvasMetrics.strokeCount > 15
      },
      commentary: {
        cooldown_active: (Date.now() - lastCommentTime.current) < 5000,
        comments_used: commentCount
      }
    };
  };

  const stitchCanvases = async (): Promise<string | null> => {
    const snap1 = canvasRef1.current?.getSnapshot();
    let snap2 = (gameMode === GameMode.BATTLE ? canvasRef2.current?.getSnapshot() : (gameMode === GameMode.ONLINE ? remoteCanvasData : null));
    if (!snap1) return null;
    if (!snap2) return snap1;
    return new Promise((resolve) => {
      const img1 = new Image(), img2 = new Image();
      let loaded = 0;
      const onImageLoad = () => {
        if (++loaded === 2) {
          const canvas = document.createElement('canvas');
          canvas.width = img1.width + img2.width + 20; canvas.height = img1.height;
          const ctx = canvas.getContext('2d');
          if (ctx) { 
            ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, canvas.width, canvas.height); 
            ctx.drawImage(img1, 0, 0); ctx.drawImage(img2, img1.width + 20, 0); 
            resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]); 
          }
        }
      };
      img1.onload = img2.onload = onImageLoad;
      img1.src = `data:image/jpeg;base64,${snap1}`; img2.src = `data:image/jpeg;base64,${snap2}`;
    });
  };

  const startGame = async (isFollower = false) => {
    setIsConnecting(true); setScores({ 1: 0, 2: 0 }); setCommentCount(0); lastCommentTime.current = 0;
    if (gameMode === GameMode.ONLINE && isHost && !isFollower) {
      channelRef.current?.postMessage({ type: 'GAME_START', senderId: SESSION_ID, payload: { prompt: currentPrompt } });
    }
    try {
      cleanupSession();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      if (!audioContextsRef.current) audioContextsRef.current = { input: new AudioContext({ sampleRate: INPUT_SAMPLE_RATE }), output: new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE }) };
      const { input: inputCtx, output: outputCtx } = audioContextsRef.current;
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          tools: [{ functionDeclarations: [awardPointsFunctionDeclaration] }],
          systemInstruction: SYSTEM_PROMPT.replace('${gameMode}', gameMode).replace('${currentPrompt}', currentPrompt.label),
        },
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(scriptProcessor); scriptProcessor.connect(inputCtx.destination);
            
            frameIntervalRef.current = window.setInterval(async () => {
              const metrics = getMetricsPayload();
              setCurrentMetricsPayload(metrics);
              const snap = await stitchCanvases();
              if (snap) {
                sessionPromise.then(s => {
                  s.sendRealtimeInput({ media: { data: snap, mimeType: 'image/jpeg' } });
                  s.sendRealtimeInput({ text: `DEVELOPER STATE:\n${JSON.stringify(metrics)}` });
                });
              }
            }, 3000);

            if (gameMode === GameMode.ONLINE) {
              syncIntervalRef.current = window.setInterval(() => {
                const snap = canvasRef1.current?.getSnapshot();
                if (snap) channelRef.current?.postMessage({ type: 'SYNC_CANVAS', senderId: SESSION_ID, payload: { data: snap } });
                channelRef.current?.postMessage({ type: 'SYNC_SCORE', senderId: SESSION_ID, payload: { score: scores[1] } });
              }, 1000);
            }

            setGameState(GameState.PLAYING); setIsConnecting(false); setTimeLeft(60);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'awardPoints') {
                  const { points, reason, playerId } = fc.args as any;
                  setScores(prev => ({ ...prev, [playerId]: prev[playerId] + points }));
                  setLastAward({ reason, playerId });
                  SoundManager.play('point');
                }
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: 'ok' } } }));
              }
            }
            const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              lastCommentTime.current = Date.now();
              setCommentCount(prev => prev + 1);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              const buffer = await decodeAudioData(decode(base64Audio), outputCtx, OUTPUT_SAMPLE_RATE, 1);
              const source = outputCtx.createBufferSource(); source.buffer = buffer; source.connect(outputCtx.destination); source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration; sourcesRef.current.add(source);
            }
          },
          onclose: () => setGameState(GameState.LOBBY)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) { setIsConnecting(false); }
  };

  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;
    const interval = setInterval(() => setTimeLeft(prev => { if (prev <= 1) { endGame(); return 0; } return prev - 1; }), 1000);
    return () => clearInterval(interval);
  }, [gameState]);

  const endGame = () => {
    const finalMetrics = getMetricsPayload('end');
    sessionRef.current?.sendRealtimeInput({ text: `DEVELOPER STATE (GAME OVER):\n${JSON.stringify(finalMetrics)}` });
    setGameState(GameState.RESULTS);
    if (gameMode === GameMode.ONLINE) channelRef.current?.postMessage({ type: 'GAME_OVER', senderId: SESSION_ID, payload: {} });
    setTimeout(cleanupSession, 4000);
  };

  const handleGenerateImage = async () => {
    setIsGeneratingImage(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const base64 = canvasRef1.current?.getSnapshot();
      if (!base64) return;
      const resp = await ai.models.generateContent({ model: 'gemini-2.5-flash-image', contents: { parts: [{ inlineData: { data: base64, mimeType: 'image/jpeg' } }, { text: `Cinematic digital painting of ${currentPrompt.label}` }] } });
      const imgPart = resp.candidates[0].content.parts.find(p => p.inlineData);
      if (imgPart) setGeneratedImageUrl(`data:image/png;base64,${imgPart.inlineData.data}`);
    } finally { setIsGeneratingImage(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden relative">
      <DebugOverlay metrics={currentMetricsPayload} />
      <header className="mb-6 text-center animate-fade-in relative z-10">
        <h1 className="text-4xl sm:text-6xl font-bungee text-indigo-400 drop-shadow-[0_0_15px_rgba(129,140,248,0.5)] tracking-tighter">SKETCH MASTER AI</h1>
        <div className="flex gap-2 justify-center mt-3">
           {([GameMode.SOLO, GameMode.BATTLE, GameMode.ONLINE] as GameMode[]).map(mode => (
             <button key={mode} className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${gameMode === mode ? 'bg-indigo-500 border-indigo-400 text-white' : 'bg-transparent border-white/20 text-slate-500'}`} onClick={() => { setGameMode(mode); setGameState(GameState.LOBBY); }}>{mode}</button>
           ))}
        </div>
      </header>
      
      <div className={`w-full max-w-7xl bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] p-6 border border-white/5 shadow-3xl min-h-[600px] flex flex-col relative z-10 transition-all overflow-hidden`}>
        {gameState === GameState.LOBBY && (
          <div className="flex flex-col gap-6 w-full animate-fade-in py-6">
            {gameMode === GameMode.ONLINE ? (
              <div className="grid md:grid-cols-2 gap-8 items-center max-w-4xl mx-auto py-12">
                <div className="p-8 bg-indigo-500/10 rounded-[2rem] border border-indigo-500/20 text-center space-y-4">
                  <h3 className="font-bungee text-2xl">HOST A GAME</h3>
                  <button onClick={() => connectToRoom(Math.random().toString(36).substring(7).toUpperCase(), true)} className="w-full py-4 bg-indigo-600 rounded-2xl font-bungee">CREATE ROOM</button>
                </div>
                <div className="p-8 bg-slate-800/50 rounded-[2rem] border border-white/5 text-center space-y-4">
                  <h3 className="font-bungee text-2xl text-slate-300">JOIN A GAME</h3>
                  <input value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value)} placeholder="ROOM CODE" className="w-full py-4 bg-black/40 rounded-2xl text-center font-bungee border border-white/10 outline-none" />
                  <button onClick={() => connectToRoom(joinCodeInput.toUpperCase(), false)} className="w-full py-4 bg-slate-700 rounded-2xl font-bungee">JOIN ROOM</button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  {PROMPTS.map(p => (
                    <button key={p.id} onClick={() => setCurrentPrompt(p)} className={`p-4 rounded-3xl text-left border-2 transition-all ${currentPrompt.id === p.id ? 'border-indigo-500 bg-indigo-500/20 scale-105' : 'border-white/5 bg-white/5'}`}>
                      <div className="font-bold text-sm mb-1">{p.label}</div>
                      <div className="text-[10px] uppercase font-black opacity-50 tracking-widest">{p.difficulty}</div>
                    </button>
                  ))}
                </div>
                <button onClick={() => startGame()} disabled={isConnecting} className="w-full py-6 bg-indigo-600 hover:bg-indigo-500 text-2xl font-bungee rounded-3xl shadow-2xl transition-all">{isConnecting ? 'CONNECTING...' : 'START COMPETITION'}</button>
              </>
            )}
          </div>
        )}

        {gameState === GameState.WAITING && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center animate-fade-in">
             <h2 className="text-4xl font-bungee mb-2">ROOM CODE: <span className="text-indigo-400">{roomCode}</span></h2>
             <p className="text-slate-400 mb-8">{opponent ? 'Opponent Joined!' : 'Waiting for Opponent...'}</p>
             {opponent && isHost && <button onClick={() => startGame()} className="w-full max-w-xs py-3 bg-indigo-600 rounded-xl font-bungee">START GAME</button>}
          </div>
        )}

        {gameState === GameState.PLAYING && (
          <div className="flex flex-col gap-6 animate-fade-in relative h-[600px]">
            <div className="flex justify-between items-center gap-4 px-2">
              <div className="flex-1 bg-indigo-500/10 p-4 rounded-3xl border border-indigo-500/20">
                <div className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Goal</div>
                <div className="text-2xl font-black">{currentPrompt.label}</div>
              </div>
              <div className="flex gap-3">
                <div className="bg-slate-800/80 p-4 rounded-3xl border border-white/5 text-center min-w-[100px]">
                  <div className="text-[10px] text-slate-500 uppercase font-black">Time</div>
                  <div className={`text-2xl font-bungee ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{timeLeft}s</div>
                </div>
                {(gameMode !== GameMode.SOLO) && (
                  <>
                    <div className="bg-cyan-500/20 p-4 rounded-3xl border border-cyan-500/30 text-center min-w-[100px] font-bungee text-2xl text-cyan-400">{scores[1]}</div>
                    <div className="bg-pink-500/20 p-4 rounded-3xl border border-pink-500/30 text-center min-w-[100px] font-bungee text-2xl text-pink-400">{scores[2]}</div>
                  </>
                )}
              </div>
            </div>
            
            <div className={`flex-1 flex ${gameMode === GameMode.SOLO ? 'flex-col' : 'flex-col lg:flex-row'} gap-6`}>
              <div className="flex-1 relative">
                <DrawingCanvas ref={canvasRef1} isActive={true} />
                <div className="absolute top-4 left-4 bg-cyan-500 text-black px-2 py-0.5 rounded text-[10px] font-black uppercase shadow-lg">You</div>
              </div>
              {gameMode !== GameMode.SOLO && (
                <div className="flex-1 relative bg-slate-800/50 rounded-[2.5rem] overflow-hidden border-4 border-slate-700">
                  {gameMode === GameMode.ONLINE ? (
                    remoteCanvasData ? (
                      <img src={`data:image/jpeg;base64,${remoteCanvasData}`} className="w-full h-full object-cover" alt="Opponent" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs font-black uppercase tracking-widest text-slate-500">Connecting Rival...</div>
                    )
                  ) : (
                    <DrawingCanvas ref={canvasRef2} isActive={true} />
                  )}
                  <div className="absolute top-4 left-4 bg-pink-500 text-black px-2 py-0.5 rounded text-[10px] font-black uppercase shadow-lg">Rival</div>
                </div>
              )}
            </div>

            <div className="absolute bottom-32 left-1/2 -translate-x-1/2 w-fit z-40">
               {lastAward && (
                 <div className="bg-emerald-500/90 backdrop-blur-xl px-10 py-5 rounded-[2rem] animate-bounce-in shadow-2xl text-white text-center border border-emerald-300/50">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] mb-1">POINT AWARDED P{lastAward.playerId}</div>
                    <div className="text-xl font-bold leading-tight">"{lastAward.reason}"</div>
                 </div>
               )}
            </div>
          </div>
        )}

        {gameState === GameState.RESULTS && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-900/60 rounded-[2.5rem] animate-fade-in">
            <div className="text-9xl mb-6 animate-bounce">🏆</div>
            <h2 className="text-6xl font-bungee mb-10">FINAL SCORE</h2>
            <div className="flex gap-16 mb-12">
               <div className="text-7xl font-bungee text-cyan-400">{scores[1]}</div>
               {gameMode !== GameMode.SOLO && <div className="text-7xl font-bungee text-pink-400 border-l border-white/10 pl-16">{scores[2]}</div>}
            </div>
            <div className="flex flex-col sm:flex-row gap-6 w-full max-w-xl">
               {generatedImageUrl ? (
                 <div className="space-y-6 w-full animate-fade-in">
                    <img src={generatedImageUrl} className="w-full rounded-[2rem] border-4 border-white/10 shadow-3xl" />
                    <button onClick={() => setGameState(GameState.LOBBY)} className="w-full py-5 bg-indigo-600 rounded-3xl font-bungee text-xl shadow-lg hover:bg-indigo-500 transition-all">NEW ROUND</button>
                 </div>
               ) : (
                 <>
                   <button onClick={handleGenerateImage} disabled={isGeneratingImage} className="flex-1 py-6 bg-emerald-600 rounded-3xl font-bungee text-xl shadow-lg hover:bg-emerald-500 transition-all flex items-center justify-center gap-3">
                     {isGeneratingImage ? <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : '✨ AI TRANSFORM'}
                   </button>
                   <button onClick={() => setGameState(GameState.LOBBY)} className="flex-1 py-6 bg-slate-700 rounded-3xl font-bungee text-xl shadow-lg hover:bg-slate-600 transition-all">LOBBY</button>
                 </>
               )}
            </div>
          </div>
        )}
      </div>
      <footer className="mt-8 opacity-20 text-[10px] uppercase font-black tracking-[0.5em] relative z-10">SKETCH MASTER AI — GEMINI POWERED</footer>
    </div>
  );
};

export default App;
