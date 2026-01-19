
export enum GameState {
  LOBBY = 'LOBBY',
  PLAYING = 'PLAYING',
  RESULTS = 'RESULTS',
  WAITING = 'WAITING'
}

export enum GameMode {
  SOLO = 'SOLO',
  BATTLE = 'BATTLE',
  ONLINE = 'ONLINE'
}

export interface DrawingPrompt {
  id: string;
  label: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

export interface TranscriptionItem {
  type: 'user' | 'model';
  text: string;
}

export interface MultiplayerMessage {
  type: 'PLAYER_JOINED' | 'GAME_START' | 'SYNC_CANVAS' | 'SYNC_SCORE' | 'GAME_OVER' | 'HEARTBEAT';
  senderId: string;
  payload: any;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  isReady: boolean;
  canvasData?: string;
}
