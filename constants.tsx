
import React from 'react';
import { DrawingPrompt } from './types';

export const PROMPTS: DrawingPrompt[] = [
  { id: '1', label: 'A futuristic cat', difficulty: 'Easy' },
  { id: '2', label: 'A spaceship landing on Mars', difficulty: 'Medium' },
  { id: '3', label: 'A slice of pizza eating a human', difficulty: 'Hard' },
  { id: '4', label: 'An elephant on a surfboard', difficulty: 'Medium' },
  { id: '5', label: 'A robot playing the piano', difficulty: 'Easy' },
  { id: '6', label: 'A haunted toaster', difficulty: 'Hard' },
];

export const Icons = {
  Play: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
  ),
  Refresh: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
  ),
  Mic: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
  )
};
