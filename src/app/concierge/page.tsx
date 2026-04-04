'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Send, BookOpen, Share2, Edit } from 'lucide-react'; // Assuming lucide-react for icons
import { ItineraryCard } from '@/components/ItineraryCard';
import { DestinationCard } from '@/components/DestinationCard';

type Message = { role: 'user' | 'assistant'; content: string };

const progressStages = ['Discovery', 'Preferences', 'Building Itinerary', 'Your Plan'];

export default function ConciergePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [itinerary, setItinerary] = useState<any>(null); // From itinerary-builder
  const [soundEnabled, setSoundEnabled] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // Initial welcome message
    setMessages([{ role: 'assistant', content: 'Welcome to AskGo! Let\'s craft your perfect wellness escape. 🌟 Which country excites you most?' }]);
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const newMessages = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');
    setIsTyping(true);
    if (soundEnabled) audioRef.current?.play(); // Sound effect

    const response = await fetch('/api/concierge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: newMessages }),
    });

    const reader = response.body?.getReader();
    if (!reader) return;

    let assistantMessage = '';
    setMessages([...newMessages, { role: 'assistant', content: '' }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      const lines = text.split('\n\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (data.choices[0].delta.content) {
            assistantMessage += data.choices[0].delta.content;
            setMessages([...newMessages, { role: 'assistant', content: assistantMessage }]);
          }
        }
      }
    }

    setIsTyping(false);
    // Simulate progress update based on conversation length
    setProgress(Math.min(progress + 1, progressStages.length - 1));

    // If itinerary is built (detect via content), parse and set
    if (assistantMessage.includes('Itinerary')) {
      // Assuming the API returns structured data; here simulate building
      // In real, parse from message or call itinerary-builder
      const prefs = { country: 'Thailand', activities: ['yoga'], budget: 'premium', dates: { start: '2024-01-01', end: '2024-01-07' }, duration: 7 };
      const builtItinerary = require('@/lib/itinerary-builder').buildItinerary(prefs);
      setItinerary(builtItinerary);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 to-purple-900 text-white flex flex-col">
      <audio ref={audioRef} src="/sounds/send.mp3" /> {/* Placeholder sound */}
      <header className="p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">AskGo Wellness Concierge</h1>
        <div className="flex gap-2">
          <button onClick={() => setSoundEnabled(!soundEnabled)}>{soundEnabled ? '🔊' : '🔇'}</button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4" ref={chatRef}>
        <AnimatePresence>
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
            >
              <div className={`inline-block p-4 rounded-lg backdrop-blur-md bg-white/10 ${msg.role === 'user' ? 'ml-auto' : ''}`}>
                {msg.content} {/* Add markdown rendering here if needed */}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {isTyping && (
          <div className="text-left mb-4">
            <div className="inline-block p-4 rounded-lg backdrop-blur-md bg-white/10">
              <div className="flex gap-2">
                <div className="w-2 h-2 bg-white rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-white rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-white rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        {itinerary && (
          <div className="mt-8">
            {itinerary.days.map((day: any) => <ItineraryCard key={day.day} day={day} />)}
            {itinerary.destinations.map((dest: any) => <DestinationCard key={dest.name} destination={dest} />)}
          </div>
        )}
      </div>
      <div className="p-4 bg-white/5 backdrop-blur-md">
        <div className="flex mb-2">
          {progressStages.map((stage, idx) => (
            <div key={idx} className={`flex-1 text-center ${idx <= progress ? 'text-white' : 'text-gray-400'}`}>
              {stage}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            className="flex-1 p-3 rounded-lg bg-white/10 text-white placeholder-gray-300"
            placeholder="Type your message..."
          />
          <button onClick={sendMessage} className="p-3 bg-indigo-500 rounded-lg">
            <Send size={20} />
          </button>
        </div>
        <div className="flex justify-around mt-4">
          <button className="flex items-center gap-1"><BookOpen /> Book Now</button>
          <button className="flex items-center gap-1"><Share2 /> Share</button>
          <button className="flex items-center gap-1"><Edit /> Modify</button>
        </div>
        {/* Quick-reply chips - contextual, e.g., based on last message */}
      </div>
    </div>
  );
}
